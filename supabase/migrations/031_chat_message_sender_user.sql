-- Optional FK column for human outbound attribution (metadata snapshot remains SoT for display).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Gated: BETSY_V2_APPLY_FILES=031 — never DEFAULT_APPLY_FILES.
-- DO NOT run prisma db push / migrate against Supabase.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."ChatMessage"
  ADD COLUMN IF NOT EXISTS "senderUserId" text NULL;

DO $$ BEGIN
  ALTER TABLE public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_senderUserId_fkey"
    FOREIGN KEY ("senderUserId") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ChatMessage_tenantId_senderUserId_idx"
  ON public."ChatMessage" ("tenantId", "senderUserId")
  WHERE "senderUserId" IS NOT NULL;

COMMENT ON COLUMN public."ChatMessage"."senderUserId" IS
  'Human agent who sent outbound. Soft AI leaves null; display prefers metadata.senderName snapshot.';

COMMIT;
