/**
 * Backfill lm_orders from CRM Order rows for managed tenants.
 *
 * Rules:
 * - INSERT ... ON CONFLICT (crm_order_id) DO NOTHING (never overwrite existing lm rows)
 * - Never update CRM Order
 * - Leave archived_at / completed_at / billed_* NULL (finance-safe)
 * - Infer carrier conservatively from courier / orderType / ShippingGuia
 *
 * Usage: node tools/logistics/backfill-lm-orders.cjs [--dry-run]
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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

const CUTOFF = new Date('2026-02-22T00:00:00.000Z');
const DRY_RUN = process.argv.includes('--dry-run');

const GREEN_DELIVERY_VARIANTS = new Set([
  'green delivery',
  'green delivey',
  'green delyvery',
  'greendelivery',
]);

function normalizeCourierText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferLogisticsCarrier({ orderType, courier, hasCorreosGuia }) {
  if (hasCorreosGuia) return 'correos';
  const ot = String(orderType || '').toUpperCase();
  const c = normalizeCourierText(courier);
  if (ot === 'RA') {
    if (!c || c === 'null' || c === '-') return 'retiro';
    return null;
  }
  if (ot === 'EA') {
    if (!c || c === 'null' || c === '-') return null;
    if (c.includes('correos') || c === 'ccr' || c.startsWith('ccr ')) return 'correos';
    if (c.includes('mensajeria') || GREEN_DELIVERY_VARIANTS.has(c)) return 'mensajeria';
    return null;
  }
  return null;
}

function mapCrmStatusToLogisticsStatus(status, delivery) {
  const raw = String(status || delivery || '').trim();
  const n = normalizeCourierText(raw);
  switch (n) {
    case 'pendiente':
    case 'pending':
      return 'Pendiente';
    case 'en proceso':
    case 'processing':
      return 'En Proceso';
    case 'enviado':
    case 'shipped':
    case 'en transito':
      return 'En Tránsito';
    case 'impreso':
      return 'Impreso';
    case 'entregado':
      return 'Entregado';
    case 'devuelto':
    case 'cancelled':
    case 'canceled':
      return 'Devuelto';
    default:
      return 'Pendiente';
  }
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — no writes\n' : 'Backfilling lm_orders...\n');

  const lmExists = await prisma.$queryRawUnsafe(`
    SELECT 1 AS ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name='lm_orders' LIMIT 1
  `);
  if (!lmExists.length) {
    throw new Error('lm_orders missing — run tools/logistics/restore-schema.cjs first');
  }

  const tenantsSql = MANAGED_TENANT_IDS.map((id) => `'${id}'`).join(',');

  const orders = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."tenantId", o."orderType", o.courier, o.status, o.delivery,
           o."contraEntrega", o."cePaymentConfirmed", o."orderId",
           EXISTS (
             SELECT 1 FROM "ShippingGuia" sg
             WHERE sg."tenantId" = o."tenantId"
               AND sg."orderId" = o."orderId"
               AND sg.carrier = 'correos_cr'
               AND (
                 sg."guiaNumber" IS NOT NULL
                 OR sg."trackingNumber" IS NOT NULL
                 OR sg."pdfFileName" IS NOT NULL
                 OR sg.status = 'completed'
               )
           ) AS has_correos_guia
    FROM "Order" o
    WHERE o."tenantId" IN (${tenantsSql})
      AND o.timestamp >= '${CUTOFF.toISOString()}'
    ORDER BY o.timestamp DESC
  `);

  console.log(`Candidates since cutoff: ${orders.length}`);

  const summary = {
    total: orders.length,
    insert: 0,
    skipExisting: 0,
    byCarrier: { mensajeria: 0, correos: 0, retiro: 0, unassigned: 0 },
    byStatus: {},
    conflicts: 0,
  };

  // Existing ids
  const existing = await prisma.$queryRawUnsafe(`SELECT crm_order_id FROM lm_orders`);
  const existingSet = new Set(existing.map((r) => r.crm_order_id));

  const batch = [];
  for (const o of orders) {
    if (existingSet.has(o.id)) {
      summary.skipExisting++;
      continue;
    }

    const carrier = inferLogisticsCarrier({
      orderType: o.orderType,
      courier: o.courier,
      hasCorreosGuia: o.has_correos_guia,
    });

    if (
      String(o.orderType).toUpperCase() === 'RA' &&
      normalizeCourierText(o.courier) &&
      normalizeCourierText(o.courier) !== '-' &&
      !carrier
    ) {
      summary.conflicts++;
    }

    if (!carrier) summary.byCarrier.unassigned++;
    else summary.byCarrier[carrier]++;

    const lmStatus = mapCrmStatusToLogisticsStatus(o.status, o.delivery);
    summary.byStatus[lmStatus] = (summary.byStatus[lmStatus] || 0) + 1;

    batch.push({
      id: o.id,
      tenantId: o.tenantId,
      carrier,
      status: lmStatus,
      ce: !!o.contraEntrega,
      collected: !!o.cePaymentConfirmed,
    });
  }

  console.log('Plan:', JSON.stringify(summary, null, 2));
  console.log(`Rows to insert: ${batch.length}`);

  if (DRY_RUN) {
    console.log('\nDry run complete — no rows written');
    return;
  }

  // Insert in chunks
  const CHUNK = 200;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    const values = slice
      .map((row, idx) => {
        const base = idx * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      })
      .join(',');
    const params = [];
    for (const row of slice) {
      params.push(row.id, row.tenantId, row.carrier, row.status, row.ce, row.collected);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO lm_orders (
          crm_order_id, crm_tenant_id, carrier, status,
          is_contra_entrega, contraentrega_collected
        ) VALUES ${values}
        ON CONFLICT (crm_order_id) DO NOTHING`,
      ...params,
    );
    summary.insert += slice.length;
    process.stdout.write(`  inserted ${Math.min(i + CHUNK, batch.length)}/${batch.length}\r`);
  }

  const count = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS c FROM lm_orders`);
  console.log(`\n✅ lm_orders count now: ${count[0].c}`);
  console.log('Inserted (attempted):', summary.insert, '| skipped existing:', summary.skipExisting);
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
