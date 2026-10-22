-- 057 Chat send claims (Rafael 2026-10-22: "duplicate message + error though it was delivered").
-- One row per (business, clientRequestId) taken BEFORE a human inbox send goes to Meta, so a retry,
-- a double click or a second tab with the same id never sends the message twice, and a send Meta
-- accepted is never shown as failed. Rows are tiny and pruned after 3 days by the send route.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=057. DO NOT run prisma db push / migrate.
-- Not in schema.prisma (raw SQL in src/lib/chat-send-claim.ts). No foreign keys; tenant isolation in code.
-- ORDER: any order. Code deployed before this file simply skips the claim (same behaviour as today).
-- Rollback: deploy previous code; the table can stay (ignored) or be dropped.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatSendClaim" (
  "tenantId" text NOT NULL,
  "clientRequestId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'sending',
  "providerMessageId" text NULL,
  "messageId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSendClaim_pkey" PRIMARY KEY ("tenantId", "clientRequestId"),
  CONSTRAINT "ChatSendClaim_status_check" CHECK ("status" IN ('sending', 'delivered', 'failed'))
);
CREATE INDEX IF NOT EXISTS "ChatSendClaim_createdAt_idx" ON public."ChatSendClaim" ("createdAt");
ALTER TABLE public."ChatSendClaim" ENABLE ROW LEVEL SECURITY;
COMMIT;
