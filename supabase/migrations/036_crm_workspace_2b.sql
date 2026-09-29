-- Phase 2b "human workspace" (2026-09-29): snooze / close state per chat, tasks & reminders,
-- in-app notifications (@mentions, task assigned), and per-business chat workspace settings
-- (assignment rules, business hours, auto-close).
--
-- NEW TABLES ONLY. No change to any existing table, no data written. Every table has row-level
-- security ON with no policies (deny-all for Supabase's anon / authenticated roles; the app
-- connects as the owner and is unaffected). The app tolerates these tables being absent
-- (features stay hidden), so apply order vs deploy does not matter here.
--
-- Requires 035 (foreign key to CrmNote): apply 035 first.
--
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Gated: BETSY_V2_APPLY_FILES=036 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
--
-- Apply in a quiet window: creating the tables needs brief catalog locks (lock_timeout 3s aborts safely).
-- Rollback (only if Rafael asks): deploy code first (it tolerates missing tables), take a backup, then
-- remove the four new tables in one transaction, children first: WorkspaceNotification, CrmTask,
-- ChatConversationWorkState, ChatWorkspaceSettings.
-- (No literal destructive SQL in this file: the apply script refuses any file containing it.)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Snooze and close bookkeeping for a conversation (kept off ChatConversation so the hot table and
-- every existing Prisma query stay untouched). One row per conversation, created on first use.
CREATE TABLE IF NOT EXISTS public."ChatConversationWorkState" (
  "conversationId" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "snoozedUntil" timestamp(3) without time zone NULL,
  "snoozedAt" timestamp(3) without time zone NULL,
  "snoozedByUserId" text NULL,
  "closedAt" timestamp(3) without time zone NULL,
  "closedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversationWorkState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversationWorkState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatConversationWorkState_snoozedByUserId_fkey" FOREIGN KEY ("snoozedByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatConversationWorkState_snooze_check" CHECK ("snoozedUntil" IS NULL OR "snoozedAt" IS NOT NULL),
  CONSTRAINT "ChatConversationWorkState_closedBy_check" CHECK ("closedBy" IS NULL OR "closedBy" IN ('human', 'auto'))
);
CREATE INDEX IF NOT EXISTS "ChatConversationWorkState_tenant_snooze_idx" ON public."ChatConversationWorkState" ("tenantId", "snoozedUntil") WHERE "snoozedUntil" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ChatConversationWorkState_tenant_closed_idx" ON public."ChatConversationWorkState" ("tenantId", "closedAt") WHERE "closedAt" IS NOT NULL;
ALTER TABLE public."ChatConversationWorkState" ENABLE ROW LEVEL SECURITY;

-- Tasks, reminders and follow-ups on a chat and/or a client.
CREATE TABLE IF NOT EXISTS public."CrmTask" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "conversationId" text NULL,
  "clientId" text NULL,
  "kind" text NOT NULL DEFAULT 'task',
  "title" text NOT NULL,
  "assigneeUserId" text NULL,
  "createdByUserId" text NULL,
  "dueAt" timestamp(3) without time zone NULL,
  "status" text NOT NULL DEFAULT 'open',
  "completedAt" timestamp(3) without time zone NULL,
  "completedByUserId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmTask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmTask_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmTask_kind_check" CHECK ("kind" IN ('task', 'reminder', 'follow_up')),
  CONSTRAINT "CrmTask_status_check" CHECK ("status" IN ('open', 'done', 'canceled')),
  -- No "chat or client required" CHECK: deleting a chat sets conversationId to NULL and must never
  -- fail on a task (the app always creates tasks with a chat; orphans simply stop showing).
  CONSTRAINT "CrmTask_title_check" CHECK (char_length("title") BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS "CrmTask_tenant_assignee_idx" ON public."CrmTask" ("tenantId", "assigneeUserId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "CrmTask_tenant_conversation_idx" ON public."CrmTask" ("tenantId", "conversationId") WHERE "status" = 'open' AND "conversationId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "CrmTask_tenant_client_idx" ON public."CrmTask" ("tenantId", "clientId") WHERE "status" = 'open' AND "clientId" IS NOT NULL;
ALTER TABLE public."CrmTask" ENABLE ROW LEVEL SECURITY;

-- In-app notifications for one teammate. Never copies note text (a deleted note is wiped, DATA-10):
-- the list joins the source row instead.
CREATE TABLE IF NOT EXISTS public."WorkspaceNotification" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "userId" text NOT NULL,
  "actorUserId" text NULL,
  "kind" text NOT NULL,
  "noteId" text NULL,
  "taskId" text NULL,
  "conversationId" text NULL,
  "clientId" text NULL,
  "dedupeKey" text NOT NULL,
  "readAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceNotification_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceNotification_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES public."CrmNote"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceNotification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES public."CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceNotification_kind_check" CHECK ("kind" IN ('mention', 'task_assigned', 'task_due', 'chat_assigned')),
  CONSTRAINT "WorkspaceNotification_dedupe_check" CHECK (char_length("dedupeKey") BETWEEN 1 AND 200),
  CONSTRAINT "WorkspaceNotification_tenant_user_dedupe_key" UNIQUE ("tenantId", "userId", "dedupeKey")
);
CREATE INDEX IF NOT EXISTS "WorkspaceNotification_tenant_user_time_idx" ON public."WorkspaceNotification" ("tenantId", "userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "WorkspaceNotification_tenant_user_unread_idx" ON public."WorkspaceNotification" ("tenantId", "userId") WHERE "readAt" IS NULL;
ALTER TABLE public."WorkspaceNotification" ENABLE ROW LEVEL SECURITY;

-- One row per business: assignment rules, business hours, auto-close. Everything off by default.
CREATE TABLE IF NOT EXISTS public."ChatWorkspaceSettings" (
  "tenantId" text PRIMARY KEY,
  "assignmentMode" text NOT NULL DEFAULT 'off',
  "assigneeUserIds" text[] NOT NULL DEFAULT '{}',
  "skipAiActive" boolean NOT NULL DEFAULT true,
  "assignmentEnabledAt" timestamp(3) without time zone NULL,
  "rrCursorUserId" text NULL,
  "businessHours" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "timezone" text NOT NULL DEFAULT 'America/Costa_Rica',
  "autoCloseDays" integer NULL,
  "autoCloseStageKey" text NULL,
  "reopenOnInbound" boolean NOT NULL DEFAULT false,
  -- Reopen only applies to customer messages after it was turned on (never the backlog).
  "reopenEnabledAt" timestamp(3) without time zone NULL,
  "version" integer NOT NULL DEFAULT 1,
  "updatedByUserId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatWorkspaceSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatWorkspaceSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatWorkspaceSettings_mode_check" CHECK ("assignmentMode" IN ('off', 'round_robin', 'workload')),
  CONSTRAINT "ChatWorkspaceSettings_assignees_check" CHECK (cardinality("assigneeUserIds") <= 100),
  CONSTRAINT "ChatWorkspaceSettings_hours_size_check" CHECK (octet_length("businessHours"::text) <= 4000),
  CONSTRAINT "ChatWorkspaceSettings_autoclose_check" CHECK ("autoCloseDays" IS NULL OR ("autoCloseDays" BETWEEN 1 AND 365)),
  CONSTRAINT "ChatWorkspaceSettings_stage_check" CHECK ("autoCloseStageKey" IS NULL OR "autoCloseStageKey" ~ '^[a-z0-9_]{1,40}$')
);
ALTER TABLE public."ChatWorkspaceSettings" ENABLE ROW LEVEL SECURITY;

COMMIT;
