import { prisma } from '@/lib/db';
import { buildStatsOrderDateWhere, getOrderStatsDateKey } from '@/lib/statistics-dates';
import {
  classifyFinanceOrder,
  FINANCE_ORDER_CLASSIFIER_VERSION,
  type FinanceBusinessSlug,
  type FinanceChannelSlug,
  type FinanceOrderClassification,
  type FinanceTenantSlug,
} from '@/lib/finance-order-classifier';
import { getFinanceTenantBySlug, type FINANCE_TENANTS } from '@/lib/finance-tenants';
import type { FinanceDateRange } from '@/lib/finance-dates';

type FinanceTenant = (typeof FINANCE_TENANTS)[number];

export const FINANCE_ORDERS_MAX_LIMIT = 250;
export const FINANCE_ORDERS_DEFAULT_LIMIT = 100;

export type FinanceOrderRow = {
  id: string;
  orderId: string;
  tenant: FinanceTenantSlug;
  business: FinanceBusinessSlug;
  channel: FinanceChannelSlug;
  attributionDate: string;
  saleDate: string | null;
  createdAt: string;
  updatedAt: string;
  status: string;
  delivery: string | null;
  orderType: string;
  totalCrc: number;
  ivaCrc: number | null;
  shippingCostCrc: number | null;
  productCostCrc: number | null;
  quantity: number;
  contraEntrega: boolean;
  cePaymentConfirmed: boolean;
  needsManualAssignment: boolean;
  confidence: FinanceOrderClassification['confidence'];
  businessRule: string;
  channelRule: string;
  classifierVersion: string;
};

type OrderSelectRow = {
  id: string;
  orderId: string;
  timestamp: Date;
  updatedAt: Date;
  saleDate: string | null;
  status: string;
  delivery: string | null;
  orderType: string;
  total: number;
  iva: number | null;
  shippingCost: number | null;
  productCost: number | null;
  quantity: number;
  contraEntrega: boolean;
  cePaymentConfirmed: boolean;
  seller: string | null;
  salesChannel: string | null;
  product: string | null;
  productDetails: string | null;
  comments: string | null;
  customFields: unknown;
};

function encodeCursor(payload: { updatedAt: string; id: string; watermark: string }): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(
  raw: string | null,
): { ok: true; value: { updatedAt: string; id: string; watermark: string } } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'missing' };
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
      watermark?: unknown;
    };
    if (
      typeof parsed.updatedAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      typeof parsed.watermark !== 'string'
    ) {
      return { ok: false, error: 'Invalid cursor payload' };
    }
    if (Number.isNaN(Date.parse(parsed.updatedAt)) || Number.isNaN(Date.parse(parsed.watermark))) {
      return { ok: false, error: 'Invalid cursor timestamps' };
    }
    return {
      ok: true,
      value: { updatedAt: parsed.updatedAt, id: parsed.id, watermark: parsed.watermark },
    };
  } catch {
    return { ok: false, error: 'Invalid cursor encoding' };
  }
}

export function parseFinanceOrdersLimit(raw: string | null): number {
  if (!raw) return FINANCE_ORDERS_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return FINANCE_ORDERS_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), FINANCE_ORDERS_MAX_LIMIT);
}

export function resolveFinanceOrdersTenant(
  brandRaw: string | null,
): { ok: true; tenant: FinanceTenant } | { ok: false; error: string } {
  const brand = brandRaw?.trim().toLowerCase() || '';
  if (!brand || brand === 'all') {
    return {
      ok: false,
      error: 'brand is required and must be a single tenant: deepsleep or bloom (not all)',
    };
  }
  const tenant = getFinanceTenantBySlug(brand);
  if (!tenant) {
    return { ok: false, error: 'Invalid brand. Use deepsleep or bloom' };
  }
  return { ok: true, tenant };
}

