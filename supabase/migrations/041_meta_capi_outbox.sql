-- 041 Meta sales attribution, step 3: per-line dataset + conversion-event outbox. Additive only.
-- Gated: BETSY_V2_APPLY_FILES=041 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Code is fail-safe on missing tables (P2021/42P01). Rollback: deploy previous code; tables can stay (ignored).
-- Holds ids and amounts only (no names, phones or click ids: the click id is re-read from
-- ChatAdReferral at send time). Foreign keys only onto Tenant and SocialAccount (cascade on delete);
-- orders / chats / referrals are referenced by id without a constraint, keeping busy tables out of
-- the lock set. Apply in a quiet window.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Per connected WhatsApp line: the business's own Meta dataset and whether its token may send events.
CREATE TABLE IF NOT EXISTS public."MetaCapiDataset" (
  "socialAccountId" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "datasetId" text NULL,
  "status" text NOT NULL DEFAULT 'unknown',
  "checkedAt" timestamp(3) without time zone NULL,
  "lastErrorCode" text NULL,
  "lastErrorAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaCapiDataset_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaCapiDataset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MetaCapiDataset_status_check" CHECK ("status" IN ('unknown', 'ready', 'missing_permission', 'token_invalid', 'error')),
  CONSTRAINT "MetaCapiDataset_len_check" CHECK (
    char_length(coalesce("datasetId", '')) <= 64 AND char_length(coalesce("lastErrorCode", '')) <= 120)
);
CREATE INDEX IF NOT EXISTS "MetaCapiDataset_tenant_idx" ON public."MetaCapiDataset" ("tenantId");
ALTER TABLE public."MetaCapiDataset" ENABLE ROW LEVEL SECURITY;

-- Outbox of conversion events (one per paid order that came from an ad).
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
  CONSTRAINT "MetaConversionEvent_eventName_check" CHECK ("eventName" IN ('Purchase')),
  CONSTRAINT "MetaConversionEvent_channel_check" CHECK ("channel" IN ('whatsapp', 'instagram')),
  CONSTRAINT "MetaConversionEvent_currency_check" CHECK ("currency" IS NULL OR "currency" IN ('CRC', 'USD')),
  CONSTRAINT "MetaConversionEvent_status_check" CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'skipped', 'expired')),
  CONSTRAINT "MetaConversionEvent_len_check" CHECK (
    char_length("eventId") <= 200 AND char_length(coalesce("fbtraceId", '')) <= 120
    AND char_length(coalesce("lastErrorCode", '')) <= 120),
  CONSTRAINT "MetaConversionEvent_tenant_event_key" UNIQUE ("tenantId", "eventId")
);
CREATE INDEX IF NOT EXISTS "MetaConversionEvent_claim_idx" ON public."MetaConversionEvent" ("status", "availableAt") WHERE "status" IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS "MetaConversionEvent_account_idx" ON public."MetaConversionEvent" ("socialAccountId");
CREATE INDEX IF NOT EXISTS "MetaConversionEvent_tenant_created_idx" ON public."MetaConversionEvent" ("tenantId", "createdAt" DESC);
ALTER TABLE public."MetaConversionEvent" ENABLE ROW LEVEL SECURITY;
COMMIT;
