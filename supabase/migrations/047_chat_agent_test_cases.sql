-- 047 Saved Probar tests (INBOX Soft agents): a conversation + simple expectations a team keeps and replays.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=047 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- New table only, no foreign keys (no locks on busy tables). Tenant isolation is enforced in code: every read and
-- write is scoped by "tenantId" from the session and the agent is checked to belong to that tenant.
-- Holds what the team typed as the SIMULATED customer in the playground. If a real message is pasted by mistake, the app
-- masks phones/emails/SINPE/IBAN before saving; caps: 50 tests per agent, 200 per business.
-- Code is fail-safe on a missing table (42P01). Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatAgentTestCase" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "title" text NOT NULL,
  "steps" jsonb NOT NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentTestCase_title_len" CHECK (char_length("title") BETWEEN 1 AND 80),
  CONSTRAINT "ChatAgentTestCase_steps_array" CHECK (jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") BETWEEN 1 AND 12)
);
CREATE INDEX IF NOT EXISTS "ChatAgentTestCase_tenant_agent_idx" ON public."ChatAgentTestCase" ("tenantId", "agentId", "createdAt" DESC);
ALTER TABLE public."ChatAgentTestCase" ENABLE ROW LEVEL SECURITY;
COMMIT;
