import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface VerifiedOrder {
    orderId: string;
    province: string;
    canton: string;
    district: string;
    address: string;
    deliveryType: 'Domicilio' | 'Sucursal' | 'Punto de correo';
}

/** Messages from the Correos API are safe to surface to admin users. */
function isCorreosError(msg: string): boolean {
    return /^ccr(GenerarGuia|RegistroEnvio|Tarifa) failed:/.test(msg);
}

/**
 * POST /api/logistics/guias/generate-bulk
 *
 * Bulk-generates Correos de Costa Rica guías via the SOAP Web Service API.
 */
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const startTime = Date.now();

    try {
        const body = await req.json();
        const { orders: verifiedOrders } = body as { orders: VerifiedOrder[] };

        if (!verifiedOrders || !Array.isArray(verifiedOrders) || verifiedOrders.length === 0) {
            return NextResponse.json({ error: 'orders array is required' }, { status: 400 });
        }

        // 1. Read ALL Correos config keys
        const credRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key LIKE 'correos_%'
        `;
        const cfg: Record<string, string> = {};
        for (const row of credRows) cfg[row.key] = row.value;

        // 2. Fetch order details from DB
        const orderIds = verifiedOrders.map(o => o.orderId);
        const dbOrders = await prisma.order.findMany({
            where: { orderId: { in: orderIds } },
            select: {
                id: true, orderId: true, tenantId: true, customerName: true,
                phone: true, email: true, product: true, quantity: true,
                province: true, canton: true, district: true, address: true, comments: true,
            },
        });

        if (dbOrders.length === 0) {
            return NextResponse.json({ error: 'No valid orders found' }, { status: 404 });
        }

        const orderMap = new Map(dbOrders.map(o => [o.orderId, o]));

        if (!cfg.correos_ws_username || !cfg.correos_ws_password) {
            return NextResponse.json(
                { error: 'Correos Web Service credentials not configured. Go to Configuración → Correos CR to set them up.' },
                { status: 400 }
            );
        }

        const wsCreds: CorreosWSCredentials = {
            username: cfg.correos_ws_username,
            password: cfg.correos_ws_password,
            sistema: cfg.correos_ws_sistema || 'PYMEXPRESS',
            usuarioId: Number(cfg.correos_ws_usuario_id) || 0,
            servicioId: Number(cfg.correos_ws_servicio_id) || 0,
            codCliente: cfg.correos_ws_cod_cliente || '',
        };

        const sender = {
            name: cfg.correos_ws_sender_name || '',
            address: cfg.correos_ws_sender_address || '',
            zip: cfg.correos_ws_sender_zip || '10101',
            phone: cfg.correos_ws_sender_phone || '00000000',
        };

        const ws = new CorreosWebService(wsCreds);
        const results: { success: boolean; orderId: string; guiaNumber?: string; error?: string; pdfBuffer?: Buffer }[] = [];

        console.log(`[Logistics Guía Bulk WS] Starting generation for ${verifiedOrders.length} orders...`);

        for (const verified of verifiedOrders) {
            const dbOrder = orderMap.get(verified.orderId);
            if (!dbOrder) continue;

            try {
                let destZip = '10101';
                try {
                    destZip = await ws.getPostalCode(verified.province, verified.canton, verified.district);
                    console.log(`[WS] Postal code resolved: ${verified.province}/${verified.canton}/${verified.district} → ${destZip}`);
                } catch (geoErr: any) {
                    console.warn(`[WS] Could not resolve postal code for ${verified.province}/${verified.canton}/${verified.district}: ${geoErr.message}`);
                }

                console.log(`[WS] Generating guía for ${verified.orderId} (zip: ${destZip})...`);

                const result = await ws.generateAndRegisterGuia({
                    customerName: dbOrder.customerName || 'Destinatario',
                    customerPhone: dbOrder.phone || '00000000',
                    customerAddress: verified.address || dbOrder.address || 'Sin dirección',
                    customerZip: destZip,
                    customerApartado: destZip,
                    senderName: sender.name,
                    senderAddress: sender.address,
                    senderZip: sender.zip,
                    senderPhone: sender.phone,
                    weight: 500,
                    description: dbOrder.product || dbOrder.comments || 'Paquete',
                });

                console.log(`[WS] Guía result for ${verified.orderId}: success=${result.success}, guia=${result.guiaNumber}, msg=${result.responseMessage}`);

                results.push({
                    success: result.success,
                    orderId: verified.orderId,
                    guiaNumber: result.guiaNumber || undefined,
                    error: result.error,
                    pdfBuffer: result.pdfBuffer,
                });
            } catch (err: any) {
                console.error(`[WS] Exception generating guía for ${verified.orderId}:`, err.message);
                const safeMsg = isCorreosError(err.message)
                    ? err.message
                    : 'Guía generation failed due to a connection or service error';
                results.push({
                    success: false,
                    orderId: verified.orderId,
                    error: safeMsg,
                });
            }
        }

        const savedGuias = await persistGuiaResults(results, orderMap);
        const processingTime = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(`[Logistics Guía Bulk WS] Done! ${successful} ok, ${failed} failed. ${processingTime}ms`);

        return NextResponse.json({
            success: true,
            data: {
                results: results.map(r => ({
                    success: r.success,
                    orderId: r.orderId,
                    guiaNumber: r.guiaNumber,
                    error: r.error,
                    pdfDownloaded: !!r.pdfBuffer,
                })),
                savedGuias: savedGuias.map(g => ({ id: g.id, orderId: g.orderId, guiaNumber: g.guiaNumber, hasPdf: !!g.pdfData })),
                successful,
                failed,
            },
            processingTime,
        });
    } catch (error: any) {
        const processingTime = Date.now() - startTime;
        console.error('[Logistics Guía Bulk] Error:', error);
        return NextResponse.json(
            { error: 'Failed to generate guías', processingTime },
            { status: 500 }
        );
    }
}

// ─── Shared: persist guía results regardless of mode ────────────────────────

async function persistGuiaResults(
    results: { success: boolean; orderId: string; guiaNumber?: string; error?: string; pdfBuffer?: Buffer; pdfFileName?: string }[],
    orderMap: Map<string, { id: string; tenantId: string; orderId: string }>
) {
    const savedGuias = [];

    for (const result of results) {
        const dbOrder = orderMap.get(result.orderId);
        if (!dbOrder) continue;

        if (result.success && result.guiaNumber) {
            try {
                const guiaData: any = {
                    orderId: result.orderId,
                    carrier: 'correos_cr',
                    guiaNumber: result.guiaNumber,
                    trackingNumber: result.guiaNumber,
                    status: 'completed',
                    serviceType: 'standard',
                    tenant: { connect: { id: dbOrder.tenantId } },
                };

                if (result.pdfBuffer) {
                    const buf = Buffer.isBuffer(result.pdfBuffer) ? result.pdfBuffer : Buffer.from(result.pdfBuffer as any);
                    guiaData.pdfData = buf;
                    guiaData.pdfFileName = result.pdfFileName || `guia-${result.guiaNumber}.pdf`;
                }

                const guia = await prisma.shippingGuia.create({ data: guiaData });
                savedGuias.push(guia);

                try {
                    await prisma.$executeRaw`
                        INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
                        VALUES (${dbOrder.id}, ${dbOrder.tenantId}, 'correos', 'Guía Creada')
                        ON CONFLICT (crm_order_id) DO UPDATE
                        SET carrier = 'correos', status = 'Guía Creada', updated_at = NOW()
                    `;
                } catch (e) {
                    console.warn(`[Guía Persist] Failed to upsert lm_orders for ${dbOrder.id}:`, e);
                }

                try {
                    await prisma.$executeRaw`
                        INSERT INTO lm_order_events (crm_order_id, event_type, payload)
                        VALUES (${dbOrder.id}, 'guia_generated', ${JSON.stringify({
                            carrier: 'correos',
                            guiaNumber: result.guiaNumber,
                            automated: true,
                        })}::jsonb)
                    `;
                } catch { /* non-critical */ }

                console.log(`[Guía] Saved ${result.orderId}: ${result.guiaNumber}`);
            } catch (error) {
                console.error(`[Guía] Failed to save for ${result.orderId}:`, error);
            }
        } else {
            try {
                await prisma.shippingGuia.create({
                    data: {
                        orderId: result.orderId,
                        carrier: 'correos_cr',
                        guiaNumber: `PENDING-${result.orderId}`,
                        status: 'failed',
                        errorMessage: result.error || 'Failed to create guía',
                        serviceType: 'standard',
                        tenant: { connect: { id: dbOrder.tenantId } },
                    },
                });
            } catch (e) {
                console.error(`[Guía] Failed to save failed record for ${result.orderId}:`, e);
            }
        }
    }

    return savedGuias;
}
