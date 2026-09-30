-- Two-step login (2FA) with an authenticator app + one-time recovery codes (2026-09-30).
--
-- NEW TABLES ONLY. No change to any existing table, no data written. Every table has row-level
-- security ON with no policies (deny-all for Supabase's anon / authenticated roles; the app
-- connects as the owner and is unaffected). The app treats these tables being absent as "nobody
-- enrolled" (nobody can enrol before they exist), so apply order vs deploy does not matter.
--
-- - UserTwoFactor: one row per user. secretEnc is AES-GCM bound to the user (never plaintext);
--   enabledAt NULL = setup not finished yet (expires at setupExpiresAt); lastUsedStep blocks replay.
-- - UserRecoveryCode: keyed hashes only, each usable once (usedAt).
-- - UserTwoFactorChallenge: the "password OK, code pending" step of one sign-in (nonce hash only,
--   attempt counter, verified / consumed once).
-- - TenantSecurityPolicy: a business can require 2FA for its whole team.
--
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Gated: BETSY_V2_APPLY_FILES=038 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Rollback (only if Rafael asks): deploy code without 2FA first, take a backup, then remove the four
-- new tables. (No literal destructive SQL in this file: the apply script refuses any file with it.)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."UserTwoFactor" (
  "userId" text PRIMARY KEY,
  "secretEnc" text NOT NULL,
  "enabledAt" timestamp(3) without time zone NULL,
  "setupExpiresAt" timestamp(3) without time zone NULL,
  "lastUsedStep" bigint NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserTwoFactor_secret_check" CHECK ("secretEnc" LIKE 'enc:mfa1:%')
);
ALTER TABLE public."UserTwoFactor" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."UserRecoveryCode" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "codeHash" text NOT NULL,
  "usedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserRecoveryCode_userId_codeHash_key" ON public."UserRecoveryCode" ("userId", "codeHash");
ALTER TABLE public."UserRecoveryCode" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."UserTwoFactorChallenge" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "nonceHash" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "verifiedAt" timestamp(3) without time zone NULL,
  "consumedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTwoFactorChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserTwoFactorChallenge_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserTwoFactorChallenge_nonceHash_key" ON public."UserTwoFactorChallenge" ("nonceHash");
CREATE INDEX IF NOT EXISTS "UserTwoFactorChallenge_userId_expiresAt_idx" ON public."UserTwoFactorChallenge" ("userId", "expiresAt");
ALTER TABLE public."UserTwoFactorChallenge" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."TenantSecurityPolicy" (
  "tenantId" text PRIMARY KEY,
  "requireTwoFactor" boolean NOT NULL DEFAULT false,
  "updatedByUserId" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantSecurityPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE public."TenantSecurityPolicy" ENABLE ROW LEVEL SECURITY;

COMMIT;
