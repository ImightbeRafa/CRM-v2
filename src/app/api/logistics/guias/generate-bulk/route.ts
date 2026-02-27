import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosAutomation, type OrderData } from '@/lib/correosAutomation';

// Configure route for Vercel deployment
export const maxDuration = 300; // 5 minutes for bulk guia generation
export const dynamic = 'force-dynamic';

interface VerifiedOrder {
    orderId: string;
    province: string;
    canton: string;
    district: string;
    address: string;
    deliveryType: 'Domicilio' | 'Sucursal' | 'Punto de correo';
}

/**
 * POST /api/logistics/guias/generate-bulk
 * 
 * Bulk-generates Correos de Costa Rica guías using the global logistics credentials.
 * Orders come with pre-verified provincia/cantón/distrito from the UI.
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

        // 1. Read global Correos credentials from lm_carrier_configs
        const credRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN ('correos_email', 'correos_password')
        `;
        const creds: Record<string, string> = {};
        for (const row of credRows) creds[row.key] = row.value;

        if (!creds.correos_email || !creds.correos_password) {
            return NextResponse.json(
                { error: 'Correos credentials not configured. Go to Configuración → Correos CR to set them up.' },
                { status: 400 }
            );
        }

        // 2. Fetch order details from DB
        const orderIds = verifiedOrders.map(o => o.orderId);
        const dbOrders = await prisma.order.findMany({
            where: { orderId: { in: orderIds } },
            select: {
                id: true,
                orderId: true,
                tenantId: true,
                customerName: true,
                phone: true,
                email: true,
                product: true,
                quantity: true,
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

        // 3. Build OrderData[] using verified values (overriding DB province/canton/district)
        const ordersData: OrderData[] = [];
        const orderMap = new Map(dbOrders.map(o => [o.orderId, o]));

        for (const verified of verifiedOrders) {
            const dbOrder = orderMap.get(verified.orderId);
            if (!dbOrder) continue;

            ordersData.push({
                orderId: dbOrder.orderId,
                customerName: dbOrder.customerName || '',
                phone: dbOrder.phone || '',
                email: dbOrder.email || undefined,
                address: verified.address || dbOrder.address || '',
                province: verified.province,
                canton: verified.canton,
                district: verified.district,
                deliveryType: verified.deliveryType || 'Domicilio',
                product: dbOrder.product || 'Paquete',
                quantity: dbOrder.quantity || 1,
                comments: dbOrder.comments || undefined,
            });
        }

        if (ordersData.length === 0) {
            return NextResponse.json({ error: 'No matching orders found in database' }, { status: 404 });
        }

        console.log(`[Logistics Guía Bulk] Starting generation for ${ordersData.length} orders...`);

        // 4. Initialize ONE automation session with global credentials
        const automation = new CorreosAutomation({
            email: creds.correos_email,
            password: creds.correos_password,
        });

        // 5. Generate guías sequentially
        const results = await automation.generateMultipleGuias(ordersData);

        // 6. Save ShippingGuia records + update lm_orders status
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
                        trackingNumber: result.trackingNumber,
                        status: 'completed',
                        serviceType: 'standard',
                        tenant: { connect: { id: dbOrder.tenantId } },
                    };

                    // Add PDF data if available
                    if (result.pdfBuffer && result.pdfFileName) {
                        const normalizedBuffer = Buffer.isBuffer(result.pdfBuffer)
                            ? result.pdfBuffer
                            : Buffer.from(result.pdfBuffer as any);
                        if (normalizedBuffer) {
                            guiaData.pdfData = normalizedBuffer;
                            guiaData.pdfFileName = result.pdfFileName;
                        }
                    }

                    const guia = await prisma.shippingGuia.create({ data: guiaData });
                    savedGuias.push(guia);

                    // Update lm_orders status
                    try {
                        await prisma.$executeRaw`
                            UPDATE lm_orders SET status = 'Guía Creada', updated_at = NOW()
                            WHERE crm_order_id = ${dbOrder.id}
                        `;
                    } catch (e) {
                        console.warn(`[Logistics Guía Bulk] Failed to update lm_orders for ${dbOrder.id}:`, e);
                    }

                    // Log event
                    try {
                        await prisma.$executeRaw`
                            INSERT INTO lm_order_events (order_id, event_type, payload)
                            VALUES (${dbOrder.id}, 'guia_generated', ${JSON.stringify({
                                carrier: 'correos',
                                guiaNumber: result.guiaNumber,
                                automated: true,
                            })}::jsonb)
                        `;
                    } catch (e) {
                        // Event logging is non-critical
                    }

                    console.log(`✓ Guía saved for ${result.orderId}: ${result.guiaNumber}`);
                } catch (error) {
                    console.error(`Failed to save guía for ${result.orderId}:`, error);
                }
            } else {
                // Failed guía — persist placeholder
                try {
                    await prisma.shippingGuia.create({
                        data: {
                            orderId: result.orderId,
                            carrier: 'correos_cr',
                            guiaNumber: `PENDING-${result.orderId}`,
                            trackingNumber: null,
                            status: 'failed',
                            errorMessage: result.error || 'Failed to create guía',
                            serviceType: 'standard',
                            tenant: { connect: { id: dbOrder.tenantId } },
                        },
                    });
                } catch (e) {
                    console.error(`Failed to save failed guía for ${result.orderId}:`, e);
                }
            }
        }

        const processingTime = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(`[Logistics Guía Bulk] Done! ${successful} successful, ${failed} failed. Time: ${processingTime}ms`);

        return NextResponse.json({
            success: true,
            data: {
                results: results.map(r => ({
                    success: r.success,
                    orderId: r.orderId,
                    guiaNumber: r.guiaNumber,
                    trackingNumber: r.trackingNumber,
                    error: r.error,
                    pdfDownloaded: r.pdfDownloaded || false,
                })),
                savedGuias: savedGuias.map(g => ({
                    id: g.id,
                    orderId: g.orderId,
                    guiaNumber: g.guiaNumber,
                    hasPdf: !!g.pdfData,
                })),
                successful,
                failed,
            },
            processingTime,
        });
    } catch (error: any) {
        const processingTime = Date.now() - startTime;
        console.error('[Logistics Guía Bulk] Error:', error);
        return NextResponse.json(
            { error: 'Failed to generate guías', message: error.message || 'Unknown error', processingTime },
            { status: 500 }
        );
    }
}
