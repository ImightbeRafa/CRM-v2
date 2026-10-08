-- 051 AI budgets (owner AI usage dashboard, F2): monthly spend limits per business and one global limit.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=051 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
--   scope            'global' or a tenantId
--   monthlyUsdMicros budget for the calendar month (Costa Rica time), from AiUsageEvent.costMicros
--   autoPause        at 100% the business's inbox agents are paused (kill switch) and the owner is alerted
--   alertedMonth/alertedPct  dedupe: one alert per threshold (80 / 100) per month (reset when the budget changes)
--   pausedMonth      the month the auto-pause was applied (separate from alerts; a failed pause is retried)
-- No foreign keys; only the platform owner (super admin) reads or writes it (code-enforced).
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."AiBudget" (
  "scope" text PRIMARY KEY,
  "monthlyUsdMicros" bigint NOT NULL CHECK ("monthlyUsdMicros" > 0),
  "autoPause" boolean NOT NULL DEFAULT false,
  "alertedMonth" text NULL,
  "alertedPct" integer NOT NULL DEFAULT 0,
  "pausedMonth" text NULL,
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Older drafts of 051 lacked pausedMonth: add it if missing (no-op otherwise).
ALTER TABLE public."AiBudget" ADD COLUMN IF NOT EXISTS "pausedMonth" text NULL;
ALTER TABLE public."AiBudget" ENABLE ROW LEVEL SECURITY;
COMMIT;
