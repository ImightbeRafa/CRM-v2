-- Team invites: join inviting tenant on email/Google accept (never orphan tenant).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Gated: BETSY_V2_APPLY_FILES=030 — never DEFAULT_APPLY_FILES.
-- DO NOT run prisma db push / migrate against Supabase.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."TenantInvite" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "token" text NOT NULL,
  "invitedByUserId" text NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "acceptedAt" timestamp(3) without time zone NULL,
  "acceptedUserId" text NULL,
  "revokedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantInvite_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantInvite_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES public."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantInvite_acceptedUserId_fkey"
    FOREIGN KEY ("acceptedUserId") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TenantInvite_role_check"
    CHECK ("role" IN ('ADMIN', 'MANAGER', 'SALES', 'PRODUCTION', 'VIEWER')),
  CONSTRAINT "TenantInvite_token_key" UNIQUE ("token")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantInvite_tenantId_email_pending_uidx"
  ON public."TenantInvite" ("tenantId", lower("email"))
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "TenantInvite_email_idx"
  ON public."TenantInvite" (lower("email"));

CREATE INDEX IF NOT EXISTS "TenantInvite_tenantId_createdAt_idx"
  ON public."TenantInvite" ("tenantId", "createdAt" DESC);

COMMENT ON TABLE public."TenantInvite" IS
  'Pending team invites. Accept path must join inviting tenant; never provision orphan org.';

COMMIT;
