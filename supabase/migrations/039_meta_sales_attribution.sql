-- 039 Meta sales attribution (ad referral capture + Business Messaging CAPI outbox). Additive only.
-- Gated: BETSY_V2_APPLY_FILES=039 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Code is fail-safe on missing tables (P2021/42P01). Rollback: deploy previous code; tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- One row per ad click that opened (or re-opened) a chat. ctwaClid is the WhatsApp click id Meta
-- needs to attribute a later sale; it is only ever sent back to the same business's own dataset.
CREATE TABLE IF NOT EXISTS public."ChatAdReferral" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "socialAccountId" text NOT NULL,
  "conversationId" text NOT NULL,
  "messageId" text NULL,
  "platform" text NOT NULL,
  "dedupeKey" text NOT NULL,
  "sourceType" text NULL,
  "sourceId" text NULL,
  "sourceUrl" text NULL,
  "headline" text NULL,
  "body" text NULL,
  "mediaType" text NULL,
  "ctwaClid" text NULL,
  "refParam" text NULL,
  "occurredAt" timestamp(3) without time zone NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAdReferral_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdReferral_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdReferral_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdReferral_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAdReferral_platform_check" CHECK ("platform" IN ('whatsapp', 'instagram')),
  CONSTRAINT "ChatAdReferral_len_check" CHECK (
    char_length("dedupeKey") BETWEEN 1 AND 300
    AND char_length(coalesce("headline", '')) <= 300
    AND char_length(coalesce("body", '')) <= 1000
    AND char_length(coalesce("sourceUrl", '')) <= 2048
    AND char_length(coalesce("ctwaClid", '')) <= 512
    AND char_length(coalesce("refParam", '')) <= 500),
  CONSTRAINT "ChatAdReferral_account_dedupe_key" UNIQUE ("socialAccountId", "dedupeKey")
);
CREATE INDEX IF NOT EXISTS "ChatAdReferral_conversation_time_idx" ON public."ChatAdReferral" ("conversationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ChatAdReferral_tenant_source_idx" ON public."ChatAdReferral" ("tenantId", "sourceId", "occurredAt") WHERE "sourceId" IS NOT NULL;
ALTER TABLE public."ChatAdReferral" ENABLE ROW LEVEL SECURITY;

-- Per connected line: the business's own Meta dataset and whether its token can send events.
CREATE TABLE IF NOT EXISTS public."MetaCapiDataset" (
  "socialAccountId" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "datasetId" text NULL,
  "status" text NOT NULL DEFAULT 'unknown',
  "grantedScopes" text[] NOT NULL DEFAULT '{}',
  "checkedAt" timestamp(3) without time zone NULL,
  "lastErrorCode" text NULL,
  "lastErrorAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaCapiDataset_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaCapiDataset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaCapiDataset_status_check" CHECK ("status" IN ('unknown', 'ready', 'missing_permission', 'token_invalid', 'error'))
);
CREATE INDEX IF NOT EXISTS "MetaCapiDataset_tenant_idx" ON public."MetaCapiDataset" ("tenantId");
ALTER TABLE public."MetaCapiDataset" ENABLE ROW LEVEL SECURITY;

-- Outbox of conversion events. Holds references only; the click id is re-read at send time.
CREATE TABLE IF NOT EXISTS public."MetaConversionEvent" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "socialAccountId" text NOT NULL,
  "conversationId" text NULL,
  "orderId" text NULL,
  "referralId" text NULL,
  "eventName" text NOT NULL,
  "eventId" text NOT NULL,
  "eventTime" timestamp(3) without time zone NOT NULL,
  "value" numeric(14,2) NULL,
  "currency" text NULL,
  "channel" text NOT NULL,
  "isTest" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "availableAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" text NULL,
  "leaseExpiresAt" timestamp(3) without time zone NULL,
  "sentAt" timestamp(3) without time zone NULL,
  "fbtraceId" text NULL,
  "lastErrorCode" text NULL,
  "lastErrorAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaConversionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaConversionEvent_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaConversionEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MetaConversionEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MetaConversionEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES public."ChatAdReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MetaConversionEvent_eventName_check" CHECK ("eventName" IN ('Purchase', 'LeadSubmitted')),
  CONSTRAINT "MetaConversionEvent_channel_check" CHECK ("channel" IN ('whatsapp', 'instagram')),
  CONSTRAINT "MetaConversionEvent_status_check" CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'skipped', 'expired')),
  CONSTRAINT "MetaConversionEvent_tenant_event_key" UNIQUE ("tenantId", "eventId")
);
CREATE INDEX IF NOT EXISTS "MetaConversionEvent_claim_idx" ON public."MetaConversionEvent" ("status", "availableAt") WHERE "status" IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS "MetaConversionEvent_tenant_order_idx" ON public."MetaConversionEvent" ("tenantId", "orderId") WHERE "orderId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "MetaConversionEvent_tenant_created_idx" ON public."MetaConversionEvent" ("tenantId", "createdAt" DESC);
ALTER TABLE public."MetaConversionEvent" ENABLE ROW LEVEL SECURITY;
COMMIT;
