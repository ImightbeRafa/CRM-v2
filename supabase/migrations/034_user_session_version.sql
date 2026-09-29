-- Security (2026-09-28): session revocation. A password reset bumps "sessionVersion"; sessions
-- (JWT + the signed API context) carrying an older version stop working. See
-- src/lib/session-revocation.ts.
--
-- Additive only: two columns on "User", one with a constant default (metadata-only on PG 11+, no
-- table rewrite) and one nullable. No data is changed; every existing user reads version 0, which
-- is exactly what current sessions carry, so applying this logs nobody out. The app code also
-- runs without these columns (availability), BUT apply this BEFORE deploying the Phase 1 auth code:
-- without it session revocation is inert, so a password reset / first Google proof cannot end a
-- squatter's session (Security Register AUTH-08 / AUTH-11).
-- No new table: row-level security is unchanged.
--
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Gated: BETSY_V2_APPLY_FILES=034 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Rollback (only if needed): remove the two columns by hand; the code falls back to version 0.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS "sessionVersion" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp(3) NULL;

-- Exact case-insensitive email lookups (src/lib/user-lookup.ts: lower(email) = lower($1)) run on
-- every login / register / reset: without this they scan "User". Small table, brief lock.
CREATE INDEX IF NOT EXISTS "User_email_lower_idx" ON public."User" (lower(email));

COMMIT;
