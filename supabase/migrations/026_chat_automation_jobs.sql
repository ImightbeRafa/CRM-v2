-- Soft AI durable automation queue (Respond.io Phase 4).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Soft-only — shares no tables with staff BotInbox*.
-- Gated like 025: registered in manifest but NOT in DEFAULT_APPLY_FILES.
-- Apply only via BETSY_V2_APPLY_FILES=026 after human review.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- Optional ChatMessage media cache columns (Blob paths only; never Meta URLs)
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatMessage"
  ADD COLUMN IF NOT EXISTS "mediaBlobPath" text NULL,
  ADD COLUMN IF NOT EXISTS "mediaCacheStatus" text NULL,
  ADD COLUMN IF NOT EXISTS "mediaSizeBytes" integer NULL,
  ADD COLUMN IF NOT EXISTS "mediaCachedAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "mediaErrorCode" text NULL;

-- ---------------------------------------------------------------------------
-- ChatAutomationJob — Soft AI inbound lease queue (copy BotInboxMessage pattern)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAutomationJob" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "conversationId" text NOT NULL,
  "messageId" text NOT NULL,
  "socialAccountId" text NOT NULL,
  "peerId" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'soft_ai_inbound',
  "deliveryKey" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "availableAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" text NULL,
  "leaseExpiresAt" timestamp(3) without time zone NULL,
  "processingStartedAt" timestamp(3) without time zone NULL,
  "processedAt" timestamp(3) without time zone NULL,
  "failedAt" timestamp(3) without time zone NULL,
  "lastErrorCode" text NULL,
  "lastErrorAt" timestamp(3) without time zone NULL,
  "payload" jsonb NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAutomationJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAutomationJob_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAutomationJob_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES public."ChatMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAutomationJob_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAutomationJob_kind_check"
    CHECK ("kind" IN ('soft_ai_inbound')),
  CONSTRAINT "ChatAutomationJob_status_check"
    CHECK ("status" IN ('pending', 'processing', 'retry', 'completed', 'failed', 'ambiguous')),
  CONSTRAINT "ChatAutomationJob_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "ChatAutomationJob_deliveryKey_key" UNIQUE ("deliveryKey")
);

CREATE INDEX IF NOT EXISTS "ChatAutomationJob_status_availableAt_createdAt_idx"
  ON public."ChatAutomationJob"("status", "availableAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatAutomationJob_tenantId_status_idx"
  ON public."ChatAutomationJob"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "ChatAutomationJob_conversationId_status_createdAt_idx"
  ON public."ChatAutomationJob"("conversationId", "status", "createdAt");

-- Outbound delivery claims (Soft-only). ready → sending → sent;
-- unclear provider outcome → ambiguous (never auto-resend).
CREATE TABLE IF NOT EXISTS public."ChatAutomationDelivery" (
  "id" text PRIMARY KEY,
  "jobId" text NOT NULL,
  "deliveryKey" text NOT NULL,
  "kind" text NOT NULL,
  "contentHash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ready',
  "providerDeliveryId" text NULL,
  "lastErrorCode" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" timestamp(3) without time zone NULL,
  CONSTRAINT "ChatAutomationDelivery_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES public."ChatAutomationJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAutomationDelivery_status_check"
    CHECK ("status" IN ('ready', 'sending', 'sent', 'ambiguous')),
  CONSTRAINT "ChatAutomationDelivery_jobId_deliveryKey_key"
    UNIQUE ("jobId", "deliveryKey")
);

CREATE INDEX IF NOT EXISTS "ChatAutomationDelivery_status_updatedAt_idx"
  ON public."ChatAutomationDelivery"("status", "updatedAt");

ALTER TABLE public."ChatAutomationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAutomationDelivery" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAutomationJob"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAutomationDelivery"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
