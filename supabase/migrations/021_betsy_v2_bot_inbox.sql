-- Betsy v2 durable provider inbox and bot-seat metadata.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive only. The currently deployed application ignores every addition.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."BotSession"
  ADD COLUMN IF NOT EXISTS "accessRole" text NULL,
  ADD COLUMN IF NOT EXISTS "seatPolicy" text NULL,
  ADD COLUMN IF NOT EXISTS "grandfatheredAt" timestamp(3) without time zone NULL,
  ADD COLUMN IF NOT EXISTS "seatOverageAt" timestamp(3) without time zone NULL;

-- Null on pre-v2 rows is interpreted as GRANDFATHERED by the application. New
-- code explicitly writes COUNTED for new unlinked sessions. No existing row is
-- rewritten by this schema package.

ALTER TABLE public."Invoice"
  ADD COLUMN IF NOT EXISTS "sourceOperationKey" text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_sourceOperationKey_key"
  ON public."Invoice"("tenantId", "sourceOperationKey")
  WHERE "sourceOperationKey" IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."BotInboxMessage" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "platform" text NOT NULL,
  "providerMessageId" text NOT NULL,
  "conversationKey" text NOT NULL,
  "payload" jsonb NULL,
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
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotInboxMessage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BotInboxMessage_platform_check"
    CHECK ("platform" IN ('whatsapp', 'telegram')),
  CONSTRAINT "BotInboxMessage_status_check"
    CHECK ("status" IN ('pending', 'processing', 'retry', 'completed', 'failed')),
  CONSTRAINT "BotInboxMessage_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "BotInboxMessage_platform_providerMessageId_key"
    UNIQUE ("platform", "providerMessageId")
);

CREATE INDEX IF NOT EXISTS "BotInboxMessage_status_availableAt_createdAt_idx"
  ON public."BotInboxMessage"("status", "availableAt", "createdAt");
CREATE INDEX IF NOT EXISTS "BotInboxMessage_platform_conversationKey_status_createdAt_idx"
  ON public."BotInboxMessage"("platform", "conversationKey", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "BotInboxMessage_tenantId_status_idx"
  ON public."BotInboxMessage"("tenantId", "status");

-- Outbound delivery claims prevent a serverless retry from re-sending chunks
-- already accepted by Meta/Telegram. A row left in `sending` is deliberately
-- treated as ambiguous and requires reconciliation rather than blind resend.
CREATE TABLE IF NOT EXISTS public."BotInboxDelivery" (
  "id" text PRIMARY KEY,
  "inboxMessageId" text NOT NULL,
  "deliveryKey" text NOT NULL,
  "kind" text NOT NULL,
  "contentHash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'sending',
  "providerDeliveryId" text NULL,
  "lastErrorCode" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" timestamp(3) without time zone NULL,
  CONSTRAINT "BotInboxDelivery_inboxMessageId_fkey"
    FOREIGN KEY ("inboxMessageId") REFERENCES public."BotInboxMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BotInboxDelivery_status_check"
    CHECK ("status" IN ('sending', 'sent', 'ambiguous')),
  CONSTRAINT "BotInboxDelivery_inboxMessageId_deliveryKey_key"
    UNIQUE ("inboxMessageId", "deliveryKey")
);

CREATE INDEX IF NOT EXISTS "BotInboxDelivery_status_updatedAt_idx"
  ON public."BotInboxDelivery"("status", "updatedAt");

ALTER TABLE public."BotInboxMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BotInboxDelivery" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."BotInboxMessage"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."BotInboxDelivery"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
