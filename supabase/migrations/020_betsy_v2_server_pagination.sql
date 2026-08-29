-- Betsy v2 Slice 4: additive server-pagination support.
-- HUMAN APPROVAL REQUIRED. Do not run through Prisma migrate/db push.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."TenantOrderStatusClassification" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "statusValue" TEXT NOT NULL,
  "normalizedStatusValue" TEXT NOT NULL,
  "isTerminal" BOOLEAN NOT NULL,
  "approvedAt" TIMESTAMPTZ NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantOrderStatusClassification_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantOrderStatusClassification_tenantId_normalizedStatusValue_key"
  ON public."TenantOrderStatusClassification"("tenantId", "normalizedStatusValue");
CREATE INDEX IF NOT EXISTS "TenantOrderStatusClassification_tenantId_isTerminal_idx"
  ON public."TenantOrderStatusClassification"("tenantId", "isTerminal");
CREATE INDEX IF NOT EXISTS "Order_tenantId_timestamp_id_idx"
  ON public."Order"("tenantId", "timestamp" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Order_tenantId_status_timestamp_id_idx"
  ON public."Order"("tenantId", "status", "timestamp" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Client_tenantId_isActive_lastOrder_id_idx"
  ON public."Client"("tenantId", "isActive", "lastOrder" DESC, "id" DESC);

ALTER TABLE public."TenantOrderStatusClassification" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."TenantOrderStatusClassification"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
