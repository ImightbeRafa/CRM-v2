-- 044 Platform agent policy: platform-level kill switch (global or per business) for the INBOX Soft agents.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=044 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Platform table: no tenant data, no foreign keys (no locks on busy tables), written only by super admins
-- through /api/super-admin/agent-kill. Tenant admins cannot reach it (RLS on, service role only).
-- Code is fail-safe on a missing table (42P01): the env switch SOFT_AGENT_KILL still works without it.
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."PlatformAgentPolicy" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAgentPolicy_key_check" CHECK (
    "key" = 'agent_kill_global' OR "key" LIKE 'agent_kill_tenant:%'),
  CONSTRAINT "PlatformAgentPolicy_len_check" CHECK (char_length("key") <= 120)
);
ALTER TABLE public."PlatformAgentPolicy" ENABLE ROW LEVEL SECURITY;
COMMIT;
