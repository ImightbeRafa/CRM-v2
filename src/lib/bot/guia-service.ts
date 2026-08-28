/**
 * Shared guía generation service used by both the AI bot tools and the
 * integration API.  Encapsulates credential loading, Correos WS calls,
 * and ShippingGuia persistence so each consumer doesn't duplicate logic.
 */

import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { CorreosWebService, buildGuiaDescription, buildFullAddress, getCorreosWSCredentials } from '@/lib/correos';
import { shouldUseBotLifecycleV2, shouldUseOrderLifecycleV2, type OrderLifecycleAdapter } from '@/lib/feature-flags';
import { setLifecycleOrderStatus } from '@/lib/order-lifecycle';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GuiaGenerationResult {
  success: boolean;
  orderId: string;
  guiaNumber?: string;
  trackingNumber?: string;
  pdfBuffer?: Buffer;
  pdfFileName?: string;
  error?: string;
}

export interface GuiaBatchResult {
  results: GuiaGenerationResult[];
  successful: number;
  failed: number;
}

interface SenderInfo {
  name: string;
  address: string;
  zip: string;
  phone: string;
}

export interface GuiaGenerationOptions {
  deliveryType?: 'Domicilio' | 'Sucursal' | 'Punto de correo';
  verifiedLocations?: Array<{ orderId: string; province: string; canton: string; district: string; address?: string }>;
  adapter?: Extract<OrderLifecycleAdapter, 'tenant-guia' | 'bot'>;
  userId?: string;
  operationKey?: string;
  timeoutMs?: number;
  concurrency?: number;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Correos request timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate Correos de Costa Rica guías for one or more orders.
 * Handles credential loading, WS calls, DB persistence, and order status
 * updates.  Returns PDF buffers for each successful guía.
 */
export async function generateGuiasForOrders(
  tenantId: string,
  orderIds: string[],
  carrier = 'correos_cr',
  options: GuiaGenerationOptions = {},
): Promise<GuiaBatchResult> {
  const tenantPrisma = getTenantPrisma(tenantId);

  // Load shipping config — try exact carrier match first, then fallback
  let shippingConfig = await tenantPrisma.shippingConfig.findFirst({
    where: { carrier, isActive: true, tenantId },
  });

  if (!shippingConfig) {
    // Fallback: match any carrier containing 'correos' (handles 'correos', 'Correos_CR', etc.)
    const allConfigs = await tenantPrisma.shippingConfig.findMany({
      where: { isActive: true, tenantId },
    });

    shippingConfig = allConfigs.find(
      c => c.carrier.toLowerCase().includes('correos'),
    ) ?? null;

    console.log(`[GuiaService] Exact carrier='${carrier}' not found for tenant ${tenantId}. ` +
      `Found ${allConfigs.length} active config(s): [${allConfigs.map(c => `${c.carrier}(id:${c.id})`).join(', ')}]. ` +
      `Fallback match: ${shippingConfig ? shippingConfig.carrier : 'NONE'}`);
  }

  const settings = (shippingConfig?.settings as Record<string, any>) ?? {};

  let wsCreds;
  try {
    wsCreds = getCorreosWSCredentials();
  } catch (e: any) {
    console.error(`[GuiaService] Platform credentials check FAILED: ${e.message}`);
    return {
      results: orderIds.map(id => ({
        success: false,
        orderId: id,
        error: e.message || 'Correos WS platform credentials not configured.',
      })),
      successful: 0,
      failed: orderIds.length,
    };
  }

  if (!shippingConfig) {
    console.warn(`[GuiaService] No ShippingConfig found for tenant ${tenantId} — using default sender data.`);
  } else {
    console.log(`[GuiaService] Using config carrier='${shippingConfig.carrier}' (id:${shippingConfig.id}) for tenant ${tenantId}`);
  }

  const orders = await tenantPrisma.order.findMany({
    where: { orderId: { in: orderIds }, tenantId, orderType: 'EA' },
  });

  if (orders.length === 0) {
    return {
      results: orderIds.map(id => ({
        success: false,
        orderId: id,
        error: 'Orden no encontrada o no es tipo envío (EA).',
      })),
      successful: 0,
      failed: orderIds.length,
    };
  }

  const sender: SenderInfo = {
    name: settings.ws_sender_name || '',
    address: settings.ws_sender_address || '',
    zip: settings.ws_sender_zip || '10101',
    phone: settings.ws_sender_phone || '00000000',
  };

  const ws = new CorreosWebService(wsCreds);
  const locationMap = new Map((options.verifiedLocations || []).map(location => [location.orderId, location]));
  const deliveryType = options.deliveryType || 'Domicilio';
  const useLifecycleV2 = options.adapter === 'bot'
    ? await shouldUseBotLifecycleV2(tenantId)
    : options.adapter
      ? await shouldUseOrderLifecycleV2(tenantId, options.adapter)
      : false;
  const markOrderShipped = async (order: (typeof orders)[number], idempotencyKey: string) => {
    if (useLifecycleV2) {
      await setLifecycleOrderStatus({
        tenantId,
        userId: options.userId,
        adapter: options.adapter || 'tenant-guia',
        idempotencyKey,
        orderId: order.orderId,
        status: 'Enviado',
        courier: carrier,
      });
    } else {
      await tenantPrisma.order.update({
        where: { tenantId_orderId: { tenantId, orderId: order.orderId } },
        data: { status: 'Enviado', courier: carrier },
      });
    }
  };

  const results = await mapWithConcurrency(orders, Math.max(1, Math.min(options.concurrency || 3, 4)), async order => {
    // Skip if guía already exists for this order
    const existing = await tenantPrisma.shippingGuia.findFirst({
      where: { orderId: order.orderId, tenantId },
    });

    if (existing && existing.status === 'completed') {
      try {
        await markOrderShipped(order, `guia:${order.id}:${existing.guiaNumber || existing.id}`);
      } catch (error) {
        console.warn(`[GuiaService] Failed to reconcile order status for ${order.orderId}:`, error);
      }
      return {
        success: true,
        orderId: order.orderId,
        guiaNumber: existing.guiaNumber || undefined,
        trackingNumber: existing.trackingNumber || undefined,
        pdfBuffer: existing.pdfData ? Buffer.from(existing.pdfData) : undefined,
        pdfFileName: existing.pdfFileName || `guia-${existing.guiaNumber}.pdf`,
      };
    }

    try {
      const verified = locationMap.get(order.orderId);
      const addressData = verified ? { ...order, ...verified } : order;
      let destZip = '10101';
      if (addressData.province && addressData.canton && addressData.district) {
        try {
          destZip = await withTimeout(ws.getPostalCode(addressData.province, addressData.canton, addressData.district), options.timeoutMs || 12_000);
        } catch (geoErr: any) {
          console.warn(`[GuiaService] Could not resolve postal code for ${order.orderId}: ${geoErr.message}`);
        }
      }

      // Correos exposes no provider idempotency key. A queued bot attempt must
      // durably claim the external side effect immediately before registration.
      // An unresolved prior claim is never retried automatically because the
      // provider may have registered the guía before a timeout or crash.
      let externalClaimKey: string | null = null;
      if (options.adapter === 'bot') {
        if (!options.operationKey || !useLifecycleV2) {
          return {
            success: false,
            orderId: order.orderId,
            error: 'La generación de guía del bot no está habilitada de forma segura.',
          };
        }
        // Deliberately stable across different provider messages: after an
        // ambiguous external attempt, a newly worded retry must not bypass the
        // claim and register a second guía for the same order.
        externalClaimKey = `correos-guia:${order.id}`;
        try {
          await globalPrisma.orderLifecycleOperation.create({
            data: {
              tenantId,
              adapter: 'bot',
              operation: 'correos_guia_external_claim',
              idempotencyKey: externalClaimKey,
              orderId: order.id,
              result: { state: 'claimed', claimedAt: new Date().toISOString() },
            },
          });
        } catch (claimError) {
          if (!(claimError instanceof Prisma.PrismaClientKnownRequestError && claimError.code === 'P2002')) {
            throw claimError;
          }
          const completed = await tenantPrisma.shippingGuia.findFirst({
            where: { tenantId, orderId: order.orderId, status: 'completed' },
          });
          if (completed) {
            try {
              await markOrderShipped(order, `guia:${order.id}:${completed.guiaNumber || completed.id}`);
            } catch {
              // Status reconciliation must not create another provider guía.
            }
            return {
              success: true,
              orderId: order.orderId,
              guiaNumber: completed.guiaNumber || undefined,
              trackingNumber: completed.trackingNumber || undefined,
              pdfBuffer: completed.pdfData ? Buffer.from(completed.pdfData) : undefined,
              pdfFileName: completed.pdfFileName || `guia-${completed.guiaNumber}.pdf`,
            };
          }
          return {
            success: false,
            orderId: order.orderId,
            error: 'La guía está en proceso o requiere reconciliación. Revísala en Producción antes de reintentar.',
          };
        }
      }

      const res = await withTimeout(ws.generateAndRegisterGuia({
        customerName: order.customerName || 'Destinatario',
        customerPhone: order.phone || '00000000',
        customerAddress: buildFullAddress(addressData),
        customerZip: destZip,
        customerApartado: destZip,
        senderName: sender.name,
        senderAddress: sender.address,
        senderZip: sender.zip,
        senderPhone: sender.phone,
        weight: 500,
        description: `${buildGuiaDescription(order as any)} | Entrega: ${deliveryType}`,
      }), options.timeoutMs || 20_000);

      if (res.success && res.guiaNumber) {
        const pdfBuf = res.pdfBuffer
          ? (Buffer.isBuffer(res.pdfBuffer) ? res.pdfBuffer : Buffer.from(res.pdfBuffer as any))
          : undefined;

        const guiaData: any = {
          orderId: order.orderId,
          carrier,
          guiaNumber: res.guiaNumber,
          trackingNumber: res.guiaNumber,
          status: 'completed',
          serviceType: deliveryType,
          tenant: { connect: { id: tenantId } },
        };

        if (pdfBuf) {
          guiaData.pdfData = pdfBuf;
          guiaData.pdfFileName = `guia-${res.guiaNumber}.pdf`;
        }

        // Upsert – delete old failed/pending if exists then create
        if (existing) {
          await tenantPrisma.shippingGuia.delete({ where: { id: existing.id } });
        }
        await tenantPrisma.shippingGuia.create({ data: guiaData });

        // The server is the single Enviado writer. V2 uses the canonical
        // lifecycle; bots remain on their legacy path until Slice 5.
        try {
          await markOrderShipped(order, `guia:${order.id}:${res.guiaNumber}`);
        } catch (e) {
          console.warn(`[GuiaService] Failed to update order status for ${order.orderId}:`, e);
        }

        if (externalClaimKey) {
          await globalPrisma.orderLifecycleOperation.updateMany({
            where: { tenantId, adapter: 'bot', idempotencyKey: externalClaimKey },
            data: {
              result: {
                state: 'completed',
                guiaNumber: res.guiaNumber,
                completedAt: new Date().toISOString(),
              },
            },
          });
        }

        // Upsert lm_orders for logistics
        try {
          await globalPrisma.$executeRaw`
            INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
            VALUES (${order.id}, ${tenantId}, 'correos', 'Guía Creada')
            ON CONFLICT (crm_order_id) DO UPDATE
            SET carrier = 'correos', status = 'Guía Creada', updated_at = NOW()
          `;
        } catch (lmErr) {
          console.warn(`[GuiaService] Failed to upsert lm_orders for ${order.orderId}:`, lmErr);
        }

        return {
          success: true,
          orderId: order.orderId,
          guiaNumber: res.guiaNumber,
          trackingNumber: res.guiaNumber,
          pdfBuffer: pdfBuf,
          pdfFileName: `guia-${res.guiaNumber}.pdf`,
        };
      } else {
        if (externalClaimKey) {
          await globalPrisma.orderLifecycleOperation.updateMany({
            where: { tenantId, adapter: 'bot', idempotencyKey: externalClaimKey },
            data: {
              result: {
                state: 'provider_failed',
                failedAt: new Date().toISOString(),
              },
            },
          });
        }
        return {
          success: false,
          orderId: order.orderId,
          error: res.error || 'Correos WS returned an error',
        };
      }
    } catch (err: any) {
      console.error(`[GuiaService] Error generating guía for ${order.orderId}:`, err.message);
      return {
        success: false,
        orderId: order.orderId,
        error: err.message || 'Error inesperado al generar guía',
      };
    }
  });

  // Fill in results for orders that weren't found in the DB
  const processedIds = new Set(results.map(r => r.orderId));
  for (const id of orderIds) {
    if (!processedIds.has(id)) {
      results.push({ success: false, orderId: id, error: 'Orden no encontrada.' });
    }
  }

  return {
    results,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  };
}
