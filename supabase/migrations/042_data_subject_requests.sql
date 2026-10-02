-- 042 Ley 8968 customer erasure support: do-not-re-import list + chat-file purge outbox. Additive only.
-- Gated: BETSY_V2_APPLY_FILES=042 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Numbering: 038 = 2FA (standby), 039–041 = live line (attribution / ops). No personal data stored:
-- the suppression row holds a keyed hash of the phone, the outbox holds storage paths only.
-- Rollback: deploy previous code; tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."DataSubjectSuppression" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "kind" text NOT NULL,
  "valueHash" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataSubjectSuppression_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DataSubjectSuppression_kind_check" CHECK ("kind" IN ('phone')),
  CONSTRAINT "DataSubjectSuppression_hash_check" CHECK (char_length("valueHash") = 64),
  CONSTRAINT "DataSubjectSuppression_tenant_value_key" UNIQUE ("tenantId", "kind", "valueHash")
);
ALTER TABLE public."DataSubjectSuppression" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."DataSubjectMediaPurge" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "path" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "lastAttemptAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataSubjectMediaPurge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DataSubjectMediaPurge_path_check" CHECK (char_length("path") BETWEEN 1 AND 1024)
);
CREATE INDEX IF NOT EXISTS "DataSubjectMediaPurge_tenant_idx" ON public."DataSubjectMediaPurge" ("tenantId");
CREATE INDEX IF NOT EXISTS "DataSubjectMediaPurge_created_idx" ON public."DataSubjectMediaPurge" ("createdAt") WHERE "attempts" < 20;
ALTER TABLE public."DataSubjectMediaPurge" ENABLE ROW LEVEL SECURITY;
COMMIT;
