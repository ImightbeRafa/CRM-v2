-- ============================================================
-- Logistics Manager — Migration 005 (Phase 2)
-- Run in Supabase SQL Editor (fully idempotent)
-- Adds: CE payment records, order event log, work days, 
--       Green Delivery balance, new config keys
-- ============================================================

-- ─── 1. CE Payment Records ────────────────────────────────────
-- Stores confirmed contra entrega payment events per order.
CREATE TABLE IF NOT EXISTS lm_ce_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id    TEXT        NOT NULL,           -- references Order.id in Prisma
  crm_tenant_id   TEXT        NOT NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,
  confirmed_by    TEXT,                           -- logistics admin email
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_ce_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_ce_payments: admin only" ON lm_ce_payments;
CREATE POLICY "lm_ce_payments: admin only" ON lm_ce_payments
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS idx_lm_ce_payments_order  ON lm_ce_payments(crm_order_id);
CREATE INDEX IF NOT EXISTS idx_lm_ce_payments_tenant ON lm_ce_payments(crm_tenant_id);
CREATE INDEX IF NOT EXISTS idx_lm_ce_payments_date   ON lm_ce_payments(collected_at DESC);

-- ─── 2. Order Event Log ──────────────────────────────────────
-- Audit trail: every action on a logistics order is logged here.
-- event_type values: 'carrier_assigned' | 'status_change' | 'ce_confirmed' | 'guia_generated' | 'note' | 'bulk_update'
CREATE TABLE IF NOT EXISTS lm_order_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id    TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB,                          -- e.g. { from: 'Pendiente', to: 'En Tránsito' }
  actor           TEXT,                           -- logistics admin email
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_order_events: admin only" ON lm_order_events;
CREATE POLICY "lm_order_events: admin only" ON lm_order_events
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS idx_lm_order_events_order   ON lm_order_events(crm_order_id);
CREATE INDEX IF NOT EXISTS idx_lm_order_events_type    ON lm_order_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lm_order_events_created ON lm_order_events(created_at DESC);

-- ─── 3. Work Days (Staff Salary Tracking) ────────────────────
CREATE TABLE IF NOT EXISTS lm_work_days (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_name  TEXT  NOT NULL,
  work_date   DATE  NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_name, work_date)
);

ALTER TABLE lm_work_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_work_days: admin only" ON lm_work_days;
CREATE POLICY "lm_work_days: admin only" ON lm_work_days
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS idx_lm_work_days_staff ON lm_work_days(staff_name);
CREATE INDEX IF NOT EXISTS idx_lm_work_days_date  ON lm_work_days(work_date DESC);

-- ─── 4. Green Delivery Balance Ledger ────────────────────────
-- Tracks the running balance for the Green Delivery (mensajería) account.
-- Positive entries = charges (packages shipped), Negative = payments received.
CREATE TABLE IF NOT EXISTS lm_gd_balance_entries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  amount      NUMERIC(12,2) NOT NULL,             -- positive = charge, negative = payment received
  entry_type  TEXT        NOT NULL CHECK (entry_type IN ('charge', 'payment')),
  description TEXT,
  entry_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  actor       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_gd_balance_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_gd_balance_entries: admin only" ON lm_gd_balance_entries;
CREATE POLICY "lm_gd_balance_entries: admin only" ON lm_gd_balance_entries
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS idx_lm_gd_balance_date ON lm_gd_balance_entries(entry_date DESC);

-- ─── 5. New Config Keys ───────────────────────────────────────
INSERT INTO lm_carrier_configs (carrier, key, value, description)
VALUES
  -- Daily salary rate (in colones)
  (NULL, 'salary_daily_rate',    '10000', 'Staff daily salary rate in colones'),
  -- Green Delivery flat recolección trip cost (per pickup, not per package)
  (NULL, 'gd_recoleccion_cost',  '2700',  'Green Delivery flat pickup/recolección fee per trip'),
  -- Telegram chat ID for nightly logistics reports
  (NULL, 'logistics_tg_chat_id', '',      'Telegram chat ID for nightly logistics report')
ON CONFLICT (key) DO NOTHING;
