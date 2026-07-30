import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { pickupLocationLabel } from '@/lib/retiro-stock';
import {
  generateRetiroReceiptPdf,
  type RetiroReceiptPaymentMethod,
} from '@/lib/pdf/retiroReceiptPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same managed-tenant allowlist used by /api/logistics/orders. */
const MANAGED_TENANT_IDS = [
  'cmh32z0ol0000k004hvx9tg3p',
  'cmhsibjue0004js04gie724nx',
  'cmhutd1th0000jp04oqibtz54',
  'cmigornmw0000lb04kl75262e',
  'cmjdabz4d0000il04dyc5qmcc',
  'cmln5u7k70000ld042qify2og',
  'cmh44aerw0006vijg0640vfl0',
  'cmm4pv8fl0000jr045en1nik9',
];

function sanitizeFilename(value: string): string {
  return String(value || 'retiro')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'retiro';
}

function notFound() {
  return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
}

// GET /api/logistics/retiros/receipt/[orderId]
// orderId param = internal CRM Order.id (cuid), not the business orderRef.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const { orderId: rawId } = await ctx.params;
    const orderId = decodeURIComponent(rawId || '').trim();
    if (!orderId || orderId.length > 128) {
      return NextResponse.json({ error: 'orderId requerido' }, { status: 400 });
    }

    // Internal id only + exact RA + managed tenants (prevents cross-tenant orderId collisions).
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        orderType: 'RA',
        tenantId: { in: MANAGED_TENANT_IDS },
      },
      select: {
        id: true,
        orderId: true,
        customerName: true,
        phone: true,
        product: true,
        quantity: true,
        productDetails: true,
        total: true,
        seller: true,
        comments: true,
        status: true,
        delivery: true,
        agreedDate: true,
        pickupDate: true,
        timestamp: true,
        contraEntrega: true,
        cePaymentConfirmed: true,
      },
    });

    if (!order) return notFound();

    // Read-only metadata — no ensureRetiroStockTables / DDL on the hot path.
    const [lmRows, ceRows, handoffRows] = await Promise.all([
      prisma.$queryRaw<{
        status: string | null;
        is_contra_entrega: boolean | null;
        contraentrega_collected: boolean | null;
      }[]>`
        SELECT status, is_contra_entrega, contraentrega_collected
        FROM lm_orders
        WHERE crm_order_id = ${order.id}
        LIMIT 1
      `.catch(() => [] as {
        status: string | null;
        is_contra_entrega: boolean | null;
        contraentrega_collected: boolean | null;
      }[]),
      prisma.$queryRaw<{ payment_method: string | null }[]>`
        SELECT payment_method
        FROM lm_ce_payments
        WHERE crm_order_id = ${order.id}
        ORDER BY collected_at DESC NULLS LAST
        LIMIT 1
      `.catch(() => [] as { payment_method: string | null }[]),
      prisma.$queryRaw<{
        scheduled_at: Date | null;
        handed_by_name: string | null;
        pickup_location: string | null;
      }[]>`
        SELECT scheduled_at, handed_by_name, pickup_location
        FROM lm_retiro_handoffs
        WHERE crm_order_id = ${order.id}
        LIMIT 1
      `.catch(() => [] as {
        scheduled_at: Date | null;
        handed_by_name: string | null;
        pickup_location: string | null;
      }[]),
    ]);

    const lm = lmRows[0];
    const isContraEntrega = Boolean(order.contraEntrega) || Boolean(lm?.is_contra_entrega);
    let paymentCollected = Boolean(order.cePaymentConfirmed) || Boolean(lm?.contraentrega_collected);
    let paymentMethod: RetiroReceiptPaymentMethod = null;

    const method = ceRows[0]?.payment_method?.toLowerCase();
    if (method === 'sinpe' || method === 'efectivo') {
      paymentMethod = method;
      paymentCollected = true;
    }

    const handoff = handoffRows[0];
    const scheduledAt = handoff?.scheduled_at
      ? new Date(handoff.scheduled_at).toISOString()
      : null;
    const pickupLoc = handoff?.pickup_location || null;

    const pdf = await generateRetiroReceiptPdf({
      orderRef: order.orderId,
      customerName: order.customerName,
      phone: order.phone,
      product: order.product,
      quantity: order.quantity,
      productDetails: order.productDetails,
      total: Number(order.total) || 0,
      seller: order.seller,
      comments: order.comments,
      status: lm?.status || order.delivery || order.status || 'Pendiente',
      agreedDate: order.agreedDate,
      pickupDate: order.pickupDate,
      scheduledAt,
      createdAt: order.timestamp,
      isContraEntrega,
      paymentCollected,
      paymentMethod,
      pickupLocationLabel: pickupLocationLabel(pickupLoc),
      handedByName: handoff?.handed_by_name || null,
    });

    const filename = `retiro-${sanitizeFilename(order.orderId)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[retiros/receipt GET]', error);
    return NextResponse.json({ error: 'No se pudo generar el PDF del retiro' }, { status: 500 });
  }
}
