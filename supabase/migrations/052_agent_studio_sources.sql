-- 052 Agent Studio (F3 "Crear desde fuentes"): the sources an owner gives an agent (text, website, files, photos,
-- Instagram) and the profile drafts Betsy extracts from them for review.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=052 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- No foreign keys (new tables only, no locks on busy tables); tenant isolation is enforced in code.
-- "text" holds the extracted text of the business's OWN material (website, PDFs) — capped; raw files live in
-- private Supabase Storage (agent-sources/<tenant>/<agent>/...). Imported text is data, never instructions.
-- Rollback: deploy previous code; tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."ChatAgentSource" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('text', 'url', 'file', 'image', 'instagram', 'wa_export')),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'fetching', 'parsed', 'failed', 'removed')),
  "label" text NOT NULL CHECK (char_length("label") <= 200),
  "url" text NULL CHECK ("url" IS NULL OR char_length("url") <= 2048),
  "storagePath" text NULL,
  "mimeType" text NULL,
  "sizeBytes" integer NULL,
  "sha256" text NULL,
  "pageCount" integer NULL,
  "text" text NULL CHECK ("text" IS NULL OR char_length("text") <= 120000),
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length("meta"::text) <= 16384),
  "errorCode" text NULL CHECK ("errorCode" IS NULL OR char_length("errorCode") <= 64),
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentSource_agent_sha_key" UNIQUE ("agentId", "sha256")
);
CREATE INDEX IF NOT EXISTS "ChatAgentSource_tenant_agent_created_idx"
  ON public."ChatAgentSource" ("tenantId", "agentId", "createdAt" DESC);
ALTER TABLE public."ChatAgentSource" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."ChatAgentProfileDraft" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'extracting', 'ready', 'applying', 'applied', 'failed', 'cost_capped', 'canceled')),
  "sourceIds" text[] NOT NULL DEFAULT '{}',
  "profile" jsonb NULL CHECK ("profile" IS NULL OR octet_length("profile"::text) <= 600000),
  "applied" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length("applied"::text) <= 16384),
  "model" text NULL,
  "baseAgentVersion" integer NULL,
  "costCapMicros" bigint NOT NULL DEFAULT 0,
  "spentMicros" bigint NOT NULL DEFAULT 0,
  "leaseUntil" timestamp(3) without time zone NULL,
  "errorCode" text NULL,
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" timestamp(3) without time zone NULL,
  "appliedBy" text NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChatAgentProfileDraft_one_active_per_agent"
  ON public."ChatAgentProfileDraft" ("agentId") WHERE "status" IN ('queued', 'extracting', 'applying');
CREATE INDEX IF NOT EXISTS "ChatAgentProfileDraft_tenant_agent_created_idx"
  ON public."ChatAgentProfileDraft" ("tenantId", "agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatAgentProfileDraft_active_idx"
  ON public."ChatAgentProfileDraft" ("status", "leaseUntil") WHERE "status" IN ('queued', 'extracting');
ALTER TABLE public."ChatAgentProfileDraft" ENABLE ROW LEVEL SECURITY;
COMMIT;