function toFinanceOrderRow(tenantSlug: FinanceTenantSlug, order: OrderSelectRow): FinanceOrderRow {
  const classification = classifyFinanceOrder({
    tenantSlug,
    seller: order.seller,
    salesChannel: order.salesChannel,
    product: order.product,
    productDetails: order.productDetails,
    comments: order.comments,
    customFields: order.customFields,
  });

  return {
    id: order.id,
    orderId: order.orderId,
    tenant: classification.tenant,
    business: classification.business,
    channel: classification.channel,
    attributionDate: getOrderStatsDateKey(order),
    saleDate: order.saleDate,
    createdAt: order.timestamp.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    status: order.status,
    delivery: order.delivery,
    orderType: order.orderType,
    totalCrc: Number(order.total || 0),
    ivaCrc: order.iva == null ? null : Number(order.iva),
    shippingCostCrc: order.shippingCost == null ? null : Number(order.shippingCost),
    productCostCrc: order.productCost == null ? null : Number(order.productCost),
    quantity: order.quantity,
    contraEntrega: order.contraEntrega,
    cePaymentConfirmed: order.cePaymentConfirmed,
    needsManualAssignment: classification.needsManualAssignment,
    confidence: classification.confidence,
    businessRule: classification.businessRule,
    channelRule: classification.channelRule,
    classifierVersion: classification.classifierVersion,
  };
}

const ORDER_SELECT = {
  id: true,
  orderId: true,
  timestamp: true,
  updatedAt: true,
  saleDate: true,
  status: true,
  delivery: true,
  orderType: true,
  total: true,
  iva: true,
  shippingCost: true,
  productCost: true,
  quantity: true,
  contraEntrega: true,
  cePaymentConfirmed: true,
  seller: true,
  salesChannel: true,
  product: true,
  productDetails: true,
  comments: true,
  customFields: true,
} as const;

export type FinanceOrdersQueryResult = {
  currency: 'CRC';
  timezone: 'America/Costa_Rica';
  classifierVersion: string;
  mode: 'period' | 'changes';
  brand: string;
  tenantId: string;
  period: FinanceDateRange | null;
  updatedSince: string | null;
  needsManualAssignmentOnly: boolean;
  syncCheckpoint: string;
  pageInfo: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
    count: number;
  };
  summary: {
    assigned: number;
    needsManualAssignment: number;
    byBusiness: Record<string, number>;
    byChannel: Record<string, number>;
  };
  orders: FinanceOrderRow[];
};

function summarize(orders: FinanceOrderRow[]) {
  const byBusiness: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  let needsManualAssignment = 0;
  for (const order of orders) {
    byBusiness[order.business] = (byBusiness[order.business] ?? 0) + 1;
    byChannel[order.channel] = (byChannel[order.channel] ?? 0) + 1;
    if (order.needsManualAssignment) needsManualAssignment += 1;
  }
  return {
    assigned: orders.length - needsManualAssignment,
    needsManualAssignment,
    byBusiness,
    byChannel,
  };
}

