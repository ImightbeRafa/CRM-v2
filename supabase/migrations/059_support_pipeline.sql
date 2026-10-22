-- 059 Support pipeline: tickets, thread, outbox, MCP audit (Lane G, 2026-10-22). Additive only.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Gated: BETSY_V2_APPLY_FILES=059 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Spec: docs/plans/support-pipeline/SPEC.md §3. Runbook: docs/runbooks/support-pipeline.md.
--
-- 1. SupportTicket: one row per contact form / in-app ticket / agent lead. "number" is the human ref (BETSY-n).
--    Holds the contact email the customer typed (needed to answer) and a salted IP hash, never the raw IP.
-- 2. SupportTicketMessage: the thread. visibility 'internal' is never shown or emailed to the customer.
-- 3. SupportTicketEvent: outbox written in the same transaction as the ticket; the dispatcher pushes it
--    to the support agent webhook and sends the notification email, with retries.
-- 4. SupportMcpAudit: one row per /api/mcp tool call (tool, ticket, ok/error). No tool arguments stored.
--
-- The models are in prisma/schema.prisma, but code deployed before this file keeps working: every support
-- read/write catches a missing table and falls back to the legacy contact email (and the whole pipeline is
-- off unless SUPPORT_PIPELINE_ENABLED=true). Apply before turning the pipeline on.
-- Rollback: SUPPORT_PIPELINE_ENABLED=false; the tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."SupportTicket" (
  "id" text PRIMARY KEY,
  "number" bigserial NOT NULL,
  "tenantId" text NULL REFERENCES public."Tenant"("id") ON DELETE SET NULL,
  "userId" text NULL REFERENCES public."User"("id") ON DELETE SET NULL,
  "source" text NOT NULL,
  "category" text NOT NULL DEFAULT 'question',
  "priority" text NOT NULL DEFAULT 'normal',
  "status" text NOT NULL DEFAULT 'open',
  "subject" text NOT NULL,
  "contactName" text NULL,
  "contactEmail" text NOT NULL,
  "assignee" text NOT NULL DEFAULT 'grok_agent',
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "legacyFeedbackTicketId" text NULL,
  "lastCustomerMessageAt" timestamp(3) without time zone NULL,
  "lastAgentMessageAt" timestamp(3) without time zone NULL,
  "resolvedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_number_key" UNIQUE ("number"),
  CONSTRAINT "SupportTicket_legacyFeedbackTicketId_key" UNIQUE ("legacyFeedbackTicketId"),
  CONSTRAINT "SupportTicket_source_check" CHECK ("source" IN ('contact_form', 'in_app', 'ai_chat', 'email', 'agent_request')),
  CONSTRAINT "SupportTicket_category_check" CHECK ("category" IN ('bug', 'billing', 'question', 'feature', 'agent_request', 'other')),
  CONSTRAINT "SupportTicket_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT "SupportTicket_status_check" CHECK (
    "status" IN ('open', 'ai_answered', 'waiting_customer', 'escalated', 'resolved', 'closed', 'spam')),
  CONSTRAINT "SupportTicket_assignee_check" CHECK ("assignee" IN ('grok_agent', 'rafael')),
  CONSTRAINT "SupportTicket_len_check" CHECK (
    char_length("subject") <= 200 AND char_length(coalesce("contactName", '')) <= 120
    AND char_length("contactEmail") <= 254)
);
CREATE INDEX IF NOT EXISTS "SupportTicket_tenant_status_idx" ON public."SupportTicket" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_user_idx" ON public."SupportTicket" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SupportTicket_status_created_idx" ON public."SupportTicket" ("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SupportTicket_email_idx" ON public."SupportTicket" (lower("contactEmail"));
ALTER TABLE public."SupportTicket" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."SupportTicketMessage" (
  "id" text PRIMARY KEY,
  "ticketId" text NOT NULL REFERENCES public."SupportTicket"("id") ON DELETE CASCADE,
  "author" text NOT NULL,
  "visibility" text NOT NULL DEFAULT 'public',
  "body" text NOT NULL,
  "isDraft" boolean NOT NULL DEFAULT false,
  "emailMessageId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_author_check" CHECK ("author" IN ('customer', 'grok_agent', 'rafael', 'system')),
  CONSTRAINT "SupportTicketMessage_visibility_check" CHECK ("visibility" IN ('public', 'internal')),
  CONSTRAINT "SupportTicketMessage_len_check" CHECK (char_length("body") <= 10000)
);
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_ticket_idx" ON public."SupportTicketMessage" ("ticketId", "createdAt");
ALTER TABLE public."SupportTicketMessage" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."SupportTicketEvent" (
  "id" text PRIMARY KEY,
  "ticketId" text NOT NULL REFERENCES public."SupportTicket"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "webhookStatus" text NOT NULL DEFAULT 'pending',
  "emailStatus" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "nextAttemptAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" timestamp(3) without time zone NULL,
  "lastError" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketEvent_type_check" CHECK (
    "type" IN ('ticket.created', 'ticket.customer_replied', 'ticket.escalated')),
  CONSTRAINT "SupportTicketEvent_webhook_check" CHECK ("webhookStatus" IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT "SupportTicketEvent_email_check" CHECK ("emailStatus" IN ('pending', 'sent', 'failed', 'skipped'))
);
CREATE INDEX IF NOT EXISTS "SupportTicketEvent_pending_idx" ON public."SupportTicketEvent" ("nextAttemptAt")
  WHERE "webhookStatus" = 'pending' OR "emailStatus" = 'pending';
CREATE INDEX IF NOT EXISTS "SupportTicketEvent_created_idx" ON public."SupportTicketEvent" ("createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicketEvent_ticket_idx" ON public."SupportTicketEvent" ("ticketId");
ALTER TABLE public."SupportTicketEvent" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."SupportMcpAudit" (
  "id" text PRIMARY KEY,
  "tool" text NOT NULL,
  "ticketId" text NULL,
  "ok" boolean NOT NULL,
  "error" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMcpAudit_len_check" CHECK (
    char_length("tool") <= 80 AND char_length(coalesce("error", '')) <= 300)
);
CREATE INDEX IF NOT EXISTS "SupportMcpAudit_created_idx" ON public."SupportMcpAudit" ("createdAt" DESC);
ALTER TABLE public."SupportMcpAudit" ENABLE ROW LEVEL SECURITY;

COMMIT;
