-- Soft Agent Layer Arc 2 A1 — brand facts, shortcuts, assets (schema), Probar columns.
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only. Depends on 027 + 027b + 028 (ChatAgentSuggestion).
-- Gated like 027/028: registered in the manifest but NOT in DEFAULT_APPLY_FILES.
-- Apply only via BETSY_V2_APPLY_FILES=029 after human review + Blob backup.
-- DO NOT run prisma db push / migrate against Supabase.
-- Phase D columns (activeHours, replyDelay) are schema-only here. No horario runtime.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Inventory composite FK target for ChatAgentAsset (id is already PK; this supports (tenantId, id)).
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_tenantId_id_uidx"
  ON public."InventoryItem"("tenantId", "id");

ALTER TABLE public."ChatAgent"
  ADD COLUMN IF NOT EXISTS "brandFacts" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "replyStyle" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "activeHours" jsonb NULL,
  ADD COLUMN IF NOT EXISTS "replyDelay" jsonb NULL;

DO $$ BEGIN
  ALTER TABLE public."ChatAgent"
    ADD CONSTRAINT "ChatAgent_brandFacts_size_check"
    CHECK (octet_length("brandFacts"::text) <= 8000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."ChatAgent"
    ADD CONSTRAINT "ChatAgent_replyStyle_size_check"
    CHECK (octet_length("replyStyle"::text) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."ChatAgent"
    ADD CONSTRAINT "ChatAgent_activeHours_size_check"
    CHECK ("activeHours" IS NULL OR octet_length("activeHours"::text) <= 4000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."ChatAgent"
    ADD CONSTRAINT "ChatAgent_replyDelay_size_check"
    CHECK ("replyDelay" IS NULL OR octet_length("replyDelay"::text) <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public."ChatAgent"."brandFacts" IS
  'AL2-A1 structured brand facts (schemaVersion 1). Empty until configured.';
COMMENT ON COLUMN public."ChatAgent"."activeHours" IS
  'Phase D schema-only. Not read by AL2-A1 runtime.';
COMMENT ON COLUMN public."ChatAgent"."replyDelay" IS
  'Phase D schema-only. Not read by AL2-A1 runtime.';

-- ---------------------------------------------------------------------------
-- ChatAgentShortcut
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentShortcut" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "agentId" text NOT NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "intents" text[] NOT NULL DEFAULT '{}',
  "keywords" text[] NOT NULL DEFAULT '{}',
  "body" text NOT NULL,
  "deliveryMode" text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "createdBy" text NULL,
  "updatedBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentShortcut_tenantId_id_key" UNIQUE ("tenantId", "id"),
  CONSTRAINT "ChatAgentShortcut_agentId_key_key" UNIQUE ("agentId", "key"),
  CONSTRAINT "ChatAgentShortcut_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentShortcut_tenantId_agentId_fkey"
    FOREIGN KEY ("tenantId", "agentId")
    REFERENCES public."ChatAgent"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentShortcut_title_check"
    CHECK (char_length("title") BETWEEN 1 AND 60),
  CONSTRAINT "ChatAgentShortcut_body_check"
    CHECK (char_length("body") BETWEEN 1 AND 1500),
  CONSTRAINT "ChatAgentShortcut_keywords_check"
    CHECK (cardinality("keywords") <= 20),
  CONSTRAINT "ChatAgentShortcut_kind_check"
    CHECK ("kind" IN (
      'playbook', 'handoff', 'purchase_summary', 'payment_info',
      'payment_ack', 'payment_rejected', 'order_confirmed', 'out_of_hours'
    )),
  CONSTRAINT "ChatAgentShortcut_deliveryMode_check"
    CHECK ("deliveryMode" IN ('verbatim', 'guide')),
  CONSTRAINT "ChatAgentShortcut_verbatim_kinds_check"
    CHECK (
      "kind" NOT IN ('handoff', 'payment_ack', 'payment_rejected', 'order_confirmed', 'out_of_hours')
      OR "deliveryMode" = 'verbatim'
    ),
  CONSTRAINT "ChatAgentShortcut_intents_check"
    CHECK (
      "intents" <@ ARRAY[
        'greeting', 'price', 'stock', 'catalog_photo', 'how_to_buy', 'shipping_info',
        'payment_info', 'payment_proof', 'order_status', 'hours_location', 'website',
        'returns_policy', 'offtopic', 'human_request', 'other'
      ]::text[]
    )
);

CREATE INDEX IF NOT EXISTS "ChatAgentShortcut_tenantId_agentId_isActive_idx"
  ON public."ChatAgentShortcut"("tenantId", "agentId", "isActive");

-- ---------------------------------------------------------------------------
-- ChatAgentAsset (schema now, used in A2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentAsset" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "caption" text NULL,
  "blobPath" text NOT NULL,
  "publicUrl" text NOT NULL,
  "mimeType" text NOT NULL,
  "sizeBytes" integer NOT NULL,
  "width" integer NULL,
  "height" integer NULL,
  "sha256" text NOT NULL,
  "inventoryItemId" text NULL,
  "status" text NOT NULL DEFAULT 'active',
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentAsset_tenantId_id_key" UNIQUE ("tenantId", "id"),
  CONSTRAINT "ChatAgentAsset_tenantId_sha256_key" UNIQUE ("tenantId", "sha256"),
  CONSTRAINT "ChatAgentAsset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentAsset_tenantId_inventoryItemId_fkey"
    FOREIGN KEY ("tenantId", "inventoryItemId")
    REFERENCES public."InventoryItem"("tenantId", "id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentAsset_kind_check"
    CHECK ("kind" IN ('product', 'catalog', 'location', 'payment_methods', 'other')),
  CONSTRAINT "ChatAgentAsset_mime_check"
    CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ChatAgentAsset_status_check"
    CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "ChatAgentAsset_name_check"
    CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "ChatAgentAsset_caption_check"
    CHECK ("caption" IS NULL OR char_length("caption") <= 300),
  CONSTRAINT "ChatAgentAsset_size_check"
    CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880)
);

CREATE INDEX IF NOT EXISTS "ChatAgentAsset_tenantId_status_idx"
  ON public."ChatAgentAsset"("tenantId", "status");

-- ---------------------------------------------------------------------------
-- ChatAgentShortcutAsset (ordered join, ≤ 3 images; unused until A2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ChatAgentShortcutAsset" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "shortcutId" text NOT NULL,
  "assetId" text NOT NULL,
  "position" integer NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAgentShortcutAsset_shortcut_position_key" UNIQUE ("shortcutId", "position"),
  CONSTRAINT "ChatAgentShortcutAsset_shortcut_asset_key" UNIQUE ("shortcutId", "assetId"),
  CONSTRAINT "ChatAgentShortcutAsset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentShortcutAsset_tenantId_shortcutId_fkey"
    FOREIGN KEY ("tenantId", "shortcutId")
    REFERENCES public."ChatAgentShortcut"("tenantId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentShortcutAsset_tenantId_assetId_fkey"
    FOREIGN KEY ("tenantId", "assetId")
    REFERENCES public."ChatAgentAsset"("tenantId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ChatAgentShortcutAsset_position_check"
    CHECK ("position" >= 0 AND "position" <= 2)
);

-- ---------------------------------------------------------------------------
-- ChatAgentTurn — Probar isolation + traces
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatAgentTurn"
  ADD COLUMN IF NOT EXISTS "outputManifest" jsonb NULL,
  ADD COLUMN IF NOT EXISTS "decisionTrace" jsonb NULL,
  ADD COLUMN IF NOT EXISTS "shortcutKey" text NULL,
  ADD COLUMN IF NOT EXISTS "intent" text NULL,
  ADD COLUMN IF NOT EXISTS "testSessionId" text NULL;

ALTER TABLE public."ChatAgentTurn"
  ALTER COLUMN "conversationId" DROP NOT NULL;

ALTER TABLE public."ChatAgentTurn"
  DROP CONSTRAINT IF EXISTS "ChatAgentTurn_status_check";

ALTER TABLE public."ChatAgentTurn"
  ADD CONSTRAINT "ChatAgentTurn_status_check"
  CHECK ("status" IN (
    'generated', 'delivered', 'suggested', 'test', 'fallback',
    'budget_blocked', 'window_closed', 'failed', 'skipped',
    'partially_delivered'
  ));

ALTER TABLE public."ChatAgentTurn"
  DROP CONSTRAINT IF EXISTS "ChatAgentTurn_conversation_required_check";

ALTER TABLE public."ChatAgentTurn"
  ADD CONSTRAINT "ChatAgentTurn_conversation_required_check"
  CHECK ("mode" = 'test' OR "conversationId" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "ChatAgentTurn_tenantId_testSessionId_idx"
  ON public."ChatAgentTurn"("tenantId", "testSessionId")
  WHERE "testSessionId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ChatAgentSuggestion.attachments (A2 payload; column now)
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatAgentSuggestion"
  ADD COLUMN IF NOT EXISTS "attachments" jsonb NULL;

-- ---------------------------------------------------------------------------
-- RLS + service_role_bypass
-- ---------------------------------------------------------------------------
ALTER TABLE public."ChatAgentShortcut" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatAgentShortcutAsset" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentShortcut"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentAsset"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service_role_bypass" ON public."ChatAgentShortcutAsset"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
