-- Soft Agent Layer A2 — knowledge sources + reserved suggestion/pending-action tables.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Soft-only — shares no tables with staff BotInbox*.
-- Gated like 026/027/027b: registered in manifest but NOT in DEFAULT_APPLY_FILES.
-- Apply only via BETSY_V2_APPLY_FILES=028 after human review + Blob backup.
-- Depends on 027 (ChatAgent). Do NOT run prisma db push / migrate against Supabase.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- ChatKnowledgeSource — versioned Brand Book / policy / FAQ / channel overlay
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatKnowledgeSource" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "socialAccountId" text NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "contentHash" text NOT NULL,
  "metadata" jsonb,
  "approvedBy" text NULL,
  "approvedAt" timestamp(3) without time zone NULL,
  "contentPurgedAt" timestamp(3) without time zone NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatKnowledgeSource_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatKnowledgeSource_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatKnowledgeSource_approvedBy_fkey"
    FOREIGN KEY ("approvedBy") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatKnowledgeSource_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatKnowledgeSource_tenantId_id_key" UNIQUE ("tenantId", "id"),
  CONSTRAINT "ChatKnowledgeSource_tenant_kind_name_version_key"
    UNIQUE ("tenantId", "kind", "name", "version"),
  CONSTRAINT "ChatKnowledgeSource_kind_check"
    CHECK ("kind" IN ('brand_book', 'policy', 'faq', 'channel_overlay')),
  CONSTRAINT "ChatKnowledgeSource_status_check"
    CHECK ("status" IN ('draft', 'approved', 'archived')),
  CONSTRAINT "ChatKnowledgeSource_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ChatKnowledgeSource_body_len_check"
    CHECK (char_length("body") >= 1 AND char_length("body") <= 12000),
  CONSTRAINT "ChatKnowledgeSource_name_len_check"
    CHECK (char_length("name") >= 1 AND char_length("name") <= 80),
  CONSTRAINT "ChatKnowledgeSource_overlay_account_check"
    CHECK (
      ("kind" = 'channel_overlay' AND "socialAccountId" IS NOT NULL)
      OR ("kind" <> 'channel_overlay' AND "socialAccountId" IS NULL)
    ),
  CONSTRAINT "ChatKnowledgeSource_approved_fields_check"
    CHECK (
      ("status" <> 'approved')
      OR ("approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "ChatKnowledgeSource_tenantId_kind_status_idx"
  ON public."ChatKnowledgeSource"("tenantId", "kind", "status");

CREATE INDEX IF NOT EXISTS "ChatKnowledgeSource_tenantId_socialAccountId_status_idx"
  ON public."ChatKnowledgeSource"("tenantId", "socialAccountId", "status");

CREATE INDEX IF NOT EXISTS "ChatKnowledgeSource_status_createdAt_body_partial_idx"
  ON public."ChatKnowledgeSource"("status", "createdAt")
  WHERE "body" IS NOT NULL AND "contentPurgedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- ChatAgentKnowledgeSource — agent ↔ knowledge join (priority order)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentKnowledgeSource" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "sourceId" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 100,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentKnowledgeSource_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentKnowledgeSource_tenantId_agentId_fkey"
    FOREIGN KEY ("tenantId", "agentId")
    REFERENCES public."ChatAgent"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentKnowledgeSource_tenantId_sourceId_fkey"
    FOREIGN KEY ("tenantId", "sourceId")
    REFERENCES public."ChatKnowledgeSource"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentKnowledgeSource_agentId_sourceId_key"
    UNIQUE ("agentId", "sourceId"),
  CONSTRAINT "ChatAgentKnowledgeSource_priority_check"
    CHECK ("priority" >= 0 AND "priority" <= 10000)
);

CREATE INDEX IF NOT EXISTS "ChatAgentKnowledgeSource_tenantId_agentId_priority_idx"
  ON public."ChatAgentKnowledgeSource"("tenantId", "agentId", "priority");

CREATE INDEX IF NOT EXISTS "ChatAgentKnowledgeSource_tenantId_sourceId_idx"
  ON public."ChatAgentKnowledgeSource"("tenantId", "sourceId");

-- ---------------------------------------------------------------------------
-- ChatAgentSuggestion — reserved for A3 (schema only in A2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentSuggestion" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "conversationId" text NOT NULL,
  "agentId" text NOT NULL,
  "turnId" text NULL,
  "triggerMessageId" text NOT NULL,
  "content" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "actedBy" text NULL,
  "actedAt" timestamp(3) without time zone NULL,
  "acceptedMessageId" text NULL,
  "contentPurgedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentSuggestion_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentSuggestion_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentSuggestion_tenantId_agentId_fkey"
    FOREIGN KEY ("tenantId", "agentId")
    REFERENCES public."ChatAgent"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentSuggestion_turnId_fkey"
    FOREIGN KEY ("turnId") REFERENCES public."ChatAgentTurn"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentSuggestion_triggerMessageId_fkey"
    FOREIGN KEY ("triggerMessageId") REFERENCES public."ChatMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentSuggestion_actedBy_fkey"
    FOREIGN KEY ("actedBy") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentSuggestion_conversation_trigger_key"
    UNIQUE ("conversationId", "triggerMessageId"),
  CONSTRAINT "ChatAgentSuggestion_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'edited', 'dismissed', 'expired')),
  CONSTRAINT "ChatAgentSuggestion_content_len_check"
    CHECK (char_length("content") >= 1 AND char_length("content") <= 8000)
);

CREATE INDEX IF NOT EXISTS "ChatAgentSuggestion_tenantId_conversationId_status_idx"
  ON public."ChatAgentSuggestion"("tenantId", "conversationId", "status");

CREATE INDEX IF NOT EXISTS "ChatAgentSuggestion_status_expiresAt_idx"
  ON public."ChatAgentSuggestion"("status", "expiresAt");

CREATE INDEX IF NOT EXISTS "ChatAgentSuggestion_status_createdAt_content_partial_idx"
  ON public."ChatAgentSuggestion"("status", "createdAt")
  WHERE "content" IS NOT NULL AND "contentPurgedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- ChatAgentPendingAction — reserved for A4 (schema only in A2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentPendingAction" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "conversationId" text NOT NULL,
  "agentId" text NOT NULL,
  "turnId" text NULL,
  "kind" text NOT NULL,
  "arguments" jsonb NOT NULL,
  "argumentsHash" text NOT NULL,
  "requiredPermission" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "idempotencyKey" text NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "approvedBy" text NULL,
  "approvedAt" timestamp(3) without time zone NULL,
  "executedAt" timestamp(3) without time zone NULL,
  "result" jsonb,
  "errorCode" text NULL,
  "argumentsPurgedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentPendingAction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentPendingAction_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentPendingAction_tenantId_agentId_fkey"
    FOREIGN KEY ("tenantId", "agentId")
    REFERENCES public."ChatAgent"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentPendingAction_turnId_fkey"
    FOREIGN KEY ("turnId") REFERENCES public."ChatAgentTurn"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentPendingAction_approvedBy_fkey"
    FOREIGN KEY ("approvedBy") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentPendingAction_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ChatAgentPendingAction_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'executed', 'expired', 'failed'))
);

CREATE INDEX IF NOT EXISTS "ChatAgentPendingAction_tenantId_conversationId_status_idx"
  ON public."ChatAgentPendingAction"("tenantId", "conversationId", "status");

CREATE INDEX IF NOT EXISTS "ChatAgentPendingAction_status_expiresAt_idx"
  ON public."ChatAgentPendingAction"("status", "expiresAt");

-- ---------------------------------------------------------------------------
-- RLS + service_role_bypass (mirrors 023–027)
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatKnowledgeSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentKnowledgeSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentSuggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentPendingAction" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatKnowledgeSource"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentKnowledgeSource"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentSuggestion"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentPendingAction"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
