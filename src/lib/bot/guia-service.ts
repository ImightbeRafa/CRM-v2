/**
 * Shared guía generation service used by both the AI bot tools and the
 * integration API.  Encapsulates credential loading, Correos WS calls,
 * and ShippingGuia persistence so each consumer doesn't duplicate logic.
 */

import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { CorreosWebService, buildGuiaDescription, buildFullAddress, getCorreosWSCredentials } from '@/lib/correos';

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
    where: { orderId: { in: orderIds }, tenantId },
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
  const results: GuiaGenerationResult[] = [];

  for (const order of orders) {
    // Skip if guía already exists for this order
    const existing = await tenantPrisma.shippingGuia.findFirst({
      where: { orderId: order.orderId, tenantId },
    });

    if (existing && existing.status === 'completed') {
      results.push({
        success: true,
        orderId: order.orderId,
        guiaNumber: existing.guiaNumber || undefined,
        trackingNumber: existing.trackingNumber || undefined,
        pdfBuffer: existing.pdfData ? Buffer.from(existing.pdfData) : undefined,
        pdfFileName: existing.pdfFileName || `guia-${existing.guiaNumber}.pdf`,
      });
      continue;
    }

    try {
      let destZip = '10101';
      if (order.province && order.canton && order.district) {
        try {
          destZip = await ws.getPostalCode(order.province, order.canton, order.district);
        } catch (geoErr: any) {
          console.warn(`[GuiaService] Could not resolve postal code for ${order.orderId}: ${geoErr.message}`);
        }
      }

      const res = await ws.generateAndRegisterGuia({
        customerName: order.customerName || 'Destinatario',
        customerPhone: order.phone || '00000000',
        customerAddress: buildFullAddress(order),
        customerZip: destZip,
        customerApartado: destZip,
        senderName: sender.name,
        senderAddress: sender.address,
        senderZip: sender.zip,
        senderPhone: sender.phone,
        weight: 500,
        description: buildGuiaDescription(order as any),
      });

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
          serviceType: 'standard',
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

        // Update order status
        try {
          await tenantPrisma.order.update({
            where: { tenantId_orderId: { tenantId, orderId: order.orderId } },
            data: { status: 'Enviado', courier: carrier },
          });
        } catch (e) {
          console.warn(`[GuiaService] Failed to update order status for ${order.orderId}:`, e);
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

        results.push({
          success: true,
          orderId: order.orderId,
          guiaNumber: res.guiaNumber,
          trackingNumber: res.guiaNumber,
          pdfBuffer: pdfBuf,
          pdfFileName: `guia-${res.guiaNumber}.pdf`,
        });
      } else {
        results.push({
          success: false,
          orderId: order.orderId,
          error: res.error || 'Correos WS returned an error',
        });
      }
    } catch (err: any) {
      console.error(`[GuiaService] Error generating guía for ${order.orderId}:`, err.message);
      results.push({
        success: false,
        orderId: order.orderId,
        error: err.message || 'Error inesperado al generar guía',
      });
    }
  }

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
