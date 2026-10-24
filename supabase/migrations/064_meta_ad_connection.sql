-- 064 Meta ad account connection for ads_read (ad spend + ROAS in Estadísticas › Anuncios), 2026-10-23. Additive only.
-- Gated: BETSY_V2_APPLY_FILES=064 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
--
-- One row per business: the ad account the owner connected with Facebook Login for Business (ads_read only).
-- The user access token is stored encrypted (enc: prefix, same as SocialAccount.accessToken) and never sent to
-- the browser. "metaUserId" is the app-scoped Facebook user id, so Meta's data-deletion / deauthorize callback
-- can delete the row. "accounts" only holds id / name / currency while the owner picks an ad account.
-- "storeFxRate": optional owner-entered rate (store currency units per 1 ad-account currency unit), used for
-- ROAS only when the two currencies differ. Read with raw SQL only, NOT in prisma/schema.prisma: code deployed
-- before this file keeps working (the card shows "not available"). Rollback: deploy previous code; the table can stay.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."MetaAdConnection" (
  "tenantId" text PRIMARY KEY,
  "status" text NOT NULL DEFAULT 'pending_pick',
  "adAccountId" text NULL,
  "adAccountName" text NULL,
  "currency" text NULL,
  "timezoneName" text NULL,
  "accessToken" text NOT NULL,
  "tokenExpiresAt" timestamp(3) without time zone NULL,
  "metaUserId" text NULL,
  "accounts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "storeFxRate" numeric(14, 6) NULL,
  "connectedByUserId" text NULL,
  "lastErrorCode" text NULL,
  "lastErrorAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaAdConnection_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "MetaAdConnection_status_check" CHECK (
    "status" IN ('pending_pick', 'connected', 'token_invalid', 'missing_permission')),
  CONSTRAINT "MetaAdConnection_account_check" CHECK ("adAccountId" IS NULL OR "adAccountId" ~ '^[0-9]{1,20}$'),
  CONSTRAINT "MetaAdConnection_fx_check" CHECK ("storeFxRate" IS NULL OR ("storeFxRate" > 0 AND "storeFxRate" < 100000)),
  CONSTRAINT "MetaAdConnection_len_check" CHECK (
    char_length(coalesce("adAccountName", '')) <= 200 AND char_length(coalesce("currency", '')) <= 3
    AND char_length(coalesce("timezoneName", '')) <= 64 AND char_length("accessToken") <= 4096
    AND char_length(coalesce("metaUserId", '')) <= 30 AND char_length(coalesce("lastErrorCode", '')) <= 40)
);

CREATE INDEX IF NOT EXISTS "MetaAdConnection_metaUserId_idx" ON public."MetaAdConnection" ("metaUserId") WHERE "metaUserId" IS NOT NULL;

-- Supabase data API must not expose it (migration-rls-guard). The app role owns the table and bypasses RLS.
ALTER TABLE public."MetaAdConnection" ENABLE ROW LEVEL SECURITY;

COMMIT;
