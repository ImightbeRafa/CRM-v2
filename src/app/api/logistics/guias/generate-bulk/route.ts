import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService, buildGuiaDescription, buildFullAddress } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';
import { Prisma } from '@prisma/client';
import { resolveV3Config } from '@/lib/correos/v3/config';
import { getCorreosV3ForWrite } from '@/lib/correos/v3/select';
import { saveV3Guia } from '@/lib/correos/v3/store';
import { loadTenantCorreosSettings } from '@/lib/correos/v3/tenant';
import type { V3GuiaInput } from '@/lib/correos/v3/service';
import { v3ClaimAction } from '@/lib/shipping/guia-service';
import { formatGuiaFailureLabel } from '@/lib/correos/auth-error';

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
    /** Correos v3 only */
    barrio?: string;
    pesoG?: number;
    codigoSucursal?: string;
    sucursalNombre?: string;
}

interface GuiaResult {
    success: boolean;
    orderId: string;
    orderDbId: string;
    guiaNumber?: string;
    error?: string;
    pdfBuffer?: Buffer;
    pdfFileName?: string;
    /** Answer came from an existing claim/guía: nothing new to persist. */
    reused?: boolean;
}

const CORREOS_PROVIDER_ADAPTER = 'correos-provider';

type ClaimResult = { state: 'claimed' } | { state: 'existing'; guiaNumber?: string } | { state: 'busy' };

/** The once-per-order Correos claim shared with src/lib/shipping/guia-service.ts and the staff bot. */
async function claimCorreosGuia(order: { id: string; orderId: string; tenantId: string }, key: string): Promise<ClaimResult> {
    // A completed Correos guía from before the claim existed (or from another screen) is reused, never re-registered.
    const done = await prisma.shippingGuia.findFirst({
        where: { tenantId: order.tenantId, orderId: order.orderId, status: 'completed', carrier: { contains: 'correos' }, guiaNumber: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { guiaNumber: true },
    });
    if (done) return { state: 'existing', guiaNumber: done.guiaNumber ?? undefined };
    try {
        await prisma.orderLifecycleOperation.create({
            data: {
                tenantId: order.tenantId,
                adapter: CORREOS_PROVIDER_ADAPTER,
                operation: 'correos_guia_external_claim',
                idempotencyKey: key,
                orderId: order.id,
                result: { state: 'claimed', claimedAt: new Date().toISOString(), channel: 'logistics-bulk' },
            },
        });
        return { state: 'claimed' };
    } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        const completed = await prisma.shippingGuia.findFirst({
            where: { tenantId: order.tenantId, orderId: order.orderId, status: 'completed', guiaNumber: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { guiaNumber: true },
        });
        if (completed) return { state: 'existing', guiaNumber: completed.guiaNumber ?? undefined };
        // provider_failed = Correos answered with an error, nothing was registered: safe to take over.
        const taken = await prisma.orderLifecycleOperation.updateMany({
            where: {
                tenantId: order.tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: key,
                result: { path: ['state'], equals: 'provider_failed' },
            },
            data: { result: { state: 'claimed', claimedAt: new Date().toISOString(), channel: 'logistics-bulk', retake: true } },
        });
        return taken.count > 0 ? { state: 'claimed' } : { state: 'busy' };
    }
}

async function settleClaim(tenantId: string, key: string, result: Prisma.InputJsonValue) {
    await prisma.orderLifecycleOperation.updateMany({
        where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: key },
        data: { result },
    });
}

