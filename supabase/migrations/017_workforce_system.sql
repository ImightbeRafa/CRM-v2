-- ============================================================
-- Logistics Workforce: schedule, employee codes, time clock,
-- payroll source data, and audit trail.
--
-- Safe to run more than once. Keeps legacy lm_work_days intact.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lm_employees (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name           TEXT NOT NULL,
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  hourly_rate_crc        NUMERIC(12,2) NOT NULL DEFAULT 1250,
  code_hash              TEXT UNIQUE,
  code_last_generated_at TIMESTAMPTZ,
  legacy_staff_name      TEXT UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lm_schedule_shifts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES lm_employees(id) ON DELETE CASCADE,
  work_date             DATE NOT NULL,
  shift_start           TIME,
  shift_end             TIME,
  expected_paid_minutes INTEGER NOT NULL DEFAULT 0 CHECK (expected_paid_minutes >= 0 AND expected_paid_minutes <= 1440),
  lunch_minutes         INTEGER NOT NULL DEFAULT 0 CHECK (lunch_minutes >= 0 AND lunch_minutes <= 240),
  is_off                BOOLEAN NOT NULL DEFAULT FALSE,
  notes                 TEXT,
  legacy_work_day_id    UUID UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS lm_time_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES lm_employees(id) ON DELETE CASCADE,
  clock_in_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out_at      TIMESTAMPTZ,
  hourly_rate_crc   NUMERIC(12,2) NOT NULL,
  paid_minutes      INTEGER CHECK (paid_minutes IS NULL OR paid_minutes >= 0),
  source            TEXT NOT NULL DEFAULT 'worker' CHECK (source IN ('worker', 'admin')),
  correction_note   TEXT,
  voided_at         TIMESTAMPTZ,
  created_by        TEXT,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lm_workforce_audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT,
  event_type    TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lm_employees_active
  ON lm_employees(active, display_name);

CREATE INDEX IF NOT EXISTS idx_lm_schedule_shifts_date
  ON lm_schedule_shifts(work_date);

CREATE INDEX IF NOT EXISTS idx_lm_schedule_shifts_employee_date
  ON lm_schedule_shifts(employee_id, work_date);

CREATE INDEX IF NOT EXISTS idx_lm_time_entries_employee_clock_in
  ON lm_time_entries(employee_id, clock_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_lm_time_entries_clock_in
  ON lm_time_entries(clock_in_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS lm_time_entries_one_open_per_employee
  ON lm_time_entries(employee_id)
  WHERE clock_out_at IS NULL AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lm_workforce_audit_created
  ON lm_workforce_audit_events(created_at DESC);

CREATE OR REPLACE FUNCTION lm_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lm_employees_updated_at ON lm_employees;
CREATE TRIGGER lm_employees_updated_at
  BEFORE UPDATE ON lm_employees
  FOR EACH ROW EXECUTE FUNCTION lm_update_updated_at();

DROP TRIGGER IF EXISTS lm_schedule_shifts_updated_at ON lm_schedule_shifts;
CREATE TRIGGER lm_schedule_shifts_updated_at
  BEFORE UPDATE ON lm_schedule_shifts
  FOR EACH ROW EXECUTE FUNCTION lm_update_updated_at();

DROP TRIGGER IF EXISTS lm_time_entries_updated_at ON lm_time_entries;
CREATE TRIGGER lm_time_entries_updated_at
  BEFORE UPDATE ON lm_time_entries
  FOR EACH ROW EXECUTE FUNCTION lm_update_updated_at();

-- Backfill employees from legacy planilla names. New code_hash remains null
-- until an admin explicitly generates a code.
WITH default_rate AS (
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN value ~ '^[0-9]+(\.[0-9]+)?$' THEN GREATEST((value::numeric / 8), 0)
          ELSE NULL
        END
      FROM lm_carrier_configs
      WHERE key = 'salary_daily_rate'
      LIMIT 1
    ),
    1250
  ) AS hourly_rate_crc
)
INSERT INTO lm_employees (display_name, active, hourly_rate_crc, legacy_staff_name)
SELECT DISTINCT trim(w.staff_name), TRUE, d.hourly_rate_crc, trim(w.staff_name)
FROM lm_work_days w
CROSS JOIN default_rate d
WHERE w.staff_name IS NOT NULL AND trim(w.staff_name) <> ''
ON CONFLICT (legacy_staff_name) DO NOTHING;

-- Backfill legacy schedule rows without overwriting any schedule already saved
-- in the new system.
WITH legacy AS (
  SELECT
    w.id,
    e.id AS employee_id,
    w.work_date,
    CASE WHEN w.notes IS NOT NULL AND left(trim(w.notes), 1) = '{'
      THEN w.notes::jsonb
      ELSE '{}'::jsonb
    END AS meta,
    CASE WHEN w.notes IS NOT NULL AND left(trim(w.notes), 1) <> '{'
      THEN w.notes
      ELSE NULL
    END AS plain_notes
  FROM lm_work_days w
  INNER JOIN lm_employees e ON e.legacy_staff_name = trim(w.staff_name)
)
INSERT INTO lm_schedule_shifts (
  employee_id,
  work_date,
  shift_start,
  shift_end,
  expected_paid_minutes,
  lunch_minutes,
  is_off,
  notes,
  legacy_work_day_id,
  created_at,
  updated_at
)
SELECT
  employee_id,
  work_date,
  CASE WHEN (meta->>'startTime') ~ '^[0-2][0-9]:[0-5][0-9]$'
    THEN (meta->>'startTime')::time
    ELSE NULL
  END AS shift_start,
  NULL::time AS shift_end,
  CASE
    WHEN (meta->>'hours') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(1440, GREATEST(0, ROUND((meta->>'hours')::numeric * 60)::int))
    WHEN meta->>'dayType' = 'off' THEN 0
    ELSE 480
  END AS expected_paid_minutes,
  CASE
    WHEN (meta->>'lunchMinutes') ~ '^[0-9]+$'
      THEN LEAST(240, GREATEST(0, (meta->>'lunchMinutes')::int))
    ELSE 0
  END AS lunch_minutes,
  COALESCE(meta->>'dayType', '') = 'off'
    OR COALESCE(meta->>'hours', '') = '0' AS is_off,
  COALESCE(NULLIF(meta->>'notes', ''), plain_notes) AS notes,
  id AS legacy_work_day_id,
  now(),
  now()
FROM legacy
ON CONFLICT (employee_id, work_date) DO NOTHING;

ALTER TABLE lm_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE lm_schedule_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lm_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lm_workforce_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'lm_is_admin'
  ) THEN
    DROP POLICY IF EXISTS "lm_employees: admin only" ON lm_employees;
    CREATE POLICY "lm_employees: admin only" ON lm_employees
      FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

    DROP POLICY IF EXISTS "lm_schedule_shifts: admin only" ON lm_schedule_shifts;
    CREATE POLICY "lm_schedule_shifts: admin only" ON lm_schedule_shifts
      FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

    DROP POLICY IF EXISTS "lm_time_entries: admin only" ON lm_time_entries;
    CREATE POLICY "lm_time_entries: admin only" ON lm_time_entries
      FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

    DROP POLICY IF EXISTS "lm_workforce_audit_events: admin only" ON lm_workforce_audit_events;
    CREATE POLICY "lm_workforce_audit_events: admin only" ON lm_workforce_audit_events
      FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());
  END IF;
END $$;
