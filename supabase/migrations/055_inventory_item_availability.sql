-- 055 Out-of-stock switch for the inbox sales agents (Rafael 2026-10-18): per product of a store, "Agotado" by hand
-- plus an optional "vuelve aprox." date or short note. STORE-level (one row per InventoryItem): a product that is out
-- is out for every agent of that store. Additive only. Gated: BETSY_V2_APPLY_FILES=055 — never DEFAULT_APPLY_FILES.
-- DO NOT run prisma db push / migrate.
-- New table only, no foreign keys (no locks on busy tables). Tenant isolation is enforced in code: every read and
-- write is scoped by "tenantId" from the session and the item is checked to belong to that tenant (and to the
-- agent's product list) before a row is written.
-- Behavior: no row = the product is sold out only when its tracked stock is 0 (today's "agotado" label). Code is
-- fail-safe on a missing table (42P01): it behaves exactly as today.
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."InventoryItemAvailability" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "inventoryItemId" text NOT NULL,
  "soldOut" boolean NOT NULL DEFAULT false,
  "backDate" date NULL,
  "backNote" text NULL,
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryItemAvailability_tenant_item_key" UNIQUE ("tenantId", "inventoryItemId"),
  CONSTRAINT "InventoryItemAvailability_note_len" CHECK ("backNote" IS NULL OR char_length("backNote") <= 60)
);
ALTER TABLE public."InventoryItemAvailability" ENABLE ROW LEVEL SECURITY;
COMMIT;

-- Check after applying (must return 1 row, 0 data rows at first):
-- SELECT to_regclass('public."InventoryItemAvailability"') AS tbl, (SELECT count(*) FROM public."InventoryItemAvailability") AS n;