async function releaseClaim(tenantId: string, key: string) {
    await prisma.orderLifecycleOperation.deleteMany({
        where: { tenantId, adapter: CORREOS_PROVIDER_ADAPTER, idempotencyKey: key },
    }).catch(() => {});
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

        const v3Platform = await resolveV3Config().catch(() => null);
        const hasSoap = !!(cfg.correos_ws_username && cfg.correos_ws_password);
        if (!hasSoap && !v3Platform?.enabled) {
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

        const ws = hasSoap ? new CorreosWebService(wsCreds) : null;
        const results: GuiaResult[] = [];
        const v3Extras = new Map<string, Omit<Parameters<typeof saveV3Guia>[0], 'guiaNumber' | 'shippingGuiaId'>>();
        // Per store: Correos v3 when the platform has it on and the store chose it.
        const tenantSettings = new Map<string, Record<string, any>>();
        const v3For = async (tenantId: string) => {
            if (!tenantSettings.has(tenantId)) tenantSettings.set(tenantId, await loadTenantCorreosSettings(tenantId).catch(() => ({})));
            const settings = tenantSettings.get(tenantId)!;
            return { v3: await getCorreosV3ForWrite(settings, tenantId).catch(() => null), settings };
        };

        console.log(`[Logistics Guia WS] Starting generation for ${verifiedOrders.length} orders...`);

        const savedGuias: Awaited<ReturnType<typeof persistGuiaResults>> = [];
        for (const verified of verifiedOrders) {
            const before = results.length;
            // One order at a time, each saved as soon as Correos answered: a later failure in the chunk
            // can never lose an earlier guía's PDF / ZPL (verifier #7).
            await (async () => {
                const dbOrder = orderMap.get(verified.id || verified.orderId);
                if (!dbOrder) return;

                // Same once-per-order claim as the store flow and the staff bot (correos-guia:<Order.id>),
                // so this screen can never register a second Correos guía for an order.
                const claimKey = `correos-guia:${dbOrder.id}`;
                const claim = await claimCorreosGuia(dbOrder, claimKey);
                if (claim.state === 'existing') {
                    results.push({ success: true, orderId: dbOrder.orderId, orderDbId: dbOrder.id, guiaNumber: claim.guiaNumber, reused: true });
                    return;
                }
                if (claim.state === 'busy') {
                    results.push({ success: false, orderId: dbOrder.orderId, orderDbId: dbOrder.id, error: 'La guía está en proceso o requiere reconciliación. Revisala antes de reintentar.', reused: true });
                    return;
                }

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
                } catch {
                    await releaseClaim(dbOrder.tenantId, claimKey);
                    results.push({ success: false, orderId: dbOrder.orderId, orderDbId: dbOrder.id, error: 'No se pudo guardar la dirección verificada.' });
                    return;
                }

                const { v3, settings } = await v3For(dbOrder.tenantId);
                if (v3) {
                    const tipoDestino = verified.deliveryType === 'Domicilio' || !verified.deliveryType ? 'DOM' : 'SUC';
                    const input: V3GuiaInput = {
                        dest: {
                            name: dbOrder.customerName || '', phone: dbOrder.phone,
                            address: tipoDestino === 'DOM'
                                ? buildFullAddress({ province: verified.province, canton: verified.canton, district: verified.district, address: verified.address || dbOrder.address })
                                : (verified.address || dbOrder.address || ''),
                            province: verified.province, canton: verified.canton, district: verified.district, barrio: verified.barrio ?? null,
                        },
                        sender: { name: sender.name, phone: sender.phone, address: sender.address, zip: sender.zip },
                        // The label's sender is the logistics warehouse, not the store: no store-origin quote here.
                        origin: null,
                        pesoG: Number(verified.pesoG) || Number(settings.ws_default_weight_g) || 500,
                        tipoDestino,
                        codigoSucursal: verified.codigoSucursal ?? null,
                        observaciones: buildGuiaDescription(dbOrder),
                    };
                    const outcome = await v3.createGuia(input);
                    const action = v3ClaimAction(outcome);
                    if (outcome.ok) {
                        await settleClaim(dbOrder.tenantId, claimKey, { state: 'completed', api: 'v3', guiaNumber: outcome.guiaNumber, completedAt: new Date().toISOString() })
                            .catch((e) => console.warn(`[Logistics Guia] claim not settled for ${dbOrder.orderId}:`, e instanceof Error ? e.message : e));
                        results.push({ success: true, orderId: dbOrder.orderId, orderDbId: dbOrder.id, guiaNumber: outcome.guiaNumber, pdfBuffer: outcome.pdf ?? undefined });
                        v3Extras.set(outcome.guiaNumber, {
                            tenantId: dbOrder.tenantId, crmOrderId: dbOrder.id, orderNumber: dbOrder.orderId, environment: v3.environment,
                            tipoDestino, codigoSucursal: verified.codigoSucursal ?? null, sucursalNombre: verified.sucursalNombre ?? null,
                            zpl: outcome.zpl, montoFlete: outcome.montoFlete, pesoG: outcome.pesoG, destZip: outcome.destZip,
                        });
                    } else {
                        if (action === 'release') await releaseClaim(dbOrder.tenantId, claimKey);
                        else await settleClaim(dbOrder.tenantId, claimKey, { state: 'provider_unknown', api: 'v3', failedAt: new Date().toISOString() });
                        results.push({ success: false, orderId: dbOrder.orderId, orderDbId: dbOrder.id, error: outcome.error });
                    }
                    return;
                }
                if (!ws) {
                    await releaseClaim(dbOrder.tenantId, claimKey);
                    results.push({ success: false, orderId: dbOrder.orderId, orderDbId: dbOrder.id, error: 'Correos Web Service credentials not configured.' });
                    return;
                }

                try {
                    let destZip = '10101';
                    try {
                        destZip = await ws.getPostalCode(verified.province, verified.canton, verified.district);
                        console.log(`[WS] Postal code resolved: ${verified.province}/${verified.canton}/${verified.district} -> ${destZip}`);
                    } catch (geoErr: any) {
                        console.warn(`[WS] Could not resolve postal code for ${verified.province}/${verified.canton}/${verified.district}: ${geoErr.message}`);
                    }

                    // Login first: a rejected password / relay down is "not sent" → release, never lock (verifier #1).
                    try {
                        await ws.getSoapClient().getTokenManager().getToken();
                    } catch (authErr) {
                        await releaseClaim(dbOrder.tenantId, claimKey);
                        results.push({ success: false, orderId: dbOrder.orderId, orderDbId: dbOrder.id, error: formatGuiaFailureLabel(authErr instanceof Error ? authErr.message : String(authErr)) });
                        return;
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

                    if (result.success && result.guiaNumber) {
                        await settleClaim(dbOrder.tenantId, claimKey, { state: 'completed', guiaNumber: result.guiaNumber, completedAt: new Date().toISOString() })
                            .catch((e) => console.warn(`[Logistics Guia] claim not settled for ${dbOrder.orderId}:`, e instanceof Error ? e.message : e));
                    } else {
                        // Correos answered with an error code: nothing registered, the order can be retried.
                        await releaseClaim(dbOrder.tenantId, claimKey);
                    }
                    results.push({
                        success: result.success,
                        orderId: dbOrder.orderId,
                        orderDbId: dbOrder.id,
                        guiaNumber: result.guiaNumber || undefined,
                        error: result.error,
                        pdfBuffer: result.pdfBuffer,
                    });
                } catch (err: any) {
                    // Thrown mid-call (network / timeout): Correos may have registered it → keep the claim.
                    await settleClaim(dbOrder.tenantId, claimKey, { state: 'provider_unknown', failedAt: new Date().toISOString() }).catch(() => {});
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
            })().catch((err: unknown) => {
                console.error(`[Logistics Guia] order ${verified.orderId} failed:`, err instanceof Error ? err.message : err);
                if (results.length === before) {
                    results.push({ success: false, orderId: verified.orderId, orderDbId: verified.id || '', error: 'Error inesperado: revisá esta orden antes de reintentar.' });
                }
            });
            const fresh = results.slice(before).filter(r => !r.reused);
            if (fresh.length === 0) continue;
            const saved = await persistGuiaResults(fresh, orderMap);
            savedGuias.push(...saved);
            for (const g of saved) {
                const extra = g.guiaNumber ? v3Extras.get(g.guiaNumber) : undefined;
                if (extra && g.guiaNumber) {
                    await saveV3Guia({ ...extra, guiaNumber: g.guiaNumber, shippingGuiaId: g.id }).catch((e) => {
                        console.warn(`[Logistics Guia] v3 extras not saved for ${g.guiaNumber}:`, e instanceof Error ? e.message : e);
                    });
                }
            }
        }

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
