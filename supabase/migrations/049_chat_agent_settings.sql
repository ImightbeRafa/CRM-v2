-- 049 Per-agent settings side table (INBOX Soft agents) + widened workspace notification kinds.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=049 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Why a side table (not new ChatAgent columns): several hot paths load ChatAgent rows whole; new columns there
-- would break every agent turn until this file is applied. Code reads this table through isTableReady and
-- falls back to safe defaults when it is missing.
--   dailyTokenCap         per-agent daily budget (NULL = only the tenant cap applies)
--   orderOwnership        which orders belong to this agent's business: {salesChannels:[], funnels:[], sources:[]}
--                         (empty = the agent only sees orders a human linked to the chat)
--   orderDefaults         {seller, shippingMethodId, stamp:{salesChannel, funnel}} used when the agent proposes orders
--   servesUnboundChannels a tenant_default binding answers channels with no agent of their own ONLY when true
-- No foreign keys (no locks on busy tables); tenant isolation is enforced in code (tenantId from the session).
-- The notification kind CHECK is replaced by a wider one (old kinds kept): ai_no_reply (agent stayed silent),
-- payment_review / order_review (F6), ai_budget (F2). The swap is NOT VALID inside the first transaction (brief
-- lock); VALIDATE runs in a second transaction with a lighter lock (old kinds are all still allowed, so it passes).
-- Rollback: deploy previous code; the table can stay (ignored). The wider CHECK is harmless to old code.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatAgentSettings" (
  "agentId" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "dailyTokenCap" integer NULL CHECK ("dailyTokenCap" IS NULL OR "dailyTokenCap" > 0),
  "orderOwnership" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "orderDefaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "servesUnboundChannels" boolean NOT NULL DEFAULT false,
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ChatAgentSettings_tenant_idx" ON public."ChatAgentSettings" ("tenantId");
ALTER TABLE public."ChatAgentSettings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."WorkspaceNotification" DROP CONSTRAINT IF EXISTS "WorkspaceNotification_kind_check";
ALTER TABLE public."WorkspaceNotification" ADD CONSTRAINT "WorkspaceNotification_kind_check"
  CHECK ("kind" IN ('mention', 'task_assigned', 'task_due', 'chat_assigned',
                    'ai_no_reply', 'payment_review', 'order_review', 'ai_budget')) NOT VALID;

-- Optional, run by hand ONLY if Rafael wants today's behavior kept for existing default agents
-- (a tenant_default agent answering channels that have no agent of their own):
-- INSERT INTO public."ChatAgentSettings" ("agentId", "tenantId", "servesUnboundChannels")
--   SELECT b."agentId", b."tenantId", true FROM public."ChatAgentBinding" b
--    WHERE b."scope" = 'tenant_default' AND b."isActive" = true
--   ON CONFLICT ("agentId") DO UPDATE SET "servesUnboundChannels" = true;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public."WorkspaceNotification" VALIDATE CONSTRAINT "WorkspaceNotification_kind_check";
COMMIT;
