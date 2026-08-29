-- Betsy v2 tenant setup-guide progress.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive only. Feature flags default off and old code ignores this table.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."TenantSetupProgress" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL UNIQUE,
  "currentStep" text NULL,
  "completedSteps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "skippedSteps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'in_progress',
  "dismissedAt" timestamp(3) without time zone NULL,
  "completedAt" timestamp(3) without time zone NULL,
  "revision" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantSetupProgress_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TenantSetupProgress_status_updatedAt_idx"
  ON public."TenantSetupProgress"("status", "updatedAt");

ALTER TABLE public."TenantSetupProgress" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."TenantSetupProgress"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
