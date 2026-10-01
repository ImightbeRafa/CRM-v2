-- 039 Meta sales attribution, step 1: ad referral capture only. Additive only.
-- Gated: BETSY_V2_APPLY_FILES=039 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Code is fail-safe on missing tables (P2021/42P01). Rollback: deploy previous code; tables can stay (ignored).
-- Apply in a quiet window (madrugada): the foreign keys briefly block writes on ChatConversation,
-- SocialAccount and Tenant. They are declared in the same order the webhook writes them, to avoid
-- lock-order deadlocks. messageId has no foreign key on purpose (keeps ChatMessage out of the lock set).
-- The dataset + conversion outbox tables come in a later migration (step 3).
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
  CONSTRAINT "ChatAdReferral_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdReferral_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES public."SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdReferral_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
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
CREATE INDEX IF NOT EXISTS "ChatAdReferral_tenant_idx" ON public."ChatAdReferral" ("tenantId");
CREATE INDEX IF NOT EXISTS "ChatAdReferral_account_idx" ON public."ChatAdReferral" ("socialAccountId");
CREATE INDEX IF NOT EXISTS "ChatAdReferral_clid_age_idx" ON public."ChatAdReferral" ("occurredAt") WHERE "ctwaClid" IS NOT NULL;
ALTER TABLE public."ChatAdReferral" ENABLE ROW LEVEL SECURITY;


COMMIT;
