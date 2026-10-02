-- 045 Agent improvement loop (INBOX Soft agents): version snapshots, staff feedback, automatic test runs.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=045 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- New tables only (no ALTER on busy tables, no foreign keys: no locks). Tenant isolation is enforced in code:
-- every read/write is scoped by "tenantId" from the session. RLS on (service role only).
-- Code is fail-safe on missing tables (42P01): scorecard/feedback/eval simply report "not ready".
-- Rollback: deploy previous code; the tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Immutable snapshot of what an agent was at each version (instructions, tools, model, brand facts...).
CREATE TABLE IF NOT EXISTS public."ChatAgentVersion" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "version" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "snapshotHash" text NOT NULL,
  "promptCodeVersion" text NOT NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentVersion_agent_version_key" UNIQUE ("agentId", "version")
);
CREATE INDEX IF NOT EXISTS "ChatAgentVersion_tenant_idx" ON public."ChatAgentVersion" ("tenantId", "createdAt" DESC);
ALTER TABLE public."ChatAgentVersion" ENABLE ROW LEVEL SECURITY;

-- Staff thumbs on an agent turn (1 = good, -1 = bad) with a reason chip.
CREATE TABLE IF NOT EXISTS public."ChatAgentFeedback" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "agentVersion" integer NULL,
  "turnId" text NOT NULL,
  "rating" smallint NOT NULL,
  "reasonCode" text NULL,
  "note" text NULL,
  "actorUserId" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentFeedback_rating_check" CHECK ("rating" IN (-1, 1)),
  CONSTRAINT "ChatAgentFeedback_reason_check" CHECK (
    "reasonCode" IS NULL OR "reasonCode" IN ('wrong_fact', 'wrong_tone', 'should_have_escalated', 'other')),
  CONSTRAINT "ChatAgentFeedback_note_len" CHECK (char_length(coalesce("note", '')) <= 500),
  CONSTRAINT "ChatAgentFeedback_actor_turn_key" UNIQUE ("tenantId", "actorUserId", "turnId")
);
CREATE INDEX IF NOT EXISTS "ChatAgentFeedback_agent_idx" ON public."ChatAgentFeedback" ("agentId", "agentVersion", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatAgentFeedback_turn_idx" ON public."ChatAgentFeedback" ("turnId");
ALTER TABLE public."ChatAgentFeedback" ENABLE ROW LEVEL SECURITY;

-- One row per automatic test-suite run of an agent version (deterministic safety rules; LLM judge later).
CREATE TABLE IF NOT EXISTS public."ChatAgentEvalRun" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "agentVersion" integer NOT NULL,
  "suite" text NOT NULL,
  "fixtureSetHash" text NOT NULL,
  "examined" integer NOT NULL,
  "passRate" double precision NOT NULL,
  "policyViolations" integer NOT NULL DEFAULT 0,
  "results" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "startedBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentEvalRun_suite_len" CHECK (char_length("suite") <= 60)
);
CREATE INDEX IF NOT EXISTS "ChatAgentEvalRun_agent_idx" ON public."ChatAgentEvalRun" ("agentId", "createdAt" DESC);
ALTER TABLE public."ChatAgentEvalRun" ENABLE ROW LEVEL SECURITY;
COMMIT;
