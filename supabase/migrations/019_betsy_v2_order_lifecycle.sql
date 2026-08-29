-- BETSY V2 SLICE 3 — ADDITIVE SCHEMA ONLY
-- REVIEW AND RUN MANUALLY AFTER BACKUP VERIFICATION. THIS FILE IS NEVER
-- EXECUTED BY THE APPLICATION OR BY THE LOCAL IMPLEMENTATION WORKFLOW.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Indexes stay in-transaction: production "Order" is ~4k rows / ~7MB, so a
-- 3s lock_timeout aborts on contention instead of holding writers. PostgreSQL 17
-- constant DEFAULT additions are metadata-only.
ALTER TABLE public."Order"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "lifecycleVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public."Client"
  ADD COLUMN IF NOT EXISTS "normalizedPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "isProvisional" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public."Invoice"
  ADD COLUMN IF NOT EXISTS "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "emailStatus" TEXT NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS "emailProviderId" TEXT,
  ADD COLUMN IF NOT EXISTS "emailedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailError" TEXT;

CREATE TABLE IF NOT EXISTS public."ClientIdentityConflict" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT,
  "normalizedPhone" TEXT,
  "normalizedEmail" TEXT,
  "candidateClientIds" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientIdentityConflict_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "ClientIdentityConflict_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES public."Order"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public."OrderLifecycleOperation" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "adapter" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderId" TEXT,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLifecycleOperation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderLifecycleOperation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES public."Order"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public."OrderInventoryAllocation" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "inventoryItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderInventoryAllocation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderInventoryAllocation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES public."Order"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderInventoryAllocation_inventoryItemId_fkey"
    FOREIGN KEY ("inventoryItemId") REFERENCES public."InventoryItem"("id") ON DELETE RESTRICT
);

DO $$ BEGIN
  ALTER TABLE public."Order" ADD CONSTRAINT "Order_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES public."Client"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Order_tenantId_clientId_idx" ON public."Order"("tenantId", "clientId");
CREATE INDEX IF NOT EXISTS "Client_tenantId_normalizedPhone_idx" ON public."Client"("tenantId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "Client_tenantId_normalizedEmail_idx" ON public."Client"("tenantId", "normalizedEmail");
CREATE INDEX IF NOT EXISTS "ClientIdentityConflict_tenantId_status_createdAt_idx"
  ON public."ClientIdentityConflict"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientIdentityConflict_tenantId_orderId_idx"
  ON public."ClientIdentityConflict"("tenantId", "orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderLifecycleOperation_tenantId_adapter_idempotencyKey_key"
  ON public."OrderLifecycleOperation"("tenantId", "adapter", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "OrderLifecycleOperation_tenantId_orderId_idx"
  ON public."OrderLifecycleOperation"("tenantId", "orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderInventoryAllocation_tenantId_orderId_inventoryItemId_key"
  ON public."OrderInventoryAllocation"("tenantId", "orderId", "inventoryItemId");
CREATE INDEX IF NOT EXISTS "OrderInventoryAllocation_tenantId_inventoryItemId_idx"
  ON public."OrderInventoryAllocation"("tenantId", "inventoryItemId");

ALTER TABLE public."ClientIdentityConflict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderLifecycleOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderInventoryAllocation" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ClientIdentityConflict"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."OrderLifecycleOperation"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."OrderInventoryAllocation"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
