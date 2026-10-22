-- 061 AI provider status (wave 2026-10-22, lane D): one row per AI provider, so "OpenAI sin crédito / caído" is
-- alerted to the platform owner ONCE per incident across every container, and a "volvió" alert goes out when it
-- recovers. Written by src/lib/soft-ai/provider-outage.ts only (server code; no tenant data, no customer text).
-- Additive only. Gated: BETSY_V2_APPLY_FILES=061 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Code works without it (per-process dedupe only).
--   provider    'openai'
--   downSince   first failure of the current incident (NULL = healthy)
--   lastKind    quota | rate_limit | auth | server | not_configured
--   alertedAt   when the owner was told about the current incident (claimed atomically: one alert per incident)
--   recoveredAt last recovery
-- Rollback: deploy previous code; the table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."AiProviderStatus" (
  "provider" text PRIMARY KEY,
  "downSince" timestamp(3) without time zone NULL,
  "lastKind" text NULL,
  "alertedAt" timestamp(3) without time zone NULL,
  "recoveredAt" timestamp(3) without time zone NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProviderStatus_provider_check" CHECK (char_length("provider") BETWEEN 1 AND 40),
  CONSTRAINT "AiProviderStatus_kind_check" CHECK ("lastKind" IS NULL OR char_length("lastKind") <= 40)
);
ALTER TABLE public."AiProviderStatus" ENABLE ROW LEVEL SECURITY;
COMMIT;
