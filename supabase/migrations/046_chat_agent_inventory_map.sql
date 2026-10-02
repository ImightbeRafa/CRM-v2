-- 046 Per-agent inventory map (INBOX Soft agents): which products an agent is allowed to quote.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=046 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- New table only, no foreign keys (no locks on busy tables). Tenant isolation is enforced in code: every read and
-- write is scoped by "tenantId" from the session and each inventory item is checked to belong to that tenant.
-- Behavior: an agent with NO rows keeps today's behavior (search_inventory over the whole active catalog); an agent
-- with rows can only find/quote those products. Code is fail-safe on a missing table (42P01).
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatAgentInventoryItem" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "inventoryItemId" text NOT NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentInventoryItem_agent_item_key" UNIQUE ("agentId", "inventoryItemId")
);
CREATE INDEX IF NOT EXISTS "ChatAgentInventoryItem_tenant_agent_idx" ON public."ChatAgentInventoryItem" ("tenantId", "agentId");
ALTER TABLE public."ChatAgentInventoryItem" ENABLE ROW LEVEL SECURITY;
COMMIT;
