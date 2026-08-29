import { prisma } from '@/lib/db';

export type ArchivedLogisticsOrder = {
    id: string;
    orderId: string;
    tenantId: string;
    orderType: string;
    status: string;
    timestamp: string;
    customerName: string;
    phone: string | null;
    email: string | null;
    product: string | null;
    quantity: number | null;
    province: string | null;
    canton: string | null;
    district: string | null;
    address: string | null;
    total: number;
    comments: string | null;
    delivery: string | null;
    lmCarrier: string | null;
    lmStatus: string | null;
    isContraEntrega: boolean;
    contraEntregaCollected: boolean;
    archivedAt: string;
    correosShippingCost: number | null;
};

export type ArchivedOrdersQuery = {
    tenantIds: string[];
    search?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    status?: string | null;
    courier?: string | null;
    lmCarrier?: string | null;
    page: number;
    limit: number;
};

export type ArchivedOrdersResult = {
    orders: ArchivedLogisticsOrder[];
    total: number;
};

type RawArchivedRow = {
    id: string;
    orderId: string;
    tenantId: string;
    orderType: string | null;
    status: string | null;
    timestamp: Date | string;
    customerName: string | null;
    phone: string | null;
    email: string | null;
    product: string | null;
    quantity: number | null;
    province: string | null;
    canton: string | null;
    district: string | null;
    address: string | null;
    total: number | string | null;
    comments: string | null;
    delivery: string | null;
    contraEntrega: boolean | null;
    cePaymentConfirmed: boolean | null;
    lm_carrier: string | null;
    lm_status: string | null;
    is_contra_entrega: boolean | null;
    contraentrega_collected: boolean | null;
    archived_at: Date | string;
    correos_shipping_cost?: number | string | null;
    total_count: number;
};

export function sanitizeArchivedSearch(raw: string): string {
    return raw.trim().replace(/[%_]/g, '').slice(0, 80);
}

function toIso(value: Date | string | null | undefined): string | null {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function toNumber(value: number | string | null | undefined): number {
    if (value == null || value === '') return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapArchivedRow(row: RawArchivedRow): ArchivedLogisticsOrder {
    const archivedAt = toIso(row.archived_at);
    if (!archivedAt) {
        throw new Error('Archived order missing archived_at');
    }
    return {
        id: row.id,
        orderId: row.orderId,
        tenantId: row.tenantId,
        orderType: row.orderType || 'EA',
        status: row.status || 'Pendiente',
        timestamp: toIso(row.timestamp) || archivedAt,
        customerName: row.customerName || '',
        phone: row.phone,
        email: row.email,
        product: row.product,
        quantity: row.quantity,
        province: row.province,
        canton: row.canton,
        district: row.district,
        address: row.address,
        total: toNumber(row.total),
        comments: row.comments,
        delivery: row.delivery,
        lmCarrier: row.lm_carrier,
        lmStatus: row.lm_status,
        isContraEntrega: Boolean(row.contraEntrega || row.is_contra_entrega),
        contraEntregaCollected: Boolean(row.cePaymentConfirmed || row.contraentrega_collected),
        archivedAt,
        correosShippingCost: row.correos_shipping_cost == null ? null : toNumber(row.correos_shipping_cost),
    };
}

function buildArchivedWhere(query: ArchivedOrdersQuery, params: unknown[]): string {
    const where = [
        'lm.archived_at IS NOT NULL',
        'o."tenantId" = lm.crm_tenant_id',
        'o."tenantId" = ANY($1::text[])',
    ];

    const search = query.search ? sanitizeArchivedSearch(query.search) : '';
    if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        where.push(`(
            o."customerName" ILIKE $${idx}
            OR o."orderId" ILIKE $${idx}
            OR COALESCE(o.phone, '') ILIKE $${idx}
            OR COALESCE(o.address, '') ILIKE $${idx}
            OR COALESCE(o.product, '') ILIKE $${idx}
        )`);
    }

    if (query.dateFrom) {
        params.push(new Date(query.dateFrom).toISOString());
        where.push(`o.timestamp >= $${params.length}::timestamptz`);
    }
    if (query.dateTo) {
        params.push(new Date(`${query.dateTo}T23:59:59.999Z`).toISOString());
        where.push(`o.timestamp <= $${params.length}::timestamptz`);
    }
    if (query.status) {
        params.push(query.status);
        where.push(`o.status = $${params.length}`);
    }
    if (query.courier) {
        params.push(query.courier);
        where.push(`o.courier = $${params.length}`);
    }
    if (query.lmCarrier) {
        params.push(query.lmCarrier);
        where.push(`lm.carrier = $${params.length}`);
    }

    return where.join(' AND ');
}

const ARCHIVED_SELECT = `
    o.id,
    o."orderId",
    o."tenantId",
    o."orderType",
    o.status,
    o.timestamp,
    o."customerName",
    o.phone,
    o.email,
    o.product,
    o.quantity,
    o.province,
    o.canton,
    o.district,
    o.address,
    o.total,
    o.comments,
    o.delivery,
    o."contraEntrega",
    o."cePaymentConfirmed",
    lm.carrier AS lm_carrier,
    lm.status AS lm_status,
    lm.is_contra_entrega,
    lm.contraentrega_collected,
    lm.archived_at`;

function archivedSql(whereSql: string, includeShippingCost: boolean, limitParam: number, offsetParam: number): string {
    const costSelect = includeShippingCost ? ',\n    lm.correos_shipping_cost' : '';
    return `
        SELECT
            ${ARCHIVED_SELECT}${costSelect},
            COUNT(*) OVER()::int AS total_count
        FROM lm_orders lm
        INNER JOIN "Order" o ON o.id = lm.crm_order_id
        WHERE ${whereSql}
        ORDER BY lm.archived_at DESC NULLS LAST, o.timestamp DESC, o.id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
}

export async function fetchArchivedLogisticsOrders(
    query: ArchivedOrdersQuery,
): Promise<ArchivedOrdersResult> {
    if (query.tenantIds.length === 0) {
        return { orders: [], total: 0 };
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(800, Math.max(1, query.limit || 100));
    const params: unknown[] = [query.tenantIds];
    const whereSql = buildArchivedWhere(query, params);
    params.push(limit, (page - 1) * limit);
    const offsetParam = params.length;
    const limitParam = params.length - 1;

    let rows: RawArchivedRow[];
    try {
        rows = await prisma.$queryRawUnsafe<RawArchivedRow[]>(
            archivedSql(whereSql, true, limitParam, offsetParam),
            ...params,
        );
    } catch {
        rows = await prisma.$queryRawUnsafe<RawArchivedRow[]>(
            archivedSql(whereSql, false, limitParam, offsetParam),
            ...params,
        );
    }

    return {
        orders: rows.map(mapArchivedRow),
        total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    };
}
