-- 048 AI usage meter: one row per AI provider call anywhere in Betsy (inbox agent, Probar/tests, imports,
-- customer paste, staff bot text + voice, transcription, vision). Feeds the owner-only AI dashboard (F2).
-- Additive only. Gated: BETSY_V2_APPLY_FILES=048 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Written fire-and-forget by src/lib/ai-usage/record.ts (never blocks or fails a caller; skipped while missing).
-- No foreign keys (append-only log; tenant may be NULL for platform-level calls such as the legacy bot path).
-- "sourceKey" is unique so retries and the one-off ChatAgentTurn backfill can never double-count.
-- No customer text is stored here: ids, model, token counts, cost and timing only.
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."AiUsageEvent" (
  "id" text PRIMARY KEY,
  "sourceKey" text NOT NULL,
  "tenantId" text NULL,
  "feature" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "keyLabel" text NULL,
  "agentId" text NULL,
  "conversationId" text NULL,
  "userId" text NULL,
  "inputTokens" integer NOT NULL DEFAULT 0,
  "cachedTokens" integer NOT NULL DEFAULT 0,
  "outputTokens" integer NOT NULL DEFAULT 0,
  "reasoningTokens" integer NOT NULL DEFAULT 0,
  "audioSeconds" numeric(10, 2) NULL,
  "units" integer NOT NULL DEFAULT 1,
  "costMicros" bigint NOT NULL DEFAULT 0,
  "pricingVersion" text NOT NULL,
  "latencyMs" integer NULL,
  "status" text NOT NULL DEFAULT 'ok',
  "errorCode" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageEvent_sourceKey_key" UNIQUE ("sourceKey"),
  CONSTRAINT "AiUsageEvent_status_check" CHECK ("status" IN ('ok', 'error')),
  CONSTRAINT "AiUsageEvent_feature_check" CHECK (char_length("feature") BETWEEN 1 AND 40)
);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_created_idx" ON public."AiUsageEvent" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_tenant_created_idx" ON public."AiUsageEvent" ("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_feature_created_idx" ON public."AiUsageEvent" ("feature", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_agent_created_idx" ON public."AiUsageEvent" ("agentId", "createdAt" DESC) WHERE "agentId" IS NOT NULL;
ALTER TABLE public."AiUsageEvent" ENABLE ROW LEVEL SECURITY;
COMMIT;
