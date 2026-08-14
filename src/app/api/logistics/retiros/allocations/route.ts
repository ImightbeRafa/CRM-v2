import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  getAllocationsForOrders,
  orderContainsProductLabel,
  RetiroAliasValidationError,
    shouldPersistGlobalAlias,
    upsertOrderAllocation,
    upsertProductAlias,
} from '@/lib/retiro-stock';

function readString(value: unknown, maxLen: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0 && id.length <= 128).slice(0, 500);
}

// GET /api/logistics/retiros/allocations?ids=a,b,c
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const ids = parseIds(req.nextUrl.searchParams.get('ids'));
    const allocations = await getAllocationsForOrders(ids);
    return NextResponse.json({ allocations });
  } catch (error) {
    console.error('[retiros/allocations GET]', error);
    return NextResponse.json({ error: 'No se pudieron cargar los mapeos' }, { status: 500 });
  }
}

// POST /api/logistics/retiros/allocations
// Body: { orderId, slotKey, rawName, sku, qty?, overwrite? }
export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const orderId = readString(body.orderId, 128);
    const slotKey = readString(body.slotKey, 32);
    const rawName = readString(body.rawName, 200);
    const sku = readString(body.sku, 64);
    const qty = Number(body.qty);
    const overwrite = body.overwrite === true;
    const actor = req.headers.get('x-user-email') ?? 'system';

    if (!orderId) return NextResponse.json({ error: 'orderId requerido' }, { status: 400 });
    if (!slotKey) return NextResponse.json({ error: 'slotKey requerido' }, { status: 400 });
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

    const allocation = await upsertOrderAllocation({
      orderId,
      slotKey,
      rawName,
      sku,
      qty: Number.isFinite(qty) ? qty : 1,
    });

    // Unique named products can seed a global alias. Generic "Parche" must not,
    // or mixed future orders would all deduct from the same SKU.
    let alias = null;
    if (!slotKey.includes(':') && shouldPersistGlobalAlias(rawName)) {
      try {
        const result = await upsertProductAlias({
          rawName,
          sku,
          overwrite,
          actor,
          orderId,
        });
        alias = {
          sku: result.sku,
          aliasNormalized: result.aliasNormalized,
          aliasRaw: result.aliasRaw,
          displayName: result.displayName,
        };
      } catch {
        // Allocation is the source of truth for this order; alias is optional.
      }
    }

    return NextResponse.json({ success: true, allocation, alias });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    if (error instanceof RetiroAliasValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[retiros/allocations POST]', error);
    return NextResponse.json({ error: 'No se pudo guardar el mapeo' }, { status: 500 });
  }
}
