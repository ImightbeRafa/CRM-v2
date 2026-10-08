-- 050 Agent test runs (F1 "Activar"): the generated test suite an agent must pass before it answers a channel.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=050 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- One row per run. Cases and per-case results are stored as JSON (customer-like test prompts and the agent's
-- test replies; no real customer data). Runs are dry runs (Probar sandbox): no order, stock, guía or send.
-- Only one queued/running run per agent (partial unique). Processed in small steps with a lease so a restart
-- or a cron tick can resume it. No foreign keys; tenant isolation is enforced in code.
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatAgentTestRun" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "socialAccountId" text NOT NULL,
  "model" text NOT NULL,
  "agentVersion" integer NOT NULL,
  "suiteHash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "cases" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "results" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "cursor" integer NOT NULL DEFAULT 0,
  "costCapMicros" bigint NOT NULL DEFAULT 0,
  "spentMicros" bigint NOT NULL DEFAULT 0,
  "leaseUntil" timestamp(3) without time zone NULL,
  "summary" jsonb NULL,
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" timestamp(3) without time zone NULL,
  CONSTRAINT "ChatAgentTestRun_status_check"
    CHECK ("status" IN ('queued', 'running', 'passed', 'failed', 'cost_capped', 'canceled', 'error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChatAgentTestRun_one_active_per_agent"
  ON public."ChatAgentTestRun" ("agentId") WHERE "status" IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS "ChatAgentTestRun_tenant_agent_created_idx"
  ON public."ChatAgentTestRun" ("tenantId", "agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatAgentTestRun_active_idx"
  ON public."ChatAgentTestRun" ("status", "leaseUntil") WHERE "status" IN ('queued', 'running');
ALTER TABLE public."ChatAgentTestRun" ENABLE ROW LEVEL SECURITY;
COMMIT;
