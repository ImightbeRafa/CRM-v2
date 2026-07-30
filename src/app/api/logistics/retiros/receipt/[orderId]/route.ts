import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getHandoffsForOrders, pickupLocationLabel } from '@/lib/retiro-stock';
import {
  generateRetiroReceiptPdf,
  type RetiroReceiptPaymentMethod,
} from '@/lib/pdf/retiroReceiptPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeFilename(value: string): string {
  return String(value || 'retiro')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'retiro';
}

// GET /api/logistics/retiros/receipt/[orderId]
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const { orderId: rawId } = await ctx.params;
    const orderId = decodeURIComponent(rawId || '').trim();
    if (!orderId) {
      return NextResponse.json({ error: 'orderId requerido' }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderId }],
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
        orderType: true,
        contraEntrega: true,
        cePaymentConfirmed: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
    }

    if (order.orderType && order.orderType !== 'RA') {
      return NextResponse.json({ error: 'La orden no es un retiro (RA)' }, { status: 400 });
    }

    let lmStatus: string | null = null;
    let isContraEntrega = Boolean(order.contraEntrega);
    let paymentCollected = Boolean(order.cePaymentConfirmed);
    let paymentMethod: RetiroReceiptPaymentMethod = null;

    try {
      const lmRows = await prisma.$queryRaw<{
        status: string | null;
        is_contra_entrega: boolean | null;
        contraentrega_collected: boolean | null;
      }[]>`
        SELECT status, is_contra_entrega, contraentrega_collected
        FROM lm_orders
        WHERE crm_order_id = ${order.id}
        LIMIT 1
      `;
      if (lmRows[0]) {
        lmStatus = lmRows[0].status;
        isContraEntrega = isContraEntrega || Boolean(lmRows[0].is_contra_entrega);
        paymentCollected = paymentCollected || Boolean(lmRows[0].contraentrega_collected);
      }
    } catch {
      // lm_orders may be unavailable
    }

    try {
      const ceRows = await prisma.$queryRaw<{ payment_method: string | null }[]>`
        SELECT payment_method
        FROM lm_ce_payments
        WHERE crm_order_id = ${order.id}
        ORDER BY collected_at DESC NULLS LAST
        LIMIT 1
      `;
      const method = ceRows[0]?.payment_method?.toLowerCase();
      if (method === 'sinpe' || method === 'efectivo') {
        paymentMethod = method;
        paymentCollected = true;
      }
    } catch {
      // ce payments table may be unavailable
    }

    const handoffs = await getHandoffsForOrders([order.id]).catch(() => ({} as Awaited<ReturnType<typeof getHandoffsForOrders>>));
    const handoff = handoffs[order.id];

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
      status: lmStatus || order.delivery || order.status || 'Pendiente',
      agreedDate: order.agreedDate,
      pickupDate: order.pickupDate,
      scheduledAt: handoff?.scheduledAt || null,
      createdAt: order.timestamp,
      isContraEntrega,
      paymentCollected,
      paymentMethod,
      pickupLocationLabel: handoff?.pickupLocationLabel
        || (handoff?.pickupLocation ? pickupLocationLabel(handoff.pickupLocation) : null),
      handedByName: handoff?.handedByName || null,
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
