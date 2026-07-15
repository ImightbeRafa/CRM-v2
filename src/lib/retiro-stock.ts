import { prisma } from '@/lib/db';
import {
  mapOrderLinesLocal,
  normalizeProductName,
  type RetiroOrderLine,
} from '@/lib/retiro-stock-utils';

export type { RetiroOrderLine };
export {
  buildAliasMapFromRows,
  extractOrderLines,
  mapOrderLinesLocal,
  normalizeProductName,
  resolveSkuFromMap,
} from '@/lib/retiro-stock-utils';

export const DEFAULT_RETIRO_AGENT = 'laura';
export const CR_TZ = 'America/Costa_Rica';

export type RetiroStockRow = {
  agentKey: string;
  sku: string;
  displayName: string;
  qty: number;
  minQty: number;
  sortOrder: number;
  active: boolean;
  lowStock: boolean;
};

export type StockMovementReason = 'seed' | 'restock' | 'retiro' | 'adjust' | 'reverse';

const SEED_STOCK: Array<{ sku: string; displayName: string; qty: number; minQty: number; aliases: string[] }> = [
  { sku: 'bucales', displayName: 'Bucales', qty: 15, minQty: 5, aliases: ['bucales', 'bucal', 'bucales deepsleep', 'bucal deepsleep', 'deepsleep bucal'] },
  { sku: 'pura_s_menta', displayName: 'Pura S Menta', qty: 5, minQty: 2, aliases: ['pura s menta', 'pura menta', 'menta', 'pura s. menta'] },
  { sku: 'pura_s_sandia', displayName: 'Pura S Sandia', qty: 5, minQty: 2, aliases: ['pura s sandia', 'pura sandia', 'sandia', 'sandía', 'pura s. sandia'] },
  { sku: 'pura_s_rasp', displayName: 'Pura S Rasp', qty: 5, minQty: 2, aliases: ['pura s rasp', 'pura rasp', 'rasp', 'raspberry', 'pura s. rasp'] },
  { sku: 'pura_s_fresa', displayName: 'Pura S Fresa', qty: 5, minQty: 2, aliases: ['pura s fresa', 'pura fresa', 'fresa', 'pura s. fresa'] },
  { sku: 'energia', displayName: 'Energía', qty: 10, minQty: 3, aliases: ['energia', 'energía', 'energy'] },
  { sku: 'focus', displayName: 'Focus', qty: 10, minQty: 3, aliases: ['focus'] },
  { sku: 'dopamina', displayName: 'Dopamina', qty: 10, minQty: 3, aliases: ['dopamina', 'dopamine'] },
  { sku: 'estres', displayName: 'Estres', qty: 10, minQty: 3, aliases: ['estres', 'estrés', 'stress'] },
  { sku: 'glp', displayName: 'GLP', qty: 10, minQty: 3, aliases: ['glp', 'glp-1', 'glp1'] },
  { sku: 'sleeping', displayName: 'Sleeping', qty: 15, minQty: 5, aliases: ['sleeping', 'sleep'] },
];

let ensurePromise: Promise<void> | null = null;

export function toCRDate(timestamp: string | Date = new Date()): string {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: CR_TZ });
}

