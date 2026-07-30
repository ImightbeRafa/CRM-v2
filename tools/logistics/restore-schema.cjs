/**
 * Restore missing Logistics Manager (lm_*) schema on the shared DB.
 *
 * IMPORTANT:
 * - Does NOT use prisma migrate / db push
 * - Additive only: CREATE IF NOT EXISTS / ALTER ADD COLUMN IF NOT EXISTS
 * - Does NOT modify CRM "Order" rows
 * - Does NOT seed retiro inventory quantities
 *
 * Usage: node tools/logistics/restore-schema.cjs
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function exec(label, sql) {
  process.stdout.write(`→ ${label}... `);
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log('ok');
  } catch (err) {
    console.log('FAIL');
    console.error(`  ${err.message?.slice(0, 400)}`);
    throw err;
  }
}

async function main() {
  console.log('Restoring logistics schema (additive, idempotent)...\n');

  // Preflight
  const db = await prisma.$queryRawUnsafe(`SELECT current_database() AS db, current_user AS usr`);
  console.log('DB:', db[0]);

  const orderExists = await prisma.$queryRawUnsafe(`
    SELECT 1 AS ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name='Order' LIMIT 1
  `);
  if (!orderExists.length) throw new Error('CRM Order table missing — aborting');

  // Advisory lock (session-level)
  await prisma.$executeRawUnsafe(`SELECT pg_advisory_lock(88442201)`);

  try {
    await exec('isLogisticsAdmin column', `
      ALTER TABLE "User"
        ADD COLUMN IF NOT EXISTS "isLogisticsAdmin" BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await exec('lm_is_admin()', `
      CREATE OR REPLACE FUNCTION lm_is_admin()
      RETURNS BOOLEAN
      LANGUAGE sql
      SECURITY DEFINER
      STABLE
      AS $$
        SELECT COALESCE(
          (
            SELECT u."isLogisticsAdmin"
            FROM "User" u
            INNER JOIN auth.users au ON au.email = u.email
            WHERE au.id = auth.uid()
            LIMIT 1
          ),
          FALSE
        );
      $$
    `);

    await exec('lm_tenant_links', `
      CREATE TABLE IF NOT EXISTS lm_tenant_links (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     TEXT        NOT NULL UNIQUE,
        display_name  TEXT        NOT NULL,
        slug          TEXT,
        active        BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await exec('lm_tenant_links RLS', `ALTER TABLE lm_tenant_links ENABLE ROW LEVEL SECURITY`);
    await exec('lm_tenant_links policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_tenant_links: admin only" ON lm_tenant_links;
        CREATE POLICY "lm_tenant_links: admin only" ON lm_tenant_links
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    await exec('seed lm_tenant_links', `
      INSERT INTO lm_tenant_links (tenant_id, display_name, slug) VALUES
        ('cmh32z0ol0000k004hvx9tg3p', 'WhatASheet''s Organization', 'whatasheetcr'),
        ('cmhsibjue0004js04gie724nx', 'DeepSleep',                  'deepsleepp-cr'),
        ('cmhutd1th0000jp04oqibtz54', 'WAS CR''s Organization',     'whatasheetcr-2'),
        ('cmigornmw0000lb04kl75262e', 'Kroma Lab''s Organization',  'tazaskroma'),
        ('cmjdabz4d0000il04dyc5qmcc', 'SimplePatch',                'simplepatch'),
        ('cmln5u7k70000ld042qify2og', 'DeepCLean',                  'deepcleancr07'),
        ('cmh44aerw0006vijg0640vfl0', 'PeterTesting',               'peter'),
        ('cmm4pv8fl0000jr045en1nik9', 'Managed Tenant 8',           'managed-8')
      ON CONFLICT (tenant_id) DO NOTHING
    `);

    await exec('lm_order_statuses', `
      CREATE TABLE IF NOT EXISTS lm_order_statuses (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        carrier     TEXT        NOT NULL,
        name        TEXT        NOT NULL,
        color       TEXT        NOT NULL DEFAULT '#6c63ff',
        position    INTEGER     NOT NULL DEFAULT 0,
        is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await exec('lm_order_statuses unique', `
      CREATE UNIQUE INDEX IF NOT EXISTS lm_order_statuses_carrier_name_uidx
      ON lm_order_statuses (carrier, name)
    `);
    await exec('lm_order_statuses RLS', `ALTER TABLE lm_order_statuses ENABLE ROW LEVEL SECURITY`);
    await exec('lm_order_statuses policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_order_statuses: admin only" ON lm_order_statuses;
        CREATE POLICY "lm_order_statuses: admin only" ON lm_order_statuses
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);
    await exec('seed lm_order_statuses', `
      INSERT INTO lm_order_statuses (carrier, name, color, position, is_default) VALUES
        ('mensajeria', 'Pendiente',    '#64748b', 0, TRUE),
        ('mensajeria', 'En Proceso',   '#6c63ff', 1, FALSE),
        ('mensajeria', 'En Tránsito',  '#f59e0b', 2, FALSE),
        ('mensajeria', 'Entregado',    '#22c55e', 3, FALSE),
        ('mensajeria', 'Devuelto',     '#ef4444', 4, FALSE),
        ('correos',    'Pendiente',    '#64748b', 0, TRUE),
        ('correos',    'En Sucursal',  '#3b82f6', 1, FALSE),
        ('correos',    'En Tránsito',  '#f59e0b', 2, FALSE),
        ('correos',    'Entregado',    '#22c55e', 3, FALSE),
        ('correos',    'Devuelto',     '#ef4444', 4, FALSE),
        ('retiro',     'Pendiente',    '#64748b', 0, TRUE),
        ('retiro',     'Entregado',    '#22c55e', 1, FALSE)
      ON CONFLICT (carrier, name) DO NOTHING
    `);

    // Final lm_orders shape (nullable carrier, text status, CE, archive, completion, billing, cost)
    await exec('lm_orders', `
      CREATE TABLE IF NOT EXISTS lm_orders (
        id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        crm_order_id             TEXT        NOT NULL UNIQUE,
        crm_tenant_id            TEXT        NOT NULL,
        carrier                  TEXT,
        status_id                UUID,
        status                   TEXT        NOT NULL DEFAULT 'Pendiente',
        tracking_number          TEXT,
        weight_kg                NUMERIC(8,2),
        declared_value           NUMERIC(12,2),
        recipient_province       TEXT,
        notes                    TEXT,
        is_contra_entrega        BOOLEAN     NOT NULL DEFAULT FALSE,
        contraentrega_collected  BOOLEAN     NOT NULL DEFAULT FALSE,
        archived_at              TIMESTAMPTZ,
        completed_at             TIMESTAMPTZ,
        completed_by             TEXT,
        correos_shipping_cost    NUMERIC(12,2),
        billed_week_id           INTEGER,
        billed_at                TIMESTAMPTZ,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Ensure columns if an older partial table somehow exists
    const alterCols = [
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pendiente'`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS is_contra_entrega BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS contraentrega_collected BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS completed_by TEXT`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS correos_shipping_cost NUMERIC(12,2)`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS billed_week_id INTEGER`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ`,
      `ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      `ALTER TABLE lm_orders DROP CONSTRAINT IF EXISTS lm_orders_carrier_check`,
      `ALTER TABLE lm_orders ALTER COLUMN carrier DROP NOT NULL`,
    ];
    for (const sql of alterCols) {
      await exec(sql.slice(0, 60), sql);
    }

    const indexes = [
      'CREATE INDEX IF NOT EXISTS lm_orders_crm_order ON lm_orders(crm_order_id)',
      'CREATE INDEX IF NOT EXISTS lm_orders_tenant ON lm_orders(crm_tenant_id)',
      'CREATE INDEX IF NOT EXISTS lm_orders_carrier ON lm_orders(carrier)',
      'CREATE INDEX IF NOT EXISTS idx_lm_orders_contra_entrega ON lm_orders(is_contra_entrega)',
      'CREATE INDEX IF NOT EXISTS idx_lm_orders_archived ON lm_orders(archived_at)',
      'CREATE INDEX IF NOT EXISTS idx_lm_orders_carrier_status ON lm_orders(carrier, status)',
      'CREATE INDEX IF NOT EXISTS idx_lm_orders_billed ON lm_orders(billed_week_id)',
    ];
    for (const sql of indexes) {
      await exec(sql.slice(0, 70), sql);
    }

    await exec('lm_orders updated_at trigger fn', `
      CREATE OR REPLACE FUNCTION lm_update_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $$
    `);
    await exec('drop lm_orders updated_at trigger', `
      DROP TRIGGER IF EXISTS lm_orders_updated_at ON lm_orders
    `);
    await exec('create lm_orders updated_at trigger', `
      CREATE TRIGGER lm_orders_updated_at
        BEFORE UPDATE ON lm_orders
        FOR EACH ROW EXECUTE FUNCTION lm_update_updated_at()
    `);

    await exec('lm_orders RLS', `ALTER TABLE lm_orders ENABLE ROW LEVEL SECURITY`);
    await exec('lm_orders policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_orders: admin only" ON lm_orders;
        CREATE POLICY "lm_orders: admin only" ON lm_orders
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    await exec('lm_carrier_configs', `
      CREATE TABLE IF NOT EXISTS lm_carrier_configs (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        carrier     TEXT,
        key         TEXT        NOT NULL,
        value       TEXT        NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await exec('lm_carrier_configs key unique', `
      CREATE UNIQUE INDEX IF NOT EXISTS lm_carrier_configs_key_unique ON lm_carrier_configs(key)
    `);
    await exec('lm_carrier_configs updated_at', `
      ALTER TABLE lm_carrier_configs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
    await exec('lm_carrier_configs RLS', `ALTER TABLE lm_carrier_configs ENABLE ROW LEVEL SECURITY`);
    await exec('lm_carrier_configs policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_carrier_configs: admin only" ON lm_carrier_configs;
        CREATE POLICY "lm_carrier_configs: admin only" ON lm_carrier_configs
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);
    await exec('seed lm_carrier_configs', `
      INSERT INTO lm_carrier_configs (carrier, key, value, description) VALUES
        (NULL, 'mensajeria_rate', '2600', 'Flat shipping rate for private courier per package'),
        (NULL, 'correos_rate', '2500', 'Flat shipping rate for Correos CR per package'),
        (NULL, 'handling_rate', '600', 'Handling/management cost per package'),
        (NULL, 'salary_daily_rate', '10000', 'Staff daily salary rate in colones'),
        (NULL, 'gd_recoleccion_cost', '2700', 'Green Delivery flat pickup/recolección fee per trip'),
        (NULL, 'logistics_tg_chat_id', '', 'Telegram chat ID for nightly logistics report')
      ON CONFLICT (key) DO NOTHING
    `);

    await exec('lm_ce_payments', `
      CREATE TABLE IF NOT EXISTS lm_ce_payments (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        crm_order_id   TEXT        NOT NULL,
        crm_tenant_id   TEXT        NOT NULL,
        amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
        collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        notes           TEXT,
        confirmed_by    TEXT,
        payment_method  TEXT,
        confirmed_by_employee_id TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await exec('lm_ce_payments payment_method', `
      ALTER TABLE lm_ce_payments ADD COLUMN IF NOT EXISTS payment_method TEXT
    `);
    await exec('lm_ce_payments confirmed_by_employee_id', `
      ALTER TABLE lm_ce_payments ADD COLUMN IF NOT EXISTS confirmed_by_employee_id TEXT
    `);
    await exec('lm_ce_payments RLS', `ALTER TABLE lm_ce_payments ENABLE ROW LEVEL SECURITY`);
    await exec('lm_ce_payments policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_ce_payments: admin only" ON lm_ce_payments;
        CREATE POLICY "lm_ce_payments: admin only" ON lm_ce_payments
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    await exec('lm_order_events', `
      CREATE TABLE IF NOT EXISTS lm_order_events (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        crm_order_id   TEXT        NOT NULL,
        event_type      TEXT        NOT NULL,
        payload         JSONB,
        actor           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await exec('lm_order_events RLS', `ALTER TABLE lm_order_events ENABLE ROW LEVEL SECURITY`);
    await exec('lm_order_events policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_order_events: admin only" ON lm_order_events;
        CREATE POLICY "lm_order_events: admin only" ON lm_order_events
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    await exec('lm_billing_weeks', `
      CREATE TABLE IF NOT EXISTS lm_billing_weeks (
        id            SERIAL      PRIMARY KEY,
        week_start    DATE        NOT NULL,
        week_end      DATE        NOT NULL,
        finalized_at  TIMESTAMPTZ,
        finalized_by  TEXT,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT lm_billing_weeks_week_start_unique UNIQUE (week_start),
        CONSTRAINT lm_billing_weeks_valid_range CHECK (week_end > week_start)
      )
    `);
    await exec('lm_billing_weeks RLS', `ALTER TABLE lm_billing_weeks ENABLE ROW LEVEL SECURITY`);
    await exec('lm_billing_weeks policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_billing_weeks: admin only" ON lm_billing_weeks;
        CREATE POLICY "lm_billing_weeks: admin only" ON lm_billing_weeks
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    // FK for billed_week_id if possible
    await exec('lm_orders billed_week FK', `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'lm_orders_billed_week_id_fkey'
        ) THEN
          ALTER TABLE lm_orders
            ADD CONSTRAINT lm_orders_billed_week_id_fkey
            FOREIGN KEY (billed_week_id) REFERENCES lm_billing_weeks(id) ON DELETE SET NULL;
        END IF;
      END $$
    `);

    await exec('lm_work_days', `
      CREATE TABLE IF NOT EXISTS lm_work_days (
        id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_name  TEXT  NOT NULL,
        work_date   DATE  NOT NULL,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (staff_name, work_date)
      )
    `);
    await exec('lm_work_days RLS', `ALTER TABLE lm_work_days ENABLE ROW LEVEL SECURITY`);
    await exec('lm_work_days policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_work_days: admin only" ON lm_work_days;
        CREATE POLICY "lm_work_days: admin only" ON lm_work_days
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    await exec('lm_gd_balance_entries', `
      CREATE TABLE IF NOT EXISTS lm_gd_balance_entries (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        amount      NUMERIC(12,2) NOT NULL,
        entry_type  TEXT        NOT NULL CHECK (entry_type IN ('charge', 'payment')),
        description TEXT,
        entry_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
        actor       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await exec('lm_gd_balance_entries RLS', `ALTER TABLE lm_gd_balance_entries ENABLE ROW LEVEL SECURITY`);
    await exec('lm_gd_balance_entries policy', `
      DO $$ BEGIN
        DROP POLICY IF EXISTS "lm_gd_balance_entries: admin only" ON lm_gd_balance_entries;
        CREATE POLICY "lm_gd_balance_entries: admin only" ON lm_gd_balance_entries
          FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
      END $$
    `);

    // Retiro tables (schema only — no inventory seed)
    await exec('lm_retiro_stock', `
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
    await exec('lm_retiro_stock_movements', `
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
    await exec('lm_retiro_product_aliases', `
      CREATE TABLE IF NOT EXISTS lm_retiro_product_aliases (
        id BIGSERIAL PRIMARY KEY,
        agent_key TEXT NOT NULL,
        sku TEXT NOT NULL,
        alias_normalized TEXT NOT NULL,
        alias_raw TEXT NOT NULL,
        UNIQUE (agent_key, alias_normalized)
      )
    `);
    await exec('lm_retiro_handoffs', `
      CREATE TABLE IF NOT EXISTS lm_retiro_handoffs (
        crm_order_id TEXT PRIMARY KEY,
        agent_key TEXT NOT NULL DEFAULT 'laura',
        scheduled_at TIMESTAMPTZ,
        handed_by_employee_id TEXT,
        handed_by_name TEXT,
        confirmed_at TIMESTAMPTZ,
        stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
        actor TEXT,
        pickup_location TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await exec('lm_retiro_handoffs pickup_location', `
      ALTER TABLE lm_retiro_handoffs ADD COLUMN IF NOT EXISTS pickup_location TEXT
    `);

    await exec('lm_private_delivery_confirmations', `
      CREATE TABLE IF NOT EXISTS lm_private_delivery_confirmations (
        id BIGSERIAL PRIMARY KEY,
        crm_order_id TEXT NOT NULL UNIQUE,
        crm_tenant_id TEXT NOT NULL,
        cost_amount NUMERIC(12,2) NOT NULL DEFAULT 2500,
        delivery_confirmed_at TIMESTAMPTZ,
        paid_confirmed_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        notes TEXT,
        actor TEXT,
        settlement_method TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Verify
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE 'lm_%'
      ORDER BY table_name
    `);
    console.log('\nRestored lm_* tables:');
    for (const t of tables) console.log(' -', t.table_name);

    if (!tables.some((t) => t.table_name === 'lm_orders')) {
      throw new Error('lm_orders was not created');
    }

    console.log('\n✅ Logistics schema restore complete');
  } finally {
    await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(88442201)`);
  }
}

main()
  .catch((e) => {
    console.error('\n❌ Restore failed:', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
