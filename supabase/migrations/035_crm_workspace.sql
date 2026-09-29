-- Phase 2a "human workspace" (2026-09-29): configurable stages / tags, client lifecycle stage,
-- notes (client + conversation), and an activity log of human actions.
--
-- NEW TABLES ONLY. No ALTER on existing tables, no ALTER TYPE, no data written. Every table has
-- row-level security ON with no policies (deny-all for Supabase's anon / authenticated roles; the
-- app connects as the owner and is unaffected). The app code tolerates these tables being absent
-- (features stay hidden), so apply order vs deploy does not matter here.
--
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Gated: BETSY_V2_APPLY_FILES=035 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Stages for two pipelines: 'chat' (conversation status keys) and 'client' (lifecycle).
-- Defaults live in code; rows exist only once a business customizes its list.
CREATE TABLE IF NOT EXISTS public."CrmStage" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "pipeline" text NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "color" text NULL,
  "position" integer NOT NULL DEFAULT 0,
  "category" text NOT NULL DEFAULT 'open',
  "targetMinutes" integer NULL,
  "entryRules" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "rulesVersion" integer NOT NULL DEFAULT 1,
  "isSystem" boolean NOT NULL DEFAULT false,
  "archivedAt" timestamp(3) without time zone NULL,
  "createdByUserId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmStage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmStage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmStage_pipeline_check" CHECK ("pipeline" IN ('chat', 'client')),
  CONSTRAINT "CrmStage_key_check" CHECK ("key" ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT "CrmStage_label_check" CHECK (char_length("label") BETWEEN 1 AND 40),
  CONSTRAINT "CrmStage_category_check" CHECK ("category" IN ('open', 'won', 'lost')),
  CONSTRAINT "CrmStage_target_check" CHECK ("targetMinutes" IS NULL OR "targetMinutes" > 0),
  CONSTRAINT "CrmStage_tenant_pipeline_key_key" UNIQUE ("tenantId", "pipeline", "key")
);
CREATE INDEX IF NOT EXISTS "CrmStage_tenant_pipeline_position_idx" ON public."CrmStage" ("tenantId", "pipeline", "position");
ALTER TABLE public."CrmStage" ENABLE ROW LEVEL SECURITY;

-- Conversation tags catalog (ChatConversation.tags keeps storing the keys).
CREATE TABLE IF NOT EXISTS public."CrmTag" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "color" text NULL,
  "position" integer NOT NULL DEFAULT 0,
  "isSystem" boolean NOT NULL DEFAULT false,
  "archivedAt" timestamp(3) without time zone NULL,
  "createdByUserId" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmTag_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmTag_key_check" CHECK (char_length("key") BETWEEN 1 AND 40),
  CONSTRAINT "CrmTag_label_check" CHECK (char_length("label") BETWEEN 1 AND 40),
  CONSTRAINT "CrmTag_tenant_key_key" UNIQUE ("tenantId", "key")
);
ALTER TABLE public."CrmTag" ENABLE ROW LEVEL SECURITY;

-- Current lifecycle stage per client (computed lazily from orders; manual override possible).
CREATE TABLE IF NOT EXISTS public."ClientLifecycleState" (
  "clientId" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "stageKey" text NOT NULL,
  "source" text NOT NULL DEFAULT 'auto',
  "fingerprint" text NULL,
  "rulesVersion" integer NOT NULL DEFAULT 1,
  "evidenceAt" timestamp(3) without time zone NULL,
  "enteredAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "computedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "setByUserId" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientLifecycleState_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientLifecycleState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientLifecycleState_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ClientLifecycleState_source_check" CHECK ("source" IN ('auto', 'manual', 'backfill'))
);
CREATE INDEX IF NOT EXISTS "ClientLifecycleState_tenant_stage_idx" ON public."ClientLifecycleState" ("tenantId", "stageKey", "enteredAt" DESC);
ALTER TABLE public."ClientLifecycleState" ENABLE ROW LEVEL SECURITY;

-- Notes: belong to a client and/or the conversation they were written in (visible from both).
CREATE TABLE IF NOT EXISTS public."CrmNote" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "clientId" text NULL,
  "conversationId" text NULL,
  "kind" text NOT NULL DEFAULT 'note',
  "body" text NOT NULL,
  "authorUserId" text NULL,
  "mentionUserIds" text[] NOT NULL DEFAULT '{}',
  "pinnedAt" timestamp(3) without time zone NULL,
  "pinnedByUserId" text NULL,
  "editedAt" timestamp(3) without time zone NULL,
  "deletedAt" timestamp(3) without time zone NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmNote_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CrmNote_kind_check" CHECK ("kind" IN ('note', 'thread')),
  CONSTRAINT "CrmNote_body_check" CHECK (char_length("body") BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS "CrmNote_tenant_client_idx" ON public."CrmNote" ("tenantId", "clientId", "createdAt" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "CrmNote_tenant_conversation_idx" ON public."CrmNote" ("tenantId", "conversationId", "createdAt" DESC) WHERE "deletedAt" IS NULL;
ALTER TABLE public."CrmNote" ENABLE ROW LEVEL SECURITY;

-- Human action log (foundation for the usage dashboard / flow mining). Ids only, no message
-- bodies or phone numbers. No FKs on entity columns: the log survives deletes.
CREATE TABLE IF NOT EXISTS public."ActivityEvent" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "actorUserId" text NULL,
  "actorKind" text NOT NULL DEFAULT 'human',
  "verb" text NOT NULL,
  "entityType" text NULL,
  "entityId" text NULL,
  "conversationId" text NULL,
  "clientId" text NULL,
  "orderId" text NULL,
  "surface" text NULL,
  "clientSessionId" text NULL,
  "props" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupeKey" text NULL,
  "occurredAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActivityEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ActivityEvent_actorKind_check" CHECK ("actorKind" IN ('human', 'system', 'agent')),
  CONSTRAINT "ActivityEvent_verb_check" CHECK ("verb" ~ '^[a-z0-9_.]{3,64}$'),
  CONSTRAINT "ActivityEvent_props_size_check" CHECK (octet_length("props"::text) <= 4000)
);
CREATE INDEX IF NOT EXISTS "ActivityEvent_tenant_time_idx" ON public."ActivityEvent" ("tenantId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ActivityEvent_tenant_actor_idx" ON public."ActivityEvent" ("tenantId", "actorUserId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ActivityEvent_tenant_entity_idx" ON public."ActivityEvent" ("tenantId", "entityType", "entityId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ActivityEvent_tenant_conversation_idx" ON public."ActivityEvent" ("tenantId", "conversationId", "occurredAt" DESC) WHERE "conversationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityEvent_tenant_dedupe_uidx" ON public."ActivityEvent" ("tenantId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL;
ALTER TABLE public."ActivityEvent" ENABLE ROW LEVEL SECURITY;

COMMIT;
