-- 056 Instagram customer profile (Rafael 2026-10-18): the inbox shows the customer's real name, @username and
-- photo instead of "Instagram User 076336". Two nullable columns on ChatConversation; no data change, no index.
-- Renumbered from 055 because the live line already used 055 for InventoryItemAvailability.
-- Gated: BETSY_V2_APPLY_FILES=056. DO NOT run prisma db push / migrate.
--
-- ORDER: run this file BEFORE deploying the code that reads "peerUsername" / "peerProfileCheckedAt"
-- (Prisma selects every column of ChatConversation on plain reads; without the columns those reads fail).
-- The name lives in the existing "peerName", the photo in private chat storage (path in "peerAvatarUrl").
-- Rollback: none needed (old code ignores the two nullable columns).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."ChatConversation"
  ADD COLUMN IF NOT EXISTS "peerUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "peerProfileCheckedAt" TIMESTAMP(3);

COMMIT;
