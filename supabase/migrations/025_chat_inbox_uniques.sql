-- Chat inbox uniqueness constraints (Respond.io PR-2 / 025).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Apply ONLY after chat-inbox-verify reports:
--   - 0 duplicate (socialAccountId, providerMessageId) where providerMessageId IS NOT NULL
--   - 0 duplicate active (platform, accountId) where isActive = true
-- Do NOT include 025 in BETSY_V2_APPLY_FILES default set.
-- Additive / expand-only. Uses IF NOT EXISTS / concurrent-safe CONCURRENTLY avoided
-- inside transaction (Supabase gated apply wraps BEGIN).

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Idempotency for Meta provider message ids (webhook + send + echo collision).
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_socialAccountId_providerMessageId_uidx"
  ON public."ChatMessage" ("socialAccountId", "providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;

-- One Meta asset may be actively connected to exactly one tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_platform_accountId_active_uidx"
  ON public."SocialAccount" ("platform", "accountId")
  WHERE "isActive" = true;

COMMIT;
