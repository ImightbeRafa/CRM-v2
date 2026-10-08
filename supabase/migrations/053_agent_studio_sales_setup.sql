-- 053 Agent Studio sales setup (F3 S4). Additive only. Gated: BETSY_V2_APPLY_FILES=053. DO NOT run prisma db push / migrate.
--   ChatAgentAsset      + agentId (photo belongs to one agent, NULL = any agent of the business)
--                       + inventoryCategory (one photo for a whole product group, e.g. all sizes of a harness)
--                       FK fix: deleting an inventory item now only clears "inventoryItemId" (the old composite
--                       SET NULL also nulled "tenantId" → NOT NULL violation → item delete failed). Table is empty
--                       in production (checked 2026-10-08), so the drop/re-add is instant.
--   ShippingMethodCoverage  where each of the business's shipping methods delivers and whether it allows
--                       contra entrega there (per business, edited in shipping config; read by code, never by the AI).
--   ChatAgentSettings   + offeredShippingMethodIds (which methods this agent offers; empty = all active)
--                       + salesRules (owner's selling script: closing, upsells, objections, hand-off rules).
-- Payment accounts stay in ChatAgent."brandFacts".payment (one SINPE + one transfer per agent) — no new table.
-- No new foreign keys besides the corrected one. Rollback: deploy previous code; columns/tables can stay.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."ChatAgentAsset"
  ADD COLUMN IF NOT EXISTS "agentId" text NULL,
  ADD COLUMN IF NOT EXISTS "inventoryCategory" text NULL;

DO $$ BEGIN
  ALTER TABLE public."ChatAgentAsset"
    ADD CONSTRAINT "ChatAgentAsset_inventoryCategory_check"
    CHECK ("inventoryCategory" IS NULL OR char_length("inventoryCategory") BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public."ChatAgentAsset" DROP CONSTRAINT IF EXISTS "ChatAgentAsset_tenantId_inventoryItemId_fkey";
ALTER TABLE public."ChatAgentAsset"
  ADD CONSTRAINT "ChatAgentAsset_tenantId_inventoryItemId_fkey"
  FOREIGN KEY ("tenantId", "inventoryItemId")
  REFERENCES public."InventoryItem"("tenantId", "id")
  ON DELETE SET NULL ("inventoryItemId") ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ChatAgentAsset_tenant_item_idx"
  ON public."ChatAgentAsset" ("tenantId", "inventoryItemId") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "ChatAgentAsset_tenant_category_idx"
  ON public."ChatAgentAsset" ("tenantId", "inventoryCategory") WHERE "status" = 'active';

CREATE TABLE IF NOT EXISTS public."ShippingMethodCoverage" (
  "shippingMethodId" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  -- 'all' = whole country, 'gam' = Gran Área Metropolitana only (Correos GAM rules), 'list' = only "places"
  "coverage" text NOT NULL DEFAULT 'all' CHECK ("coverage" IN ('all', 'gam', 'list')),
  -- normalized "provincia" / "provincia|canton" / "provincia|canton|distrito"
  "places" text[] NOT NULL DEFAULT '{}' CHECK (cardinality("places") <= 500),
  "allowsCod" boolean NOT NULL DEFAULT false,
  -- where contra entrega is accepted: 'same' as coverage, 'gam', or 'list' ("codPlaces")
  "codCoverage" text NOT NULL DEFAULT 'same' CHECK ("codCoverage" IN ('same', 'gam', 'list')),
  "codPlaces" text[] NOT NULL DEFAULT '{}' CHECK (cardinality("codPlaces") <= 500),
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ShippingMethodCoverage_tenant_idx" ON public."ShippingMethodCoverage" ("tenantId");
ALTER TABLE public."ShippingMethodCoverage" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ChatAgentSettings"
  ADD COLUMN IF NOT EXISTS "offeredShippingMethodIds" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "salesRules" jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public."ChatAgentSettings"
    ADD CONSTRAINT "ChatAgentSettings_salesRules_size_check" CHECK (octet_length("salesRules"::text) <= 8000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMIT;
