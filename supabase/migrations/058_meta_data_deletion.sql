-- 058 Meta data deletion that matches the privacy policy (Lane F, 2026-10-22). Additive only.
-- Gated: BETSY_V2_APPLY_FILES=058 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
--
-- 1. SocialAccount."metaUserId": the app-scoped Facebook user id of the person who connected the line.
--    Meta's data-deletion / deauthorize callbacks only carry that id (not the Instagram account id), so
--    without it the callback cannot find what to delete.
-- 2. MetaDataDeletionRequest: one row per deletion / deauthorize callback, so the public status page shows
--    the real state and a storage purge that failed is retried by the nightly retention cron.
--    Holds no raw Meta id (only an HMAC), no names and no tokens.
--
-- Both are read with raw SQL only and are NOT in prisma/schema.prisma, so code deployed before this file
-- keeps working (it falls back to the old match and shows a generic status). Safe to apply before or after.
-- Rollback: deploy previous code; the column and table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."SocialAccount" ADD COLUMN IF NOT EXISTS "metaUserId" TEXT;
CREATE INDEX IF NOT EXISTS "SocialAccount_metaUserId_idx" ON public."SocialAccount" ("metaUserId") WHERE "metaUserId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."MetaDataDeletionRequest" (
  "id" text PRIMARY KEY,
  "confirmationCode" text NOT NULL,
  "kind" text NOT NULL,
  "metaUserKey" text NOT NULL,
  "status" text NOT NULL DEFAULT 'received',
  "matchedAccounts" integer NOT NULL DEFAULT 0,
  "accountIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pendingPaths" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "attempts" integer NOT NULL DEFAULT 0,
  "lastErrorCode" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" timestamp(3) without time zone NULL,
  CONSTRAINT "MetaDataDeletionRequest_code_key" UNIQUE ("confirmationCode"),
  CONSTRAINT "MetaDataDeletionRequest_kind_check" CHECK ("kind" IN ('deletion', 'deauthorize')),
  CONSTRAINT "MetaDataDeletionRequest_status_check" CHECK (
    "status" IN ('received', 'pending', 'pending_storage', 'completed', 'no_data', 'failed')),
  CONSTRAINT "MetaDataDeletionRequest_len_check" CHECK (
    char_length("confirmationCode") <= 40 AND char_length("metaUserKey") <= 80
    AND char_length(coalesce("lastErrorCode", '')) <= 120)
);
CREATE INDEX IF NOT EXISTS "MetaDataDeletionRequest_open_idx" ON public."MetaDataDeletionRequest" ("status", "updatedAt")
  WHERE "status" IN ('received', 'pending', 'pending_storage');
CREATE INDEX IF NOT EXISTS "MetaDataDeletionRequest_user_idx" ON public."MetaDataDeletionRequest" ("metaUserKey", "createdAt" DESC);
ALTER TABLE public."MetaDataDeletionRequest" ENABLE ROW LEVEL SECURITY;
COMMIT;
