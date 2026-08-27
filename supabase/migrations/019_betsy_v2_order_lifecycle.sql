-- BETSY V2 SLICE 3 — ADDITIVE SCHEMA ONLY
-- REVIEW AND RUN MANUALLY AFTER BACKUP VERIFICATION. THIS FILE IS NEVER
-- EXECUTED BY THE APPLICATION OR BY THE LOCAL IMPLEMENTATION WORKFLOW.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "lifecycleVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "normalizedPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "isProvisional" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "emailStatus" TEXT NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS "emailProviderId" TEXT,
  ADD COLUMN IF NOT EXISTS "emailedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailError" TEXT;

CREATE TABLE IF NOT EXISTS "ClientIdentityConflict" (
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
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "ClientIdentityConflict_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "OrderLifecycleOperation" (
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
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderLifecycleOperation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "OrderInventoryAllocation" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "inventoryItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderInventoryAllocation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderInventoryAllocation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderInventoryAllocation_inventoryItemId_fkey"
    FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT
);

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Order_tenantId_clientId_idx" ON "Order"("tenantId", "clientId");
CREATE INDEX IF NOT EXISTS "Client_tenantId_normalizedPhone_idx" ON "Client"("tenantId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "Client_tenantId_normalizedEmail_idx" ON "Client"("tenantId", "normalizedEmail");
CREATE INDEX IF NOT EXISTS "ClientIdentityConflict_tenantId_status_createdAt_idx"
  ON "ClientIdentityConflict"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientIdentityConflict_tenantId_orderId_idx"
  ON "ClientIdentityConflict"("tenantId", "orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderLifecycleOperation_tenantId_adapter_idempotencyKey_key"
  ON "OrderLifecycleOperation"("tenantId", "adapter", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "OrderLifecycleOperation_tenantId_orderId_idx"
  ON "OrderLifecycleOperation"("tenantId", "orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderInventoryAllocation_tenantId_orderId_inventoryItemId_key"
  ON "OrderInventoryAllocation"("tenantId", "orderId", "inventoryItemId");
CREATE INDEX IF NOT EXISTS "OrderInventoryAllocation_tenantId_inventoryItemId_idx"
  ON "OrderInventoryAllocation"("tenantId", "inventoryItemId");

COMMIT;
