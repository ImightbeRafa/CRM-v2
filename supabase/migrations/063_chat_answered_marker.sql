-- 063 "Respondido" marker on chats (Rafael 2026-10-22): a person marks a chat in "Sin responder" as answered
-- (handled outside Betsy, nothing to reply, or the agent's hand-off is done). The chat leaves Sin responder until
-- the customer writes again (a later inbound / a later hand-off is newer than the marker).
-- Three nullable columns on ChatConversation; no data change, no index (read only per chat, inside the open-chat scan).
-- answeredAt / answeredByUserId = who clicked and when (audit); answeredThroughAt = the last customer message the
-- click covers, in the same (Meta) clock as the message times it is compared with.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=063. DO NOT run prisma db push / migrate.
-- Not in schema.prisma (read/written with raw SQL in src/lib/chat-unanswered-server.ts + the answered route, which
-- check the columns exist). A prisma db push on another database would drop them (safe-db-push refuses Supabase).
-- ORDER: any order. Code deployed before this file hides "Respondido" and keeps today's Sin responder rule.
-- Rollback: deploy previous code; the columns can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."ChatConversation"
  ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "answeredByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "answeredThroughAt" TIMESTAMP(3);

COMMIT;
