import { prisma } from '@/lib/db';
import {
  buildMappingSlots,
  linesNeedIndependentSlots,
  mapOrderLinesLocal,
  normalizeProductName,
  type RetiroAllocationRow,
  type RetiroOrderLine,
} from '@/lib/retiro-stock-utils';
import {
  RETIRO_PICKUP_LOCATIONS,
  normalizePickupLocation,
  pickupLocationLabel,
  usesRetiroInventory,
  type RetiroPickupLocation,
} from '@/lib/retiro-locations';

export type { RetiroOrderLine };
export {
  buildAliasMapFromRows,
  buildMappingSlots,
  extractOrderLines,
  linesNeedIndependentSlots,
  mapOrderLinesLocal,
  normalizeProductName,
  orderContainsProductLabel,
  resolveSkuFromMap,
  shouldPersistGlobalAlias,
} from '@/lib/retiro-stock-utils';
export type { RetiroAllocationRow, RetiroMappingSlot } from '@/lib/retiro-stock-utils';
export {
  RETIRO_PICKUP_LOCATIONS,
  normalizePickupLocation,
  pickupLocationLabel,
  usesRetiroInventory,
  type RetiroPickupLocation,
} from '@/lib/retiro-locations';

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
  { sku: 'energia', displayName: 'Energía', qty: 10, minQty: 3, aliases: ['energia', 'energía', 'energy', 'energy patch'] },
  { sku: 'focus', displayName: 'Focus', qty: 10, minQty: 3, aliases: ['focus', 'focus patch'] },
  { sku: 'dopamina', displayName: 'Dopamina', qty: 10, minQty: 3, aliases: ['dopamina', 'dopamine', 'dopa', 'dopamine patch'] },
  { sku: 'estres', displayName: 'Estres', qty: 10, minQty: 3, aliases: ['estres', 'estrés', 'stress', 'stress patch'] },
  { sku: 'glp', displayName: 'GLP', qty: 10, minQty: 3, aliases: ['glp', 'glp-1', 'glp1', 'glp patch'] },
  { sku: 'sleeping', displayName: 'Sleeping', qty: 15, minQty: 5, aliases: ['sleeping', 'sleep', 'sleeping patch', 'sleeping patches'] },
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
      await prisma.$executeRawUnsafe(`
        ALTER TABLE lm_retiro_handoffs
        ADD COLUMN IF NOT EXISTS pickup_location TEXT
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_retiro_handoffs_confirmed_idx
        ON lm_retiro_handoffs (confirmed_at DESC)
        WHERE confirmed_at IS NOT NULL
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_retiro_order_allocations (
          crm_order_id TEXT NOT NULL,
          slot_key TEXT NOT NULL,
          sku TEXT NOT NULL,
          qty INTEGER NOT NULL,
          raw_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (crm_order_id, slot_key)
        )
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

export class RetiroAliasConflictError extends Error {
  readonly status = 409 as const;
  constructor(
    public existingSku: string,
    public existingDisplayName: string,
  ) {
    super(`Este producto ya está mapeado a ${existingDisplayName}`);
    this.name = 'RetiroAliasConflictError';
  }
}

export class RetiroAliasValidationError extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = 'RetiroAliasValidationError';
  }
}

export type UpsertProductAliasResult = {
  sku: string;
  displayName: string;
  aliasNormalized: string;
  aliasRaw: string;
  created: boolean;
  previousSku: string | null;
};

export async function upsertProductAlias(params: {
  rawName: string;
  sku: string;
  overwrite?: boolean;
  actor?: string;
  orderId?: string | null;
}): Promise<UpsertProductAliasResult> {
  const agentKey = DEFAULT_RETIRO_AGENT;
  const rawName = params.rawName.trim().slice(0, 200);
  const sku = params.sku.trim().slice(0, 64);
  const aliasNormalized = normalizeProductName(rawName);

  if (!rawName || !aliasNormalized) {
    throw new RetiroAliasValidationError('Nombre de producto requerido');
  }
  if (!sku) {
    throw new RetiroAliasValidationError('SKU requerido');
  }

  await ensureRetiroStockTables();

  const stockRows = await prisma.$queryRawUnsafe<{ sku: string; display_name: string }[]>(
    `SELECT sku, display_name FROM lm_retiro_stock
     WHERE agent_key = $1 AND sku = $2 AND active = TRUE
     LIMIT 1`,
    agentKey,
    sku,
  );
  if (!stockRows[0]) {
    throw new RetiroAliasValidationError('SKU desconocido o inactivo en el inventario de Laura');
  }

  const existing = await prisma.$queryRawUnsafe<{ sku: string }[]>(
    `SELECT sku FROM lm_retiro_product_aliases
     WHERE agent_key = $1 AND alias_normalized = $2
     LIMIT 1`,
    agentKey,
    aliasNormalized,
  );
  const previousSku = existing[0]?.sku ?? null;

  if (previousSku && previousSku !== sku && !params.overwrite) {
    const prevDisplay = await prisma.$queryRawUnsafe<{ display_name: string }[]>(
      `SELECT display_name FROM lm_retiro_stock WHERE agent_key = $1 AND sku = $2 LIMIT 1`,
      agentKey,
      previousSku,
    );
    throw new RetiroAliasConflictError(previousSku, prevDisplay[0]?.display_name || previousSku);
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO lm_retiro_product_aliases (agent_key, sku, alias_normalized, alias_raw)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_key, alias_normalized) DO UPDATE SET
       sku = EXCLUDED.sku,
       alias_raw = EXCLUDED.alias_raw`,
    agentKey,
    sku,
    aliasNormalized,
    rawName,
  );

  if (params.orderId && previousSku !== sku) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
         VALUES ($1, 'retiro_product_mapped', $2::jsonb, $3)`,
        params.orderId,
        JSON.stringify({
          aliasNormalized,
          sku,
          displayName: stockRows[0].display_name,
          previousSku,
          overwrite: Boolean(params.overwrite),
        }),
        params.actor || null,
      );
    } catch (err) {
      console.error('[retiro-stock] alias audit event failed', err);
    }
  }

  return {
    sku,
    displayName: stockRows[0].display_name,
    aliasNormalized,
    aliasRaw: rawName,
    created: !previousSku,
    previousSku: previousSku === sku ? null : previousSku,
  };
}

export async function listOrderAllocations(orderId: string): Promise<RetiroAllocationRow[]> {
  await ensureRetiroStockTables();
  const rows = await prisma.$queryRawUnsafe<{
    slot_key: string;
    sku: string;
    qty: number;
    raw_name: string;
    display_name: string | null;
  }[]>(
    `SELECT a.slot_key, a.sku, a.qty, a.raw_name, s.display_name
     FROM lm_retiro_order_allocations a
     LEFT JOIN lm_retiro_stock s ON s.agent_key = $2 AND s.sku = a.sku
     WHERE a.crm_order_id = $1
     ORDER BY a.slot_key`,
    orderId,
    DEFAULT_RETIRO_AGENT,
  );
  return rows.map((row) => ({
    slotKey: row.slot_key,
    sku: row.sku,
    qty: Number(row.qty) || 1,
    rawName: row.raw_name,
    displayName: row.display_name,
  }));
}

export async function getAllocationsForOrders(orderIds: string[]): Promise<Record<string, RetiroAllocationRow[]>> {
  if (orderIds.length === 0) return {};
  await ensureRetiroStockTables();
  const rows = await prisma.$queryRawUnsafe<{
    crm_order_id: string;
    slot_key: string;
    sku: string;
    qty: number;
    raw_name: string;
    display_name: string | null;
  }[]>(
    `SELECT a.crm_order_id, a.slot_key, a.sku, a.qty, a.raw_name, s.display_name
     FROM lm_retiro_order_allocations a
     LEFT JOIN lm_retiro_stock s ON s.agent_key = $2 AND s.sku = a.sku
     WHERE a.crm_order_id = ANY($1::text[])
     ORDER BY a.crm_order_id, a.slot_key`,
    orderIds,
    DEFAULT_RETIRO_AGENT,
  );

  const map: Record<string, RetiroAllocationRow[]> = {};
  for (const row of rows) {
    if (!map[row.crm_order_id]) map[row.crm_order_id] = [];
    map[row.crm_order_id].push({
      slotKey: row.slot_key,
      sku: row.sku,
      qty: Number(row.qty) || 1,
      rawName: row.raw_name,
      displayName: row.display_name,
    });
  }
  return map;
}

export async function upsertOrderAllocation(params: {
  orderId: string;
  slotKey: string;
  rawName: string;
  sku: string;
  qty?: number;
}): Promise<RetiroAllocationRow> {
  const orderId = params.orderId.trim().slice(0, 128);
  const slotKey = params.slotKey.trim().slice(0, 32);
  const rawName = params.rawName.trim().slice(0, 200);
  const sku = params.sku.trim().slice(0, 64);
  const qty = Math.max(1, Math.min(100, Math.floor(Number(params.qty) || 1)));

  if (!orderId || !slotKey || !rawName || !sku) {
    throw new RetiroAliasValidationError('Datos de mapeo incompletos');
  }
  if (!/^[0-9]+(?::[0-9]+)?$/.test(slotKey)) {
    throw new RetiroAliasValidationError('slotKey inválido');
  }

  await ensureRetiroStockTables();
  const stockRows = await prisma.$queryRawUnsafe<{ sku: string; display_name: string }[]>(
    `SELECT sku, display_name FROM lm_retiro_stock
     WHERE agent_key = $1 AND sku = $2 AND active = TRUE
     LIMIT 1`,
    DEFAULT_RETIRO_AGENT,
    sku,
  );
  if (!stockRows[0]) {
    throw new RetiroAliasValidationError('SKU desconocido o inactivo en el inventario de Laura');
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO lm_retiro_order_allocations (crm_order_id, slot_key, sku, qty, raw_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (crm_order_id, slot_key) DO UPDATE SET
       sku = EXCLUDED.sku,
       qty = EXCLUDED.qty,
       raw_name = EXCLUDED.raw_name`,
    orderId,
    slotKey,
    sku,
    qty,
    rawName,
  );

  return {
    slotKey,
    sku,
    qty,
    rawName,
    displayName: stockRows[0].display_name,
  };
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
  order: { id?: string; product?: string | null; quantity?: number | null; productDetails?: string | null },
  agentKey = DEFAULT_RETIRO_AGENT,
): Promise<RetiroOrderLine[]> {
  await ensureRetiroStockTables();
  const aliasMap = await loadAliasMap(agentKey);
  const lines = mapOrderLinesLocal(order, aliasMap);
  const allocations = order.id ? await listOrderAllocations(order.id) : [];
  if (allocations.length === 0 && !linesNeedIndependentSlots(lines)) {
    return lines;
  }
  return buildMappingSlots(lines, allocations).map((slot) => ({
    rawName: slot.rawName,
    qty: slot.qty,
    sku: slot.sku,
    displayName: slot.displayName,
  }));
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
  pickupLocation: RetiroPickupLocation;
}) {
  const agentKey = params.agentKey || DEFAULT_RETIRO_AGENT;
  const tracksInventory = usesRetiroInventory(params.pickupLocation);

  if (tracksInventory) {
    const unmapped = params.lines.filter((l) => !l.sku);
    if (unmapped.length > 0) {
      throw new Error(`Productos sin mapear al inventario de Laura: ${unmapped.map((l) => l.rawName).join(', ')}`);
    }
  }

  const bySku = new Map<string, { qty: number; displayName: string }>();
  if (tracksInventory) {
    for (const line of params.lines) {
      if (!line.sku) continue;
      const prev = bySku.get(line.sku);
      bySku.set(line.sku, {
        qty: (prev?.qty || 0) + line.qty,
        displayName: line.displayName || line.sku,
      });
    }
  }

  await ensureRetiroStockTables();

  type DecrementRow = { sku: string; displayName: string; qty: number; remaining: number };

  return prisma.$transaction(async (tx) => {
    const handoff = await tx.$queryRawUnsafe<{ stock_applied: boolean; confirmed_at: Date | null }[]>(
      `SELECT stock_applied, confirmed_at FROM lm_retiro_handoffs WHERE crm_order_id = $1`,
      params.orderId,
    );

    const refreshHandoffMeta = async () => {
      await tx.$executeRawUnsafe(
        `UPDATE lm_retiro_handoffs
         SET handed_by_employee_id = $2,
             handed_by_name = $3,
             pickup_location = $4,
             actor = $5,
             updated_at = NOW()
         WHERE crm_order_id = $1`,
        params.orderId,
        params.employeeId,
        params.employeeName,
        params.pickupLocation,
        params.actor,
      );
    };

    // Already confirmed or stock already applied: never re-apply / never flip flags.
    if (handoff[0]?.confirmed_at || handoff[0]?.stock_applied) {
      await refreshHandoffMeta();
      return {
        alreadyApplied: true as const,
        decrements: [] as DecrementRow[],
        stockApplied: Boolean(handoff[0].stock_applied),
      };
    }

    // Marlenn (and any non-Laura location): handoff only — no stock mapping/decrements.
    if (!tracksInventory) {
      await tx.$executeRawUnsafe(
        `INSERT INTO lm_retiro_handoffs (
           crm_order_id, agent_key, handed_by_employee_id, handed_by_name,
           pickup_location, confirmed_at, stock_applied, actor, updated_at
         ) VALUES ($1, $2, $3, $4, $5, NOW(), FALSE, $6, NOW())
         ON CONFLICT (crm_order_id) DO UPDATE SET
           agent_key = EXCLUDED.agent_key,
           handed_by_employee_id = EXCLUDED.handed_by_employee_id,
           handed_by_name = EXCLUDED.handed_by_name,
           pickup_location = EXCLUDED.pickup_location,
           confirmed_at = COALESCE(lm_retiro_handoffs.confirmed_at, NOW()),
           stock_applied = lm_retiro_handoffs.stock_applied,
           actor = EXCLUDED.actor,
           updated_at = NOW()`,
        params.orderId,
        agentKey,
        params.employeeId,
        params.employeeName,
        params.pickupLocation,
        params.actor,
      );

      return {
        alreadyApplied: false as const,
        decrements: [] as DecrementRow[],
        stockApplied: false as const,
      };
    }

    const decrements: DecrementRow[] = [];

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
        `Retirado · ${RETIRO_PICKUP_LOCATIONS[params.pickupLocation]} · ${params.employeeName}`,
      );
      decrements.push({ sku, displayName: rows[0].display_name, qty: info.qty, remaining });
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO lm_retiro_handoffs (
         crm_order_id, agent_key, handed_by_employee_id, handed_by_name,
         pickup_location, confirmed_at, stock_applied, actor, updated_at
       ) VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, $6, NOW())
       ON CONFLICT (crm_order_id) DO UPDATE SET
         agent_key = EXCLUDED.agent_key,
         handed_by_employee_id = EXCLUDED.handed_by_employee_id,
         handed_by_name = EXCLUDED.handed_by_name,
         pickup_location = EXCLUDED.pickup_location,
         confirmed_at = NOW(),
         stock_applied = TRUE,
         actor = EXCLUDED.actor,
         updated_at = NOW()`,
      params.orderId,
      agentKey,
      params.employeeId,
      params.employeeName,
      params.pickupLocation,
      params.actor,
    );

    return {
      alreadyApplied: false as const,
      decrements,
      stockApplied: true as const,
    };
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
      pickupLocation: string | null;
      pickupLocationLabel: string | null;
    }>;
  }

  await ensureRetiroStockTables();
  const rows = await prisma.$queryRawUnsafe<{
    crm_order_id: string;
    scheduled_at: Date | null;
    handed_by_name: string | null;
    confirmed_at: Date | null;
    stock_applied: boolean;
    pickup_location: string | null;
  }[]>(
    `SELECT crm_order_id, scheduled_at, handed_by_name, confirmed_at, stock_applied, pickup_location
     FROM lm_retiro_handoffs
     WHERE crm_order_id = ANY($1::text[])`,
    orderIds,
  );

  const map: Record<string, {
    scheduledAt: string | null;
    handedByName: string | null;
    confirmedAt: string | null;
    stockApplied: boolean;
    pickupLocation: string | null;
    pickupLocationLabel: string | null;
  }> = {};
  for (const row of rows) {
    map[row.crm_order_id] = {
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      handedByName: row.handed_by_name,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      stockApplied: Boolean(row.stock_applied),
      pickupLocation: row.pickup_location,
      pickupLocationLabel: pickupLocationLabel(row.pickup_location),
    };
  }
  return map;
}

export type ConfirmedRetiroHistoryItem = {
  orderId: string;
  orderRef: string;
  customerName: string;
  phone: string | null;
  tenantId: string;
  total: number;
  product: string | null;
  quantity: number | null;
  isContraEntrega: boolean;
  paymentMethod: 'sinpe' | 'efectivo' | null;
  paymentLabel: 'SINPE' | 'Efectivo' | null;
  paymentConfirmedBy: string | null;
  handedByName: string | null;
  handedByEmployeeId: string | null;
  pickupLocation: RetiroPickupLocation | null;
  pickupLocationLabel: string | null;
  confirmedAt: string;
  scheduledAt: string | null;
  actor: string | null;
};

export async function listConfirmedRetiros(limit = 100): Promise<ConfirmedRetiroHistoryItem[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 200);
  await ensureRetiroStockTables();

  const rows = await prisma.$queryRawUnsafe<{
    order_id: string;
    order_ref: string;
    customer_name: string;
    phone: string | null;
    tenant_id: string;
    total: number | string | null;
    product: string | null;
    quantity: number | null;
    is_contra_entrega: boolean;
    payment_method: string | null;
    payment_confirmed_by: string | null;
    handed_by_name: string | null;
    handed_by_employee_id: string | null;
    pickup_location: string | null;
    confirmed_at: Date;
    scheduled_at: Date | null;
    actor: string | null;
  }[]>(
    `SELECT
        o.id AS order_id,
        o."orderId" AS order_ref,
        o."customerName" AS customer_name,
        o.phone,
        o."tenantId" AS tenant_id,
        o.total,
        o.product,
        o.quantity,
        (COALESCE(o."contraEntrega", FALSE) OR COALESCE(lm.is_contra_entrega, FALSE)) AS is_contra_entrega,
        ce.payment_method,
        ce.confirmed_by AS payment_confirmed_by,
        h.handed_by_name,
        h.handed_by_employee_id,
        h.pickup_location,
        h.confirmed_at,
        h.scheduled_at,
        h.actor
     FROM lm_retiro_handoffs h
     INNER JOIN "Order" o ON o.id = h.crm_order_id
     LEFT JOIN lm_orders lm ON lm.crm_order_id = h.crm_order_id
     LEFT JOIN LATERAL (
       SELECT payment_method, confirmed_by
       FROM lm_ce_payments
       WHERE crm_order_id = h.crm_order_id
       ORDER BY collected_at DESC NULLS LAST
       LIMIT 1
     ) ce ON TRUE
     WHERE h.confirmed_at IS NOT NULL
       AND o."orderType" = 'RA'
     ORDER BY h.confirmed_at DESC
     LIMIT $1`,
    capped,
  );

  return rows.map((row) => {
    const method = typeof row.payment_method === 'string' ? row.payment_method.toLowerCase() : null;
    const paymentMethod = method === 'sinpe' || method === 'efectivo' ? method : null;
    const location = normalizePickupLocation(row.pickup_location);
    return {
      orderId: row.order_id,
      orderRef: row.order_ref,
      customerName: row.customer_name,
      phone: row.phone,
      tenantId: row.tenant_id,
      total: Number(row.total || 0),
      product: row.product,
      quantity: row.quantity,
      isContraEntrega: Boolean(row.is_contra_entrega),
      paymentMethod,
      paymentLabel: paymentMethod === 'sinpe' ? 'SINPE' : paymentMethod === 'efectivo' ? 'Efectivo' : null,
      paymentConfirmedBy: row.payment_confirmed_by,
      handedByName: row.handed_by_name,
      handedByEmployeeId: row.handed_by_employee_id,
      pickupLocation: location,
      pickupLocationLabel: location ? RETIRO_PICKUP_LOCATIONS[location] : pickupLocationLabel(row.pickup_location),
      confirmedAt: new Date(row.confirmed_at).toISOString(),
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      actor: row.actor,
    };
  });
}
