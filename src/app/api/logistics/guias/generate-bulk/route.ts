import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService, buildGuiaDescription, buildFullAddress } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface VerifiedOrder {
    id?: string;
    orderId: string;
    province: string;
    canton: string;
    district: string;
    address: string;
    deliveryType: 'Domicilio' | 'Sucursal' | 'Punto de correo';
}

interface GuiaResult {
    success: boolean;
    orderId: string;
    orderDbId: string;
    guiaNumber?: string;
    error?: string;
    pdfBuffer?: Buffer;
    pdfFileName?: string;
}

type DbOrder = {
    id: string;
    orderId: string;
    tenantId: string;
    customerName: string;
    phone: string | null;
    email: string | null;
    product: string | null;
    quantity: number;
    productDetails: string | null;
    province: string | null;
    canton: string | null;
    district: string | null;
    address: string | null;
    comments: string | null;
};

/** Messages from the Correos API are safe to surface to admin users. */
function isCorreosError(msg: string): boolean {
    return /^ccr(GenerarGuia|RegistroEnvio|Tarifa) failed:/.test(msg);
}

/**
 * POST /api/logistics/guias/generate-bulk
 *
 * Generates Correos de Costa Rica guias via the SOAP Web Service API.
 * Persistence is intentionally one-current-guia-per-order: regenerating a guia
 * updates the current row and removes stale duplicate rows for that order.
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

        const requestKeys = new Set<string>();
        for (const order of verifiedOrders) {
            const key = order.id || order.orderId;
            if (!key) {
                return NextResponse.json({ error: 'Each order requires id or orderId' }, { status: 400 });
            }
            if (requestKeys.has(key)) {
                return NextResponse.json({ error: `Duplicate order in request: ${order.orderId}` }, { status: 400 });
            }
            requestKeys.add(key);
        }

        const credRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key LIKE 'correos_%'
        `;
        const cfg: Record<string, string> = {};
        for (const row of credRows) cfg[row.key] = row.value;

        if (!cfg.correos_ws_username || !cfg.correos_ws_password) {
            return NextResponse.json(
                { error: 'Correos Web Service credentials not configured. Go to Configuracion -> Correos CR to set them up.' },
                { status: 400 }
            );
        }

        const crmOrderIds = verifiedOrders
            .map(o => o.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const orderIds = verifiedOrders.map(o => o.orderId);

        const dbOrders = await prisma.order.findMany({
            where: crmOrderIds.length > 0
                ? { OR: [{ id: { in: crmOrderIds } }, { orderId: { in: orderIds } }] }
                : { orderId: { in: orderIds } },
            select: {
                id: true,
                orderId: true,
                tenantId: true,
                customerName: true,
                phone: true,
                email: true,
                product: true,
                quantity: true,
                productDetails: true,
                province: true,
                canton: true,
                district: true,
                address: true,
                comments: true,
            },
        });

        if (dbOrders.length === 0) {
            return NextResponse.json({ error: 'No valid orders found' }, { status: 404 });
        }

        const orderMap = new Map<string, DbOrder>();
        for (const order of dbOrders) {
            orderMap.set(order.id, order);
            orderMap.set(order.orderId, order);
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
        const results: GuiaResult[] = [];

        console.log(`[Logistics Guia WS] Starting generation for ${verifiedOrders.length} orders...`);

        for (const verified of verifiedOrders) {
            const dbOrder = orderMap.get(verified.id || verified.orderId);
            if (!dbOrder) continue;

            try {
                await prisma.order.update({
                    where: { id: dbOrder.id },
                    data: {
                        province: verified.province,
                        canton: verified.canton,
                        district: verified.district,
                        address: verified.address || dbOrder.address,
                    },
                });

                let destZip = '10101';
                try {
                    destZip = await ws.getPostalCode(verified.province, verified.canton, verified.district);
                    console.log(`[WS] Postal code resolved: ${verified.province}/${verified.canton}/${verified.district} -> ${destZip}`);
                } catch (geoErr: any) {
                    console.warn(`[WS] Could not resolve postal code for ${verified.province}/${verified.canton}/${verified.district}: ${geoErr.message}`);
                }

                const result = await ws.generateAndRegisterGuia({
                    customerName: dbOrder.customerName || 'Destinatario',
                    customerPhone: dbOrder.phone || '00000000',
                    customerAddress: buildFullAddress({
                        province: verified.province,
                        canton: verified.canton,
                        district: verified.district,
                        address: verified.address || dbOrder.address,
                    }),
                    customerZip: destZip,
                    customerApartado: destZip,
                    senderName: sender.name,
                    senderAddress: sender.address,
                    senderZip: sender.zip,
                    senderPhone: sender.phone,
                    weight: 500,
                    description: buildGuiaDescription(dbOrder),
                });

                results.push({
                    success: result.success,
                    orderId: dbOrder.orderId,
                    orderDbId: dbOrder.id,
                    guiaNumber: result.guiaNumber || undefined,
                    error: result.error,
                    pdfBuffer: result.pdfBuffer,
                });
            } catch (err: any) {
                const safeMsg = isCorreosError(err.message)
                    ? err.message
                    : 'Guia generation failed due to a connection or service error';
                results.push({
                    success: false,
                    orderId: dbOrder.orderId,
                    orderDbId: dbOrder.id,
                    error: safeMsg,
                });
            }
        }

        const savedGuias = await persistGuiaResults(results, orderMap);
        const processingTime = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        return NextResponse.json({
            success: true,
            data: {
                results: results.map(r => ({
                    success: r.success,
                    orderId: r.orderId,
                    guiaNumber: r.guiaNumber,
                    trackingNumber: r.guiaNumber,
                    error: r.error,
                    pdfDownloaded: !!r.pdfBuffer,
                })),
                savedGuias: savedGuias.map(g => ({
                    id: g.id,
                    orderId: g.orderId,
                    guiaNumber: g.guiaNumber,
                    trackingNumber: g.trackingNumber,
                    status: g.status,
                    hasPdf: !!g.pdfData,
                })),
                successful,
                failed,
            },
            processingTime,
        });
    } catch (error: any) {
        const processingTime = Date.now() - startTime;
        console.error('[Logistics Guia] Error:', error);
        return NextResponse.json(
            { error: 'Failed to generate guias', processingTime },
            { status: 500 }
        );
    }
}

async function persistGuiaResults(results: GuiaResult[], orderMap: Map<string, DbOrder>) {
    const savedGuias = [];

    for (const result of results) {
        const dbOrder = orderMap.get(result.orderDbId) || orderMap.get(result.orderId);
        if (!dbOrder) continue;

        try {
            const guia = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`
                    SELECT pg_advisory_xact_lock(hashtext(${`${dbOrder.tenantId}:${dbOrder.orderId}:shipping-guia`}))
                `;

                const existingGuias = await tx.shippingGuia.findMany({
                    where: {
                        tenantId: dbOrder.tenantId,
                        orderId: dbOrder.orderId,
                        carrier: 'correos_cr',
                    },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true },
                });

                const currentGuia = existingGuias[0] ?? null;
                const duplicateIds = existingGuias.slice(1).map(g => g.id);
                if (duplicateIds.length > 0) {
                    await tx.shippingGuia.deleteMany({ where: { id: { in: duplicateIds } } });
                }

                if (result.success && result.guiaNumber) {
                    const data: any = {
                        orderId: dbOrder.orderId,
                        carrier: 'correos_cr',
                        guiaNumber: result.guiaNumber,
                        trackingNumber: result.guiaNumber,
                        status: 'completed',
                        progress: null,
                        errorMessage: null,
                        serviceType: 'standard',
                    };

                    if (result.pdfBuffer) {
                        const buf = Buffer.isBuffer(result.pdfBuffer) ? result.pdfBuffer : Buffer.from(result.pdfBuffer as any);
                        data.pdfData = buf;
                        data.pdfFileName = result.pdfFileName || `guia-${result.guiaNumber}.pdf`;
                    }

                    return currentGuia
                        ? tx.shippingGuia.update({ where: { id: currentGuia.id }, data })
                        : tx.shippingGuia.create({ data: { ...data, tenant: { connect: { id: dbOrder.tenantId } } } });
                }

                const failedData = {
                    carrier: 'correos_cr',
                    status: 'failed',
                    progress: null,
                    errorMessage: result.error || 'Failed to create guia',
                    serviceType: 'standard',
                };

                return currentGuia
                    ? tx.shippingGuia.update({ where: { id: currentGuia.id }, data: failedData })
                    : tx.shippingGuia.create({
                        data: {
                            ...failedData,
                            orderId: dbOrder.orderId,
                            tenant: { connect: { id: dbOrder.tenantId } },
                        },
                    });
            });

            savedGuias.push(guia);

            const nextStatus = result.success && result.guiaNumber ? 'Guía Creada' : 'Pendiente';
            try {
                await prisma.$executeRaw`
                    INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
                    VALUES (${dbOrder.id}, ${dbOrder.tenantId}, 'correos', ${nextStatus})
                    ON CONFLICT (crm_order_id) DO UPDATE
                    SET carrier = 'correos', status = ${nextStatus}, updated_at = NOW()
                `;
            } catch (e) {
                console.warn(`[Guia Persist] Failed to upsert lm_orders for ${dbOrder.id}:`, e);
            }

            try {
                await prisma.$executeRaw`
                    INSERT INTO lm_order_events (crm_order_id, event_type, payload)
                    VALUES (${dbOrder.id}, 'guia_generated', ${JSON.stringify({
                        carrier: 'correos',
                        guiaNumber: result.guiaNumber,
                        success: result.success,
                        error: result.error,
                        automated: true,
                        replacedExisting: true,
                    })}::jsonb)
                `;
            } catch {
                // Non-critical audit trail.
            }
        } catch (error) {
            console.error(`[Guia] Failed to persist current guia for ${result.orderId}:`, error);
        }
    }

    return savedGuias;
}
