-- Soft AI Agent Layer (A1) — ChatAgent / Binding / Turn + single-flight.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Soft-only — shares no tables with staff BotInbox*.
-- Gated like 025/026: registered in manifest but NOT in DEFAULT_APPLY_FILES.
-- Apply only via BETSY_V2_APPLY_FILES=027 after human review + Blob backup.
-- DO NOT run prisma db push / migrate against Supabase.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- ChatAgent — one voice per store / channel assignment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgent" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "name" text NOT NULL,
  "emoji" text NOT NULL DEFAULT '✨',
  "description" text NULL,
  "systemInstructions" text NOT NULL,
  "tonePreset" text NOT NULL DEFAULT 'warm_concise',
  "model" text NOT NULL DEFAULT 'grok-4.6',
  "operationMode" text NOT NULL DEFAULT 'ai_suggest',
  "enabledTools" text[] NOT NULL DEFAULT '{}',
  "paymentAlwaysHuman" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "createdBy" text NULL,
  "updatedBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgent_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgent_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgent_tenantId_id_key" UNIQUE ("tenantId", "id"),
  CONSTRAINT "ChatAgent_tenantId_name_key" UNIQUE ("tenantId", "name"),
  CONSTRAINT "ChatAgent_name_len_check"
    CHECK (char_length("name") >= 1 AND char_length("name") <= 40),
  CONSTRAINT "ChatAgent_instructions_len_check"
    CHECK (char_length("systemInstructions") >= 1 AND char_length("systemInstructions") <= 1200),
  CONSTRAINT "ChatAgent_tonePreset_check"
    CHECK ("tonePreset" IN ('warm_concise', 'formal', 'playful')),
  CONSTRAINT "ChatAgent_operationMode_check"
    CHECK ("operationMode" IN ('ai_full', 'ai_suggest', 'human_only')),
  CONSTRAINT "ChatAgent_status_check"
    CHECK ("status" IN ('draft', 'live', 'archived')),
  CONSTRAINT "ChatAgent_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ChatAgent_paymentAlwaysHuman_check"
    CHECK ("paymentAlwaysHuman" = true)
);

CREATE INDEX IF NOT EXISTS "ChatAgent_tenantId_status_idx"
  ON public."ChatAgent"("tenantId", "status");

-- ---------------------------------------------------------------------------
-- ChatAgentBinding — SocialAccount → agent (+ tenant_default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentBinding" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "scope" text NOT NULL,
  "socialAccountId" text NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentBinding_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentBinding_tenantId_agentId_fkey"
    FOREIGN KEY ("tenantId", "agentId")
    REFERENCES public."ChatAgent"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentBinding_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentBinding_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentBinding_scope_check"
    CHECK ("scope" IN ('social_account', 'tenant_default')),
  CONSTRAINT "ChatAgentBinding_scope_account_check"
    CHECK (
      ("scope" = 'tenant_default' AND "socialAccountId" IS NULL)
      OR ("scope" = 'social_account' AND "socialAccountId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatAgentBinding_one_tenant_default_uidx"
  ON public."ChatAgentBinding"("tenantId")
  WHERE "scope" = 'tenant_default' AND "isActive" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatAgentBinding_one_social_account_uidx"
  ON public."ChatAgentBinding"("tenantId", "socialAccountId")
  WHERE "scope" = 'social_account' AND "isActive" = true AND "socialAccountId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ChatAgentBinding_tenantId_socialAccountId_isActive_idx"
  ON public."ChatAgentBinding"("tenantId", "socialAccountId", "isActive");

CREATE INDEX IF NOT EXISTS "ChatAgentBinding_tenantId_agentId_idx"
  ON public."ChatAgentBinding"("tenantId", "agentId");

-- ---------------------------------------------------------------------------
-- ChatAgentTurn — durable generation / usage / cost per job
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentTurn" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "conversationId" text NOT NULL,
  "socialAccountId" text NOT NULL,
  "agentId" text NOT NULL,
  "bindingId" text NULL,
  "triggerMessageId" text NULL,
  "automationDeliveryKey" text NOT NULL,
  "mode" text NOT NULL,
  "model" text NOT NULL,
  "agentVersion" integer NOT NULL,
  "status" text NOT NULL,
  "skipReason" text NULL,
  "outputText" text NULL,
  "outputHash" text NULL,
  "outputPurgedAt" timestamp(3) without time zone NULL,
  "toolTrace" jsonb NULL,
  "inputTokens" integer NOT NULL DEFAULT 0,
  "cachedInputTokens" integer NOT NULL DEFAULT 0,
  "outputTokens" integer NOT NULL DEFAULT 0,
  "reasoningTokens" integer NOT NULL DEFAULT 0,
  "estimatedCostMicros" bigint NOT NULL DEFAULT 0,
  "pricingVersion" text NULL,
  "latencyMs" integer NULL,
  "fallbackUsed" boolean NOT NULL DEFAULT false,
  "errorCode" text NULL,
  "completedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentTurn_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentTurn_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentTurn_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentTurn_tenantId_agentId_fkey"
    FOREIGN KEY ("tenantId", "agentId")
    REFERENCES public."ChatAgent"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentTurn_bindingId_fkey"
    FOREIGN KEY ("bindingId") REFERENCES public."ChatAgentBinding"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentTurn_triggerMessageId_fkey"
    FOREIGN KEY ("triggerMessageId") REFERENCES public."ChatMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentTurn_automationDeliveryKey_key" UNIQUE ("automationDeliveryKey"),
  CONSTRAINT "ChatAgentTurn_mode_check"
    CHECK ("mode" IN ('ai_full', 'ai_suggest', 'test')),
  CONSTRAINT "ChatAgentTurn_status_check"
    CHECK ("status" IN (
      'generated', 'delivered', 'suggested', 'test', 'fallback',
      'budget_blocked', 'window_closed', 'failed', 'skipped'
    )),
  CONSTRAINT "ChatAgentTurn_trigger_required_check"
    CHECK (
      ("mode" = 'test' AND "triggerMessageId" IS NULL)
      OR ("mode" <> 'test' AND "triggerMessageId" IS NOT NULL)
    ),
  CONSTRAINT "ChatAgentTurn_tokens_nonneg_check"
    CHECK (
      "inputTokens" >= 0
      AND "cachedInputTokens" >= 0
      AND "outputTokens" >= 0
      AND "reasoningTokens" >= 0
      AND "estimatedCostMicros" >= 0
    )
);

CREATE INDEX IF NOT EXISTS "ChatAgentTurn_tenantId_createdAt_idx"
  ON public."ChatAgentTurn"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChatAgentTurn_agentId_createdAt_idx"
  ON public."ChatAgentTurn"("agentId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChatAgentTurn_conversationId_createdAt_idx"
  ON public."ChatAgentTurn"("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChatAgentTurn_status_createdAt_output_partial_idx"
  ON public."ChatAgentTurn"("status", "createdAt")
  WHERE "outputText" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Single-flight: at most one processing job per conversation
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ChatAutomationJob_conversation_single_flight_idx"
  ON public."ChatAutomationJob"("conversationId")
  WHERE "status" = 'processing';

-- ---------------------------------------------------------------------------
-- RLS + service_role_bypass (app uses table-owner postgres; mirrors 023–026)
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentTurn" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgent"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentBinding"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentTurn"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
