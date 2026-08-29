-- Betsy v2 order soft-delete metadata.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive only. The currently deployed application ignores these columns.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."Order"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "deletedBy" text NULL,
  ADD COLUMN IF NOT EXISTS "deleteReason" text NULL,
  ADD COLUMN IF NOT EXISTS "archiveMetadata" jsonb NULL;

CREATE INDEX IF NOT EXISTS "Order_tenantId_deletedAt_timestamp_idx"
  ON public."Order"("tenantId", "deletedAt", "timestamp");

COMMIT;
