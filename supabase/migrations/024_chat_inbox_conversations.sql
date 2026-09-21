-- Chat inbox conversation foundation (Respond.io parity PR-1).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Do NOT ship 025 unique constraints here.
-- Applied only via scripts/apply-betsy-v2-additive-sql.mjs after ledger review.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- SocialAccount — channel identity + token health (all nullable / defaulted)
-- ---------------------------------------------------------------------------
ALTER TABLE public."SocialAccount"
  ADD COLUMN IF NOT EXISTS "displayName" text NULL,
  ADD COLUMN IF NOT EXISTS "providerDisplayName" text NULL,
  ADD COLUMN IF NOT EXISTS "providerUsername" text NULL,
  ADD COLUMN IF NOT EXISTS "displayPhoneNumber" text NULL,
  ADD COLUMN IF NOT EXISTS "wabaId" text NULL,
  ADD COLUMN IF NOT EXISTS "pageId" text NULL,
  ADD COLUMN IF NOT EXISTS "avatarUrl" text NULL,
  ADD COLUMN IF NOT EXISTS "tokenStatus" text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "tokenLastCheckedAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "subscribedAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "lastWebhookAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "lastSendAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "lastErrorAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "lastErrorCode" text NULL,
  ADD COLUMN IF NOT EXISTS "disconnectedAt" timestamp(3) without time zone NULL;

CREATE INDEX IF NOT EXISTS "SocialAccount_tenantId_isActive_platform_idx"
  ON public."SocialAccount"("tenantId", "isActive", "platform");

-- ---------------------------------------------------------------------------
-- ChatConversation revision sequence (monotonic; gaps OK)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public."ChatConversation_revision_seq";

CREATE OR REPLACE FUNCTION public."ChatConversation_set_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."revision" := nextval('public."ChatConversation_revision_seq"');
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- ChatConversation — one row per (socialAccountId, peerId)
-- Status vocabulary: Soft nuevo / en_curso / hecho (Rafael GO defaults).
-- Optional snooze/closed timestamps are deferred (not in this migration).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatConversation" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "socialAccountId" text NOT NULL,
  "peerId" text NOT NULL,
  "peerName" text NULL,
  "peerAvatarUrl" text NULL,
  "clientId" text NULL,
  "status" text NOT NULL DEFAULT 'nuevo',
  "assignedUserId" text NULL,
  "aiMode" text NULL,
  "tags" text[] NOT NULL DEFAULT '{}'::text[],
  "lastMessageId" text NULL,
  "lastMessageAt" timestamp(3) without time zone NOT NULL,
  "lastMessagePreview" text NULL,
  "lastMessageDirection" text NULL,
  "lastInboundAt" timestamp(3) without time zone NULL,
  "lastOutboundAt" timestamp(3) without time zone NULL,
  "inboundCount" integer NOT NULL DEFAULT 0,
  "messageCount" integer NOT NULL DEFAULT 0,
  "revision" bigint NOT NULL DEFAULT nextval('public."ChatConversation_revision_seq"'),
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversation_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversation_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES public."Client"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatConversation_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatConversation_tenantId_socialAccountId_peerId_key"
    UNIQUE ("tenantId", "socialAccountId", "peerId"),
  CONSTRAINT "ChatConversation_inboundCount_check" CHECK ("inboundCount" >= 0),
  CONSTRAINT "ChatConversation_messageCount_check" CHECK ("messageCount" >= 0)
);

CREATE INDEX IF NOT EXISTS "ChatConversation_tenantId_lastMessageAt_id_idx"
  ON public."ChatConversation"("tenantId", "lastMessageAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "ChatConversation_tenantId_status_lm_id_idx"
  ON public."ChatConversation"("tenantId", "status", "lastMessageAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "ChatConversation_tenantId_account_lm_id_idx"
  ON public."ChatConversation"("tenantId", "socialAccountId", "lastMessageAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "ChatConversation_tenant_assignee_status_lm_idx"
  ON public."ChatConversation"("tenantId", "assignedUserId", "status", "lastMessageAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "ChatConversation_tenantId_revision_idx"
  ON public."ChatConversation"("tenantId", "revision");
CREATE INDEX IF NOT EXISTS "ChatConversation_clientId_partial_idx"
  ON public."ChatConversation"("clientId")
  WHERE "clientId" IS NOT NULL;

DROP TRIGGER IF EXISTS "ChatConversation_revision_trg" ON public."ChatConversation";
CREATE TRIGGER "ChatConversation_revision_trg"
  BEFORE UPDATE ON public."ChatConversation"
  FOR EACH ROW
  EXECUTE FUNCTION public."ChatConversation_set_revision"();

-- ---------------------------------------------------------------------------
-- ChatConversationReadState — per-user unread (inboundCount − readInboundCount)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatConversationReadState" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "conversationId" text NOT NULL,
  "userId" text NOT NULL,
  "readInboundCount" integer NOT NULL DEFAULT 0,
  "lastReadAt" timestamp(3) without time zone NULL,
  "lastReadMessageId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversationReadState_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversationReadState_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversationReadState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversationReadState_conversationId_userId_key"
    UNIQUE ("conversationId", "userId"),
  CONSTRAINT "ChatConversationReadState_readInboundCount_check"
    CHECK ("readInboundCount" >= 0)
);

CREATE INDEX IF NOT EXISTS "ChatConversationReadState_tenantId_userId_idx"
  ON public."ChatConversationReadState"("tenantId", "userId");

-- ---------------------------------------------------------------------------
-- ChatMessage — promoted columns (nullable; legacy metadata kept)
-- Non-unique provider index only — 025 partial UNIQUE ships later.
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatMessage"
  ADD COLUMN IF NOT EXISTS "conversationId" text NULL,
  ADD COLUMN IF NOT EXISTS "providerMessageId" text NULL,
  ADD COLUMN IF NOT EXISTS "peerId" text NULL,
  ADD COLUMN IF NOT EXISTS "messageType" text NULL,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" text NULL,
  ADD COLUMN IF NOT EXISTS "statusUpdatedAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "deliveredAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "readAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "failedAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "errorCode" text NULL,
  ADD COLUMN IF NOT EXISTS "providerMediaId" text NULL,
  ADD COLUMN IF NOT EXISTS "mediaMimeType" text NULL,
  ADD COLUMN IF NOT EXISTS "mediaFilename" text NULL,
  ADD COLUMN IF NOT EXISTS "duplicateOfMessageId" text NULL,
  ADD COLUMN IF NOT EXISTS "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  ALTER TABLE public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_duplicateOfMessageId_fkey"
    FOREIGN KEY ("duplicateOfMessageId") REFERENCES public."ChatMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_sentAt_id_idx"
  ON public."ChatMessage"("conversationId", "sentAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "ChatMessage_socialAccountId_providerMessageId_idx"
  ON public."ChatMessage"("socialAccountId", "providerMessageId");
CREATE INDEX IF NOT EXISTS "ChatMessage_tenantId_createdAt_id_idx"
  ON public."ChatMessage"("tenantId", "createdAt", "id");

-- ---------------------------------------------------------------------------
-- RLS (new tables). Existing SocialAccount / ChatMessage already have RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatConversationReadState" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatConversation"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatConversationReadState"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
