-- ============================================================
-- Betsy CRM - Logistics employee schedule persistence fix
-- Run this in Supabase SQL Editor if schedule changes in
-- Logistics > Accounting > Dias Trabajados do not persist.
--
-- Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lm_work_days (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_name TEXT NOT NULL,
  work_date  DATE NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_work_days
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS staff_name TEXT,
  ADD COLUMN IF NOT EXISTS work_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE lm_work_days SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE lm_work_days
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN staff_name SET NOT NULL,
  ALTER COLUMN work_date SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'lm_work_days'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE lm_work_days ADD CONSTRAINT lm_work_days_pkey PRIMARY KEY (id);
  END IF;
END $$;

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY staff_name, work_date
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM lm_work_days
)
DELETE FROM lm_work_days
WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS lm_work_days_staff_name_work_date_key
  ON lm_work_days(staff_name, work_date);

CREATE INDEX IF NOT EXISTS idx_lm_work_days_date
  ON lm_work_days(work_date DESC);

CREATE INDEX IF NOT EXISTS idx_lm_work_days_staff_date
  ON lm_work_days(staff_name, work_date DESC);

ALTER TABLE lm_work_days ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'lm_is_admin'
  ) THEN
    DROP POLICY IF EXISTS "lm_work_days: admin only" ON lm_work_days;
    CREATE POLICY "lm_work_days: admin only" ON lm_work_days
      FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
  END IF;
END $$;
