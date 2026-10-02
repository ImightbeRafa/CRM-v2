-- 040 Betsy's own error tracking (replaced Sentry 2026-10-02): one row per distinct error.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=040 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Platform-level table (no tenant data, no foreign keys: no locks on busy tables).
-- Code is fail-safe on a missing table (P2021/42P01). Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."OpsErrorGroup" (
  "id" text PRIMARY KEY,
  "source" text NOT NULL,
  "route" text NULL,
  "name" text NOT NULL,
  "message" text NOT NULL,
  "stack" text NULL,
  "count" integer NOT NULL DEFAULT 0,
  "firstSeen" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastNotifiedAt" timestamp(3) without time zone NULL,
  "status" text NOT NULL DEFAULT 'open',
  "release" text NULL,
  CONSTRAINT "OpsErrorGroup_source_check" CHECK ("source" IN ('server', 'client', 'edge', 'cron', 'ops')),
  CONSTRAINT "OpsErrorGroup_status_check" CHECK ("status" IN ('open', 'muted', 'resolved')),
  CONSTRAINT "OpsErrorGroup_len_check" CHECK (
    char_length("id") <= 80
    AND char_length(coalesce("route", '')) <= 300
    AND char_length("name") <= 120
    AND char_length("message") <= 500
    AND char_length(coalesce("stack", '')) <= 4000
    AND char_length(coalesce("release", '')) <= 80)
);
CREATE INDEX IF NOT EXISTS "OpsErrorGroup_last_seen_idx" ON public."OpsErrorGroup" ("lastSeen" DESC);
ALTER TABLE public."OpsErrorGroup" ENABLE ROW LEVEL SECURITY;
COMMIT;
