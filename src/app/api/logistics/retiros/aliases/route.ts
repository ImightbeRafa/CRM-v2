import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  orderContainsProductLabel,
  RetiroAliasConflictError,
  RetiroAliasValidationError,
  upsertProductAlias,
} from '@/lib/retiro-stock';

function readString(value: unknown, maxLen: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

// POST /api/logistics/retiros/aliases
// Body: { orderId, rawName, sku, overwrite? }
// Maps a product label from an RA order onto Laura inventory. Agent is always Laura.
export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const orderId = readString(body.orderId, 128);
    const rawName = readString(body.rawName, 200);
    const sku = readString(body.sku, 64);
    const overwrite = body.overwrite === true;
    const actor = req.headers.get('x-user-email') ?? 'system';

    if (!orderId) return NextResponse.json({ error: 'orderId requerido' }, { status: 400 });
    if (!rawName) return NextResponse.json({ error: 'rawName requerido' }, { status: 400 });
    if (!sku) return NextResponse.json({ error: 'sku requerido' }, { status: 400 });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderType: true,
        product: true,
        quantity: true,
        productDetails: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
    }
    if (order.orderType !== 'RA') {
      return NextResponse.json({ error: 'Solo se mapean productos de retiros RA' }, { status: 400 });
    }
    if (!orderContainsProductLabel(order, rawName)) {
      return NextResponse.json({ error: 'Ese producto no pertenece a esta orden' }, { status: 400 });
    }

    const result = await upsertProductAlias({
      rawName,
      sku,
      overwrite,
      actor,
      orderId,
    });

    return NextResponse.json({
      success: true,
      alias: {
        sku: result.sku,
        aliasNormalized: result.aliasNormalized,
        aliasRaw: result.aliasRaw,
        displayName: result.displayName,
      },
      created: result.created,
      previousSku: result.previousSku,
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    if (error instanceof RetiroAliasConflictError) {
      return NextResponse.json({
        error: error.message,
        existingSku: error.existingSku,
        existingDisplayName: error.existingDisplayName,
      }, { status: 409 });
    }
    if (error instanceof RetiroAliasValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[retiros/aliases POST]', error);
    return NextResponse.json({ error: 'No se pudo guardar el mapeo' }, { status: 500 });
  }
}
