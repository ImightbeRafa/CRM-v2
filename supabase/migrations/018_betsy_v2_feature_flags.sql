-- Betsy v2 additive feature flags.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- The deployed pre-v2 application ignores this table.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."TenantFeatureFlag" (
  "id" text PRIMARY KEY,
  "scope" text NOT NULL,
  "tenantId" text NULL,
  "key" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "config" jsonb NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantFeatureFlag_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantFeatureFlag_scope_key_key" UNIQUE ("scope", "key"),
  CONSTRAINT "TenantFeatureFlag_scope_tenant_check" CHECK (
    ("scope" = 'global' AND "tenantId" IS NULL)
    OR ("scope" <> 'global' AND "tenantId" = "scope")
  )
);

CREATE INDEX IF NOT EXISTS "TenantFeatureFlag_tenantId_idx"
  ON public."TenantFeatureFlag"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantFeatureFlag_key_enabled_idx"
  ON public."TenantFeatureFlag"("key", "enabled");

-- Match existing Prisma tables: RLS on, only service_role has a policy.
-- The app connects as table-owner postgres (bypasses RLS). anon/authenticated
-- Data API is denied. CREATE POLICY is wrapped so a second apply is a no-op.
ALTER TABLE public."TenantFeatureFlag" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."TenantFeatureFlag"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
