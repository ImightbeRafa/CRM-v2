-- Team-level "answered" marker (2026-09-30). A chat's unread badge was per person only, so when one
-- teammate replied, everyone else still saw the customer's messages as pending. The conversation now
-- remembers how many inbound messages the TEAM had answered: every confirmed outbound reply (Betsy
-- send, WhatsApp Business app echo, AI agent reply) sets it to the inbound count at that moment.
-- Unread for a viewer = inboundCount - max(own read count, team replied count).
--
-- ONE column with a constant default (metadata-only in Postgres 11+, no table rewrite) in its OWN
-- short transaction, so the table lock is released at once (webhook writes are never held behind the
-- backfill). Then a separate backfill of existing chats from their last confirmed outbound message:
-- it only raises the value from 0 and touches no other column. The revision trigger bumps those rows,
-- so open inboxes pick up the corrected badges on their next sync. Idempotent: safe to re-run (e.g.
-- after deploy, to cover chats answered between apply and deploy).
--
-- APPLY BEFORE deploying the code that selects the column (Prisma would fail on a missing column).
-- Gated: BETSY_V2_APPLY_FILES=037 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Rollback (only if Rafael asks): deploy the previous code first; the column can then stay (ignored).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public."ChatConversation"
  ADD COLUMN IF NOT EXISTS "repliedInboundCount" integer NOT NULL DEFAULT 0;
COMMIT;

-- Backfill (row locks only). Inbound count minus the non-duplicate inbound messages that arrived after
-- the last confirmed outbound reply (never below 0, never above inboundCount).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
WITH last_reply AS (
  SELECT m."conversationId", max(m."sentAt") AS at
  FROM public."ChatMessage" m
  WHERE m."direction" = 'outbound'
    AND m."conversationId" IS NOT NULL
    AND m."deliveryStatus" IN ('sent', 'delivered', 'read')
  GROUP BY m."conversationId"
),
computed AS (
  SELECT c."id",
         GREATEST(0, LEAST(c."inboundCount", c."inboundCount" - (
           SELECT count(*)::int FROM public."ChatMessage" i
           WHERE i."conversationId" = c."id" AND i."direction" = 'inbound'
             AND i."duplicateOfMessageId" IS NULL AND i."sentAt" > lr.at
         ))) AS replied
  FROM public."ChatConversation" c
  JOIN last_reply lr ON lr."conversationId" = c."id"
)
UPDATE public."ChatConversation" c
SET "repliedInboundCount" = computed.replied
FROM computed
WHERE computed."id" = c."id" AND computed.replied > c."repliedInboundCount";
COMMIT;
