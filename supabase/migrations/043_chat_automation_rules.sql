-- 043 Chat automation rules v1 (INTERNAL actions only: tag / assign / create a task — never a message to a customer).
-- Additive only. Gated: BETSY_V2_APPLY_FILES=043 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- New tables only, no foreign keys (no locks on busy tables). Tenant isolation is enforced in code: every read and
-- write is scoped by "tenantId" from the session; the evaluator only acts inside the rule's own tenant.
-- Code is fail-safe on missing tables (42P01): the editor says "not available yet" and the sweep skips.
-- Rollback: deploy previous code; the tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatAutomationRule" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "triggerKind" text NOT NULL,
  "triggerConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actionKind" text NOT NULL,
  "actionConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAutomationRule_trigger_check" CHECK ("triggerKind" IN ('new_chat', 'idle', 'keyword')),
  CONSTRAINT "ChatAutomationRule_action_check" CHECK ("actionKind" IN ('tag', 'assign', 'task')),
  CONSTRAINT "ChatAutomationRule_name_len" CHECK (char_length("name") BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS "ChatAutomationRule_tenant_idx" ON public."ChatAutomationRule" ("tenantId", "enabled");
ALTER TABLE public."ChatAutomationRule" ENABLE ROW LEVEL SECURITY;

-- One row per (rule, chat, trigger event): the unique key is what makes a rule fire once per event.
CREATE TABLE IF NOT EXISTS public."ChatAutomationRuleRun" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "ruleId" text NOT NULL,
  "conversationId" text NOT NULL,
  "dedupeKey" text NOT NULL,
  "status" text NOT NULL DEFAULT 'done',
  "error" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAutomationRuleRun_event_key" UNIQUE ("ruleId", "conversationId", "dedupeKey"),
  CONSTRAINT "ChatAutomationRuleRun_status_check" CHECK ("status" IN ('done', 'failed')),
  CONSTRAINT "ChatAutomationRuleRun_len" CHECK (char_length("dedupeKey") <= 120 AND char_length(coalesce("error", '')) <= 200)
);
CREATE INDEX IF NOT EXISTS "ChatAutomationRuleRun_tenant_idx" ON public."ChatAutomationRuleRun" ("tenantId", "createdAt" DESC);
-- Retention deletes by age across tenants.
CREATE INDEX IF NOT EXISTS "ChatAutomationRuleRun_created_idx" ON public."ChatAutomationRuleRun" ("createdAt");
ALTER TABLE public."ChatAutomationRuleRun" ENABLE ROW LEVEL SECURITY;
COMMIT;