export async function getFinanceOrdersPage(args: {
  tenant: FinanceTenant;
  mode: 'period' | 'changes';
  range: FinanceDateRange | null;
  updatedSince: Date | null;
  cursor: string | null;
  limit: number;
  needsManualAssignmentOnly: boolean;
}): Promise<{ ok: true; data: FinanceOrdersQueryResult } | { ok: false; error: string; status: number }> {
  const tenantSlug = args.tenant.slug as FinanceTenantSlug;
  let watermark: Date;
  let cursorUpdatedAt: Date | null = null;
  let cursorId: string | null = null;

  if (args.cursor) {
    const decoded = decodeCursor(args.cursor);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error === 'missing' ? 'Invalid cursor' : decoded.error, status: 400 };
    }
    watermark = new Date(decoded.value.watermark);
    cursorUpdatedAt = new Date(decoded.value.updatedAt);
    cursorId = decoded.value.id;
    if (Number.isNaN(watermark.getTime()) || Number.isNaN(cursorUpdatedAt.getTime())) {
      return { ok: false, error: 'Invalid cursor timestamps', status: 400 };
    }
  } else {
    const latest = await prisma.order.findFirst({
      where: { tenantId: args.tenant.id },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { updatedAt: true },
    });
    watermark = latest?.updatedAt ?? new Date();
  }

  const where: Record<string, unknown> = {
    tenantId: args.tenant.id,
    updatedAt: { lte: watermark },
  };

  if (args.mode === 'period') {
    if (!args.range) {
      return { ok: false, error: 'dateFrom and dateTo are required for period mode', status: 400 };
    }
    Object.assign(where, buildStatsOrderDateWhere(args.range.dateFrom, args.range.dateTo));
  } else {
    if (!args.updatedSince) {
      return { ok: false, error: 'updatedSince is required for changes mode', status: 400 };
    }
    where.updatedAt = {
      gt: args.updatedSince,
      lte: watermark,
    };
  }

  const page: FinanceOrderRow[] = [];
  let nextCursor: string | null = null;

  if (!args.needsManualAssignmentOnly) {
    const pageWhere: Record<string, unknown> = { ...where };
    if (cursorUpdatedAt && cursorId) {
      pageWhere.AND = [
        {
          OR: [
            { updatedAt: { gt: cursorUpdatedAt } },
            { updatedAt: cursorUpdatedAt, id: { gt: cursorId } },
          ],
        },
      ];
    }

    const batch = (await prisma.order.findMany({
      where: pageWhere,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: args.limit + 1,
      select: ORDER_SELECT,
    })) as OrderSelectRow[];

    const hasMore = batch.length > args.limit;
    const slice = hasMore ? batch.slice(0, args.limit) : batch;
    for (const row of slice) page.push(toFinanceOrderRow(tenantSlug, row));
    const last = slice[slice.length - 1];
    if (hasMore && last) {
      nextCursor = encodeCursor({
        updatedAt: last.updatedAt.toISOString(),
        id: last.id,
        watermark: watermark.toISOString(),
      });
    }
  } else {
    // Scan keyset until we fill a page of unassigned rows; cursor advances by last scanned row.
    let scanUpdatedAt = cursorUpdatedAt;
    let scanId = cursorId;
    let lastScanned: OrderSelectRow | null = null;
    let hasMore = false;

    while (page.length < args.limit) {
      const pageWhere: Record<string, unknown> = { ...where };
      if (scanUpdatedAt && scanId) {
        pageWhere.AND = [
          {
            OR: [
              { updatedAt: { gt: scanUpdatedAt } },
              { updatedAt: scanUpdatedAt, id: { gt: scanId } },
            ],
          },
        ];
      }

      const batchSize = Math.min(Math.max(args.limit * 4, 50), 200);
      const batch = (await prisma.order.findMany({
        where: pageWhere,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: ORDER_SELECT,
      })) as OrderSelectRow[];

      if (batch.length === 0) break;

      let stoppedMidBatch = false;
      for (let i = 0; i < batch.length; i += 1) {
        const row = batch[i]!;
        lastScanned = row;
        scanUpdatedAt = row.updatedAt;
        scanId = row.id;
        const mapped = toFinanceOrderRow(tenantSlug, row);
        if (!mapped.needsManualAssignment) continue;
        page.push(mapped);
        if (page.length >= args.limit) {
          // Remaining rows in this batch (or a full batch) mean more pages may exist.
          stoppedMidBatch = i < batch.length - 1;
          hasMore = stoppedMidBatch || batch.length === batchSize;
          break;
        }
      }

      if (page.length >= args.limit) break;
      if (batch.length < batchSize) break; // consumed short final batch fully
    }

    if (hasMore && lastScanned) {
      nextCursor = encodeCursor({
        updatedAt: lastScanned.updatedAt.toISOString(),
        id: lastScanned.id,
        watermark: watermark.toISOString(),
      });
    }
  }

  return {
    ok: true,
    data: {
      currency: 'CRC',
      timezone: 'America/Costa_Rica',
      classifierVersion: FINANCE_ORDER_CLASSIFIER_VERSION,
      mode: args.mode,
      brand: args.tenant.slug,
      tenantId: args.tenant.id,
      period: args.mode === 'period' ? args.range : null,
      updatedSince: args.updatedSince ? args.updatedSince.toISOString() : null,
      needsManualAssignmentOnly: args.needsManualAssignmentOnly,
      syncCheckpoint: watermark.toISOString(),
      pageInfo: {
        limit: args.limit,
        hasMore: Boolean(nextCursor),
        nextCursor,
        count: page.length,
      },
      summary: summarize(page),
      orders: page,
    },
  };
}
