-- Soft Agent Layer A1.5 — ChatAgent.introductionNames (presentation names).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Soft-only.
-- Gated like 027: registered in manifest but NOT in DEFAULT_APPLY_FILES.
-- Apply only via BETSY_V2_APPLY_FILES=027b after human review + Blob backup.
-- Depends on 027 (ChatAgent table). Do NOT run prisma db push / migrate against Supabase.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."ChatAgent"
  ADD COLUMN IF NOT EXISTS "introductionNames" text[] NOT NULL DEFAULT '{}';

-- Empty array = omit identity layer (legacy rows). App enforces 1–3 unique names on write.
COMMENT ON COLUMN public."ChatAgent"."introductionNames" IS
  'A1.5 presentation names (1–3) used when introducing on a new chat; empty = omit layer';

COMMIT;