export async function ensureRetiroStockTables() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_retiro_stock (
          agent_key TEXT NOT NULL,
          sku TEXT NOT NULL,
          display_name TEXT NOT NULL,
          qty INTEGER NOT NULL DEFAULT 0,
          min_qty INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (agent_key, sku)
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_retiro_stock_movements (
          id BIGSERIAL PRIMARY KEY,
          agent_key TEXT NOT NULL,
          sku TEXT NOT NULL,
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL,
          crm_order_id TEXT,
          actor TEXT,
          employee_id TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_retiro_stock_movements_agent_idx
        ON lm_retiro_stock_movements (agent_key, created_at DESC)
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_retiro_product_aliases (
          id BIGSERIAL PRIMARY KEY,
          agent_key TEXT NOT NULL,
          sku TEXT NOT NULL,
          alias_normalized TEXT NOT NULL,
          alias_raw TEXT NOT NULL,
          UNIQUE (agent_key, alias_normalized)
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_retiro_handoffs (
          crm_order_id TEXT PRIMARY KEY,
          agent_key TEXT NOT NULL DEFAULT 'laura',
          scheduled_at TIMESTAMPTZ,
          handed_by_employee_id TEXT,
          handed_by_name TEXT,
          confirmed_at TIMESTAMPTZ,
          stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
          actor TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_retiro_handoffs_scheduled_idx
        ON lm_retiro_handoffs (scheduled_at)
      `);
      await seedLauraStockIfNeeded(DEFAULT_RETIRO_AGENT);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

async function seedLauraStockIfNeeded(agentKey: string) {
  const existing = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM lm_retiro_stock WHERE agent_key = $1`,
    agentKey,
  );
  if ((existing[0]?.cnt || 0) > 0) {
    for (const item of SEED_STOCK) {
      for (const alias of item.aliases) {
        const normalized = normalizeProductName(alias);
        if (!normalized) continue;
        await prisma.$executeRawUnsafe(
          `INSERT INTO lm_retiro_product_aliases (agent_key, sku, alias_normalized, alias_raw)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_key, alias_normalized) DO NOTHING`,
          agentKey,
          item.sku,
          normalized,
          alias,
        );
      }
    }
    return;
  }

  for (let i = 0; i < SEED_STOCK.length; i++) {
    const item = SEED_STOCK[i];
    await prisma.$executeRawUnsafe(
      `INSERT INTO lm_retiro_stock (agent_key, sku, display_name, qty, min_qty, sort_order, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       ON CONFLICT (agent_key, sku) DO NOTHING`,
      agentKey,
      item.sku,
      item.displayName,
      item.qty,
      item.minQty,
      i + 1,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO lm_retiro_stock_movements (agent_key, sku, delta, reason, actor, notes)
       VALUES ($1, $2, $3, 'seed', 'system', $4)`,
      agentKey,
      item.sku,
      item.qty,
      'CASA DE LAURA — Envío 13 de julio',
    );
    for (const alias of item.aliases) {
      const normalized = normalizeProductName(alias);
      if (!normalized) continue;
      await prisma.$executeRawUnsafe(
        `INSERT INTO lm_retiro_product_aliases (agent_key, sku, alias_normalized, alias_raw)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agent_key, alias_normalized) DO NOTHING`,
        agentKey,
        item.sku,
        normalized,
        alias,
      );
    }
  }
}

export async function listRetiroStock(agentKey = DEFAULT_RETIRO_AGENT): Promise<RetiroStockRow[]> {
  await ensureRetiroStockTables();
  const rows = await prisma.$queryRawUnsafe<{
    agent_key: string;
    sku: string;
    display_name: string;
    qty: number;
    min_qty: number;
    sort_order: number;
    active: boolean;
  }[]>(
    `SELECT agent_key, sku, display_name, qty, min_qty, sort_order, active
     FROM lm_retiro_stock
     WHERE agent_key = $1 AND active = TRUE
     ORDER BY sort_order ASC, display_name ASC`,
    agentKey,
  );

  return rows.map((row) => ({
    agentKey: row.agent_key,
    sku: row.sku,
    displayName: row.display_name,
    qty: Number(row.qty) || 0,
    minQty: Number(row.min_qty) || 0,
    sortOrder: Number(row.sort_order) || 0,
    active: Boolean(row.active),
    lowStock: (Number(row.qty) || 0) <= (Number(row.min_qty) || 0),
  }));
}

export async function listRecentMovements(agentKey = DEFAULT_RETIRO_AGENT, limit = 20) {
  await ensureRetiroStockTables();
  return prisma.$queryRawUnsafe<{
    id: string;
    sku: string;
    delta: number;
    reason: string;
    crm_order_id: string | null;
    actor: string | null;
    employee_id: string | null;
    notes: string | null;
    created_at: Date;
    display_name: string | null;
  }[]>(
    `SELECT m.id::text, m.sku, m.delta, m.reason, m.crm_order_id, m.actor, m.employee_id, m.notes, m.created_at,
            s.display_name
     FROM lm_retiro_stock_movements m
     LEFT JOIN lm_retiro_stock s ON s.agent_key = m.agent_key AND s.sku = m.sku
     WHERE m.agent_key = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    agentKey,
    limit,
  );
}

export async function listProductAliases(agentKey = DEFAULT_RETIRO_AGENT) {
  await ensureRetiroStockTables();
  return prisma.$queryRawUnsafe<{ sku: string; alias_normalized: string; alias_raw: string; display_name: string | null }[]>(
    `SELECT a.sku, a.alias_normalized, a.alias_raw, s.display_name
     FROM lm_retiro_product_aliases a
     LEFT JOIN lm_retiro_stock s ON s.agent_key = a.agent_key AND s.sku = a.sku
     WHERE a.agent_key = $1`,
    agentKey,
  );
}

async function loadAliasMap(agentKey: string): Promise<Map<string, { sku: string; displayName: string }>> {
  const [aliases, stock] = await Promise.all([
    prisma.$queryRawUnsafe<{ sku: string; alias_normalized: string }[]>(
      `SELECT sku, alias_normalized FROM lm_retiro_product_aliases WHERE agent_key = $1`,
      agentKey,
    ),
    prisma.$queryRawUnsafe<{ sku: string; display_name: string }[]>(
      `SELECT sku, display_name FROM lm_retiro_stock WHERE agent_key = $1 AND active = TRUE`,
      agentKey,
    ),
  ]);

  const displayBySku = new Map(stock.map((s) => [s.sku, s.display_name]));
  const map = new Map<string, { sku: string; displayName: string }>();

  for (const row of aliases) {
    map.set(row.alias_normalized, {
      sku: row.sku,
      displayName: displayBySku.get(row.sku) || row.sku,
    });
  }
  for (const row of stock) {
    map.set(normalizeProductName(row.display_name), {
      sku: row.sku,
      displayName: row.display_name,
    });
    map.set(normalizeProductName(row.sku), {
      sku: row.sku,
      displayName: row.display_name,
    });
  }
  return map;
}

export async function mapOrderLines(
  order: { product?: string | null; quantity?: number | null; productDetails?: string | null },
  agentKey = DEFAULT_RETIRO_AGENT,
): Promise<RetiroOrderLine[]> {
  await ensureRetiroStockTables();
  const aliasMap = await loadAliasMap(agentKey);
  return mapOrderLinesLocal(order, aliasMap);
}

export async function adjustRetiroStock(params: {
  agentKey?: string;
  sku: string;
  delta: number;
  reason: StockMovementReason;
  actor?: string;
  employeeId?: string | null;
  crmOrderId?: string | null;
  notes?: string | null;
}) {
  const agentKey = params.agentKey || DEFAULT_RETIRO_AGENT;
  if (!Number.isFinite(params.delta) || params.delta === 0) {
    throw new Error('delta must be a non-zero number');
  }

  await ensureRetiroStockTables();

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ sku: string; qty: number; display_name: string }[]>(
      `SELECT sku, qty, display_name FROM lm_retiro_stock WHERE agent_key = $1 AND sku = $2 FOR UPDATE`,
      agentKey,
      params.sku,
    );
    if (!rows[0]) throw new Error(`SKU desconocido: ${params.sku}`);

    const nextQty = Number(rows[0].qty) + params.delta;
    if (nextQty < 0) {
      throw new Error(`Stock insuficiente para ${rows[0].display_name}: hay ${rows[0].qty}, se requieren ${Math.abs(params.delta)}`);
    }

    await tx.$executeRawUnsafe(
      `UPDATE lm_retiro_stock SET qty = $1, updated_at = NOW() WHERE agent_key = $2 AND sku = $3`,
      nextQty,
      agentKey,
      params.sku,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO lm_retiro_stock_movements (agent_key, sku, delta, reason, crm_order_id, actor, employee_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      agentKey,
      params.sku,
      params.delta,
      params.reason,
      params.crmOrderId || null,
      params.actor || null,
      params.employeeId || null,
      params.notes || null,
    );

    return { sku: params.sku, displayName: rows[0].display_name, previousQty: Number(rows[0].qty), qty: nextQty };
  });
}

