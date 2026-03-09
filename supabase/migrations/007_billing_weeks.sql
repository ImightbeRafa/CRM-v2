-- ============================================================
-- Logistics Manager — Migration 007 (Billing Weeks)
-- Run in Supabase SQL Editor (fully idempotent)
-- Adds: lm_billing_weeks table, billed_week_id/billed_at on lm_orders
-- Prevents double-charging by locking orders to finalized weeks.
-- ============================================================

-- ─── 0. Ensure RLS helper exists (originally from 002) ─────
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
$$;

-- ─── 1. Billing Weeks Table ────────────────────────────────
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
);

ALTER TABLE lm_billing_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_billing_weeks: admin only" ON lm_billing_weeks;
CREATE POLICY "lm_billing_weeks: admin only" ON lm_billing_weeks
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS idx_lm_billing_weeks_start ON lm_billing_weeks(week_start DESC);

-- ─── 2. Add billing columns to lm_orders ───────────────────
ALTER TABLE lm_orders
  ADD COLUMN IF NOT EXISTS billed_week_id INTEGER REFERENCES lm_billing_weeks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lm_orders_billed ON lm_orders(billed_week_id);
CREATE INDEX IF NOT EXISTS idx_lm_orders_unbilled ON lm_orders(status) WHERE billed_week_id IS NULL;
