/**
 * Production guía generation (the /produccion "Generar guía" button, the integration API and, from F7, the
 * inbox sales agent). Copied from src/lib/bot/guia-service.ts on 2026-10-08 so tenant code no longer imports
 * the staff bot folder (the staff bot keeps its own copy, untouched).
 * MUST stay in step with the bot copy on the external claim: same key `correos-guia:${order.id}` and same
 * CORREOS_PROVIDER_ADAPTER, so the two copies can never register two Correos guías for one order
 * (guia-service-parity.test.ts checks this).
 * Encapsulates credential loading, Correos WS calls, and ShippingGuia persistence.
 */

import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { Prisma, type PrismaClient } from '@prisma/client';
import { CorreosWebService, buildGuiaDescription, buildFullAddress, resolveCorreosWSCredentials } from '@/lib/correos';
import { CorreosAuthError, isCorreosCredentialRejection } from '@/lib/correos/auth-error';
import { shouldUseBotLifecycleV2, shouldUseOrderLifecycleV2, type OrderLifecycleAdapter } from '@/lib/feature-flags';
import { setLifecycleOrderStatus } from '@/lib/order-lifecycle';
import { getCorreosV3ForWrite } from '@/lib/correos/v3/select';
import { saveV3Guia } from '@/lib/correos/v3/store';
import type { CorreosV3Service, V3GuiaInput, V3GuiaOutcome } from '@/lib/correos/v3/service';

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
  /**
   * Automatic (agent) guías: never fall back to the default zip 10101 — if the destination postal code can't be
   * resolved the order is skipped with an error so a person checks the address first.
   */
  requireResolvedPostalCode?: boolean;
  /** Correos v3 only: package weight in grams (else the store default, else 500 g). */
  pesoG?: number;
  /** Correos v3 only: package size in cm for the real quote. */
  dims?: { alto: number; largo: number; ancho: number } | null;
  /** Correos v3 only: the branch each order is picked up at (deliveryType Sucursal / Punto de correo). */
  branches?: Array<{ orderId: string; codigoSucursal: string; sucursalNombre?: string }>;
  /** Correos v3 only: barrio per order, checked against Correos restricted zones. */
  barrios?: Array<{ orderId: string; barrio: string }>;
}

/** Correos v3 outcome → claim handling. Exported for tests. */
export function v3ClaimAction(outcome: V3GuiaOutcome): 'complete' | 'release' | 'unknown' {
  if (outcome.ok) return 'complete';
  // Not sent, or Correos answered with a refusal: nothing was registered → the order can be retried.
  if (!outcome.sent || !outcome.unknown) return 'release';
  return 'unknown';
}

const inFlightGuiaKeys = new Set<string>();

function guiaFlightKey(tenantId: string, orderId: string) {
  return `${tenantId}:${orderId}`;
}