export async function applyRetiroDecrement(params: {
  agentKey?: string;
  orderId: string;
  lines: RetiroOrderLine[];
  actor: string;
  employeeId: string;
  employeeName: string;
}) {
  const agentKey = params.agentKey || DEFAULT_RETIRO_AGENT;
  const unmapped = params.lines.filter((l) => !l.sku);
  if (unmapped.length > 0) {
    throw new Error(`Productos sin mapear al inventario de Laura: ${unmapped.map((l) => l.rawName).join(', ')}`);
  }

  const bySku = new Map<string, { qty: number; displayName: string }>();
  for (const line of params.lines) {
    if (!line.sku) continue;
    const prev = bySku.get(line.sku);
    bySku.set(line.sku, {
      qty: (prev?.qty || 0) + line.qty,
      displayName: line.displayName || line.sku,
    });
  }

  await ensureRetiroStockTables();

  return prisma.$transaction(async (tx) => {
    const handoff = await tx.$queryRawUnsafe<{ stock_applied: boolean }[]>(
      `SELECT stock_applied FROM lm_retiro_handoffs WHERE crm_order_id = $1`,
      params.orderId,
    );
    if (handoff[0]?.stock_applied) {
      return { alreadyApplied: true as const, decrements: [] as Array<{ sku: string; displayName: string; qty: number; remaining: number }> };
    }

    const decrements: Array<{ sku: string; displayName: string; qty: number; remaining: number }> = [];

    for (const [sku, info] of bySku.entries()) {
      const rows = await tx.$queryRawUnsafe<{ qty: number; display_name: string }[]>(
        `SELECT qty, display_name FROM lm_retiro_stock WHERE agent_key = $1 AND sku = $2 FOR UPDATE`,
        agentKey,
        sku,
      );
      if (!rows[0]) throw new Error(`SKU desconocido: ${sku}`);
      const available = Number(rows[0].qty) || 0;
      if (available < info.qty) {
        throw new Error(`Stock insuficiente de ${rows[0].display_name}: hay ${available}, el pedido pide ${info.qty}`);
      }
      const remaining = available - info.qty;
      await tx.$executeRawUnsafe(
        `UPDATE lm_retiro_stock SET qty = $1, updated_at = NOW() WHERE agent_key = $2 AND sku = $3`,
        remaining,
        agentKey,
        sku,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO lm_retiro_stock_movements (agent_key, sku, delta, reason, crm_order_id, actor, employee_id, notes)
         VALUES ($1, $2, $3, 'retiro', $4, $5, $6, $7)`,
        agentKey,
        sku,
        -info.qty,
        params.orderId,
        params.actor,
        params.employeeId,
        `Retirado por Laura · ${params.employeeName}`,
      );
      decrements.push({ sku, displayName: rows[0].display_name, qty: info.qty, remaining });
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO lm_retiro_handoffs (
         crm_order_id, agent_key, handed_by_employee_id, handed_by_name, confirmed_at, stock_applied, actor, updated_at
       ) VALUES ($1, $2, $3, $4, NOW(), TRUE, $5, NOW())
       ON CONFLICT (crm_order_id) DO UPDATE SET
         agent_key = EXCLUDED.agent_key,
         handed_by_employee_id = EXCLUDED.handed_by_employee_id,
         handed_by_name = EXCLUDED.handed_by_name,
         confirmed_at = NOW(),
         stock_applied = TRUE,
         actor = EXCLUDED.actor,
         updated_at = NOW()`,
      params.orderId,
      agentKey,
      params.employeeId,
      params.employeeName,
      params.actor,
    );

    return { alreadyApplied: false as const, decrements };
  });
}

export async function upsertRetiroSchedule(params: {
  orderId: string;
  scheduledAt: Date | null;
  agentKey?: string;
  actor?: string;
}) {
  await ensureRetiroStockTables();
  const agentKey = params.agentKey || DEFAULT_RETIRO_AGENT;
  await prisma.$executeRawUnsafe(
    `INSERT INTO lm_retiro_handoffs (crm_order_id, agent_key, scheduled_at, actor, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (crm_order_id) DO UPDATE SET
       scheduled_at = EXCLUDED.scheduled_at,
       agent_key = EXCLUDED.agent_key,
       actor = COALESCE(EXCLUDED.actor, lm_retiro_handoffs.actor),
       updated_at = NOW()`,
    params.orderId,
    agentKey,
    params.scheduledAt,
    params.actor || null,
  );
}

export async function getHandoffsForOrders(orderIds: string[]) {
  if (orderIds.length === 0) {
    return {} as Record<string, {
      scheduledAt: string | null;
      handedByName: string | null;
      confirmedAt: string | null;
      stockApplied: boolean;
    }>;
  }

  await ensureRetiroStockTables();
  const rows = await prisma.$queryRawUnsafe<{
    crm_order_id: string;
    scheduled_at: Date | null;
    handed_by_name: string | null;
    confirmed_at: Date | null;
    stock_applied: boolean;
  }[]>(
    `SELECT crm_order_id, scheduled_at, handed_by_name, confirmed_at, stock_applied
     FROM lm_retiro_handoffs
     WHERE crm_order_id = ANY($1::text[])`,
    orderIds,
  );

  const map: Record<string, {
    scheduledAt: string | null;
    handedByName: string | null;
    confirmedAt: string | null;
    stockApplied: boolean;
  }> = {};
  for (const row of rows) {
    map[row.crm_order_id] = {
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      handedByName: row.handed_by_name,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      stockApplied: Boolean(row.stock_applied),
    };
  }
  return map;
}