const CORREOS_PROVIDER_ADAPTER = 'correos-provider';

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
  const tenantPrisma = getTenantPrisma(tenantId) as unknown as PrismaClient; // types only: same tenant-scoped client (avoids TS2321 depth limit)

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

  // Correos API v3 when the platform has it on and this store chose it; SOAP otherwise (unchanged).
  let v3: CorreosV3Service | null = null;
  try {
    v3 = await getCorreosV3ForWrite(settings);
  } catch (e) {
    console.warn('[GuiaService] Correos v3 selection failed, using SOAP:', e instanceof Error ? e.message : e);
  }

  let wsCreds;
  if (!v3) try {
    const resolved = await resolveCorreosWSCredentials();
    wsCreds = resolved.credentials;
    console.log(`[GuiaService] Using Correos credentials from ${resolved.source}`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Correos WS credentials are not configured.';
    console.error(`[GuiaService] Platform credentials check FAILED: ${message}`);
    return {
      results: orderIds.map(id => ({
        success: false,
        orderId: id,
        error: message,
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

  const ws = wsCreds ? new CorreosWebService(wsCreds) : null;
  const branchMap = new Map((options.branches || []).map(b => [b.orderId, b]));
  const barrioMap = new Map((options.barrios || []).map(b => [b.orderId, b.barrio]));
  const v3PesoG = Number(options.pesoG) || Number(settings.ws_default_weight_g) || 500;
  const v3Origin = settings.ws_sender_province && settings.ws_sender_canton && settings.ws_sender_district
    ? { province: settings.ws_sender_province, canton: settings.ws_sender_canton, district: settings.ws_sender_district }
    : null;
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

    const flightKey = guiaFlightKey(tenantId, order.orderId);
    if (inFlightGuiaKeys.has(flightKey)) {
      return {
        success: false,
        orderId: order.orderId,
        error: 'Esta guía ya se está generando.',
      };
    }
    inFlightGuiaKeys.add(flightKey);
    let externalClaimKey: string | null = null;

    try {
      const verified = locationMap.get(order.orderId);
      const addressData = verified ? { ...order, ...verified } : order;
      let destZip = '10101';
      let destZipResolved = false;
      // v3: every check (phone, zip, branch, restricted barrio, freight quote) runs BEFORE the claim,
      // so a fixable data problem never blocks the order.
      let v3Input: V3GuiaInput | null = null;
      let v3Prepared: Awaited<ReturnType<CorreosV3Service['prepareGuia']>> | null = null;
      const v3Branch = branchMap.get(order.orderId);
      if (v3) {
        const tipoDestino = deliveryType === 'Domicilio' ? 'DOM' : 'SUC';
        v3Input = {
          dest: {
            name: order.customerName || '',
            phone: order.phone,
            address: tipoDestino === 'DOM' ? buildFullAddress(addressData) : (addressData.address || ''),
            province: addressData.province,
            canton: addressData.canton,
            district: addressData.district,
            barrio: barrioMap.get(order.orderId) ?? null,
          },
          sender: { name: sender.name, phone: sender.phone, address: sender.address, zip: sender.zip },
          origin: v3Origin,
          pesoG: v3PesoG,
          dims: options.dims ?? null,
          tipoDestino,
          codigoSucursal: v3Branch?.codigoSucursal ?? null,
          observaciones: `${buildGuiaDescription(order as any)}`,
        };
        try {
          v3Prepared = await v3.prepareGuia(v3Input);
        } catch (prepErr) {
          return { success: false, orderId: order.orderId, error: prepErr instanceof Error ? prepErr.message : 'No se pudo validar la guía con Correos.' };
        }
        if (!v3Prepared.ok) return { success: false, orderId: order.orderId, error: v3Prepared.error };
        destZip = v3Prepared.destZip || '';
        destZipResolved = tipoDestino === 'SUC' || Boolean(v3Prepared.destZip);
      } else if (ws && addressData.province && addressData.canton && addressData.district) {
        try {
          destZip = await withTimeout(ws.getPostalCode(addressData.province, addressData.canton, addressData.district), options.timeoutMs || 12_000);
          destZipResolved = Boolean(destZip);
        } catch (geoErr: any) {
          console.warn(`[GuiaService] Could not resolve postal code for ${order.orderId}: ${geoErr.message}`);
        }
      }
      if (options.requireResolvedPostalCode && !destZipResolved) {
        return {
          success: false,
          orderId: order.orderId,
          error: 'No se pudo confirmar el código postal de la dirección. Revisá provincia, cantón y distrito.',
        };
      }

      // Correos exposes no provider idempotency key. Claim once per order
      // across UI, integration, and bot so a double-click cannot register two guías.
      if (options.adapter === 'bot' && (!options.operationKey || !useLifecycleV2)) {
        return {
          success: false,
          orderId: order.orderId,
          error: 'La generación de guía del bot no está habilitada de forma segura.',
        };
      }
      // Correos exposes no provider idempotency key. Claim once per order
      // across UI, integration, and bot so a double-click cannot register two guías.
      externalClaimKey = `correos-guia:${order.id}`;
      try {
        await globalPrisma.orderLifecycleOperation.create({
          data: {
            tenantId,
            adapter: CORREOS_PROVIDER_ADAPTER,
            operation: 'correos_guia_external_claim',
            idempotencyKey: externalClaimKey,
            orderId: order.id,
            result: { state: 'claimed', claimedAt: new Date().toISOString(), channel: options.adapter || 'tenant-guia' },
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

      if (v3 && v3Input && v3Prepared?.ok) {
        const outcome = await v3.createGuia(v3Input, v3Prepared);
        const action = v3ClaimAction(outcome);
        if (!outcome.ok) {
          if (action === 'release') {
            await globalPrisma.orderLifecycleOperation.deleteMany({
              where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: externalClaimKey },
            });
          } else {
            await globalPrisma.orderLifecycleOperation.updateMany({
              where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: externalClaimKey },
              data: { result: { state: 'provider_unknown', api: 'v3', failedAt: new Date().toISOString() } },
            });
          }
          return { success: false, orderId: order.orderId, error: outcome.error };
        }
        const guiaData: any = {
          orderId: order.orderId,
          carrier,
          guiaNumber: outcome.guiaNumber,
          trackingNumber: outcome.guiaNumber,
          status: 'completed',
          serviceType: deliveryType,
          cost: outcome.montoFlete || null,
          weight: outcome.pesoG / 1000,
          tenant: { connect: { id: tenantId } },
        };
        if (outcome.pdf) {
          guiaData.pdfData = outcome.pdf;
          guiaData.pdfFileName = `guia-${outcome.guiaNumber}.pdf`;
        }
        if (existing) {
          await tenantPrisma.shippingGuia.delete({ where: { id: existing.id } });
        }
        const created = await tenantPrisma.shippingGuia.create({ data: guiaData });
        await globalPrisma.orderLifecycleOperation.updateMany({
          where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: externalClaimKey },
          data: { result: { state: 'completed', api: 'v3', guiaNumber: outcome.guiaNumber, completedAt: new Date().toISOString() } },
        });
        try {
          await saveV3Guia({
            guiaNumber: outcome.guiaNumber,
            shippingGuiaId: created.id,
            tenantId,
            crmOrderId: order.id,
            orderNumber: order.orderId,
            environment: v3.environment,
            tipoDestino: v3Input.tipoDestino,
            codigoSucursal: v3Input.codigoSucursal,
            sucursalNombre: v3Branch?.sucursalNombre ?? null,
            zpl: outcome.zpl,
            montoFlete: outcome.montoFlete,
            pesoG: outcome.pesoG,
            destZip: outcome.destZip,
          });
        } catch (e) {
          console.warn(`[GuiaService] v3 extras not saved for ${order.orderId}:`, e instanceof Error ? e.message : e);
        }
        try {
          await markOrderShipped(order, `guia:${order.id}:${outcome.guiaNumber}`);
        } catch (e) {
          console.warn(`[GuiaService] Failed to update order status for ${order.orderId}:`, e);
        }
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
          guiaNumber: outcome.guiaNumber,
          trackingNumber: outcome.guiaNumber,
          pdfBuffer: outcome.pdf ?? undefined,
          pdfFileName: `guia-${outcome.guiaNumber}.pdf`,
        };
      }

      if (!ws) {
        return { success: false, orderId: order.orderId, error: 'Correos WS credentials are not configured.' };
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
            where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: externalClaimKey },
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
            where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: externalClaimKey },
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error inesperado al generar guía';
      console.error(`[GuiaService] Error generating guía for ${order.orderId}:`, message);
      if (externalClaimKey && (err instanceof CorreosAuthError || isCorreosCredentialRejection(message))) {
        await globalPrisma.orderLifecycleOperation.deleteMany({
          where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: externalClaimKey },
        });
      }
      return {
        success: false,
        orderId: order.orderId,
        error: message,
      };
    } finally {
      inFlightGuiaKeys.delete(flightKey);
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
