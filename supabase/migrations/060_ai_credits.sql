-- 060 AI credits: what each business pays for AI, its prepaid balance and its own monthly limit (Lane H).
-- Additive only. Gated: BETSY_V2_APPLY_FILES=060 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Code works before this is applied: usage pages say "not ready" and nothing is ever paused by credits.
--
-- Money is integer USD micros (1 USD = 1,000,000) BEFORE IVA ("billed micros" = model list cost × markup).
-- IVA is added once, on the Tilopay charge when a business buys a credit pack.
--   AiBillingRate      one row per month a price starts (rewritten only by the owner); the row with the greatest periodKey <= a month prices that month,
--                      so a markup change never reprices a month that already started (owner writes next month).
--   AiBillingSettings  one row ('default'): credit packs, the owner's ceiling for business limits, enforcement switch.
--   AiCreditLedger     signed balance movements: purchase (+), refund (−), adjustment (±), usage_settle (− a closed month's
--                      billed usage above the free credit). "sourceKey" UNIQUE = every movement is written once.
--                      Usage of the current month is never stored here: it is read from AiUsageEvent (SQL 048).
--   AiCreditPurchase   a pack checkout: server-priced, random "ref" sent to Tilopay, paid only by the webhook.
--   AiTenantSpendLimit the business's own monthly AI limit (billed micros), clamped to the owner's ceiling.
-- No foreign keys (same as 048/051). RLS on; only the server (service role) reads or writes.
-- Rollback: deploy previous code; the tables can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public."AiBillingRate" (
  "periodKey" text PRIMARY KEY,
  "markupBps" integer NOT NULL,
  "freeMonthlyMicros" bigint NOT NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiBillingRate_period_check" CHECK ("periodKey" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "AiBillingRate_markup_check" CHECK ("markupBps" BETWEEN 10000 AND 100000),
  CONSTRAINT "AiBillingRate_free_check" CHECK ("freeMonthlyMicros" BETWEEN 0 AND 1000000000)
);
ALTER TABLE public."AiBillingRate" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."AiBillingSettings" (
  "id" text PRIMARY KEY,
  "packs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "ceilingMicros" bigint NULL,
  "enforce" boolean NOT NULL DEFAULT false,
  "cutoverPeriod" text NULL,
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiBillingSettings_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "AiBillingSettings_ceiling_check" CHECK ("ceilingMicros" IS NULL OR "ceilingMicros" > 0),
  CONSTRAINT "AiBillingSettings_cutover_check" CHECK ("cutoverPeriod" IS NULL OR "cutoverPeriod" ~ '^[0-9]{4}-[0-9]{2}$')
);
ALTER TABLE public."AiBillingSettings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."AiCreditLedger" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "kind" text NOT NULL,
  "amountMicros" bigint NOT NULL,
  "periodKey" text NULL,
  "sourceKey" text NOT NULL,
  "note" text NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCreditLedger_sourceKey_key" UNIQUE ("sourceKey"),
  CONSTRAINT "AiCreditLedger_kind_check" CHECK ("kind" IN ('purchase', 'refund', 'adjustment', 'usage_settle')),
  CONSTRAINT "AiCreditLedger_note_check" CHECK ("note" IS NULL OR char_length("note") <= 200)
);
CREATE INDEX IF NOT EXISTS "AiCreditLedger_tenant_created_idx" ON public."AiCreditLedger" ("tenantId", "createdAt" DESC);
ALTER TABLE public."AiCreditLedger" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."AiCreditPurchase" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "packId" text NOT NULL,
  "creditMicros" bigint NOT NULL CHECK ("creditMicros" > 0),
  "priceCents" integer NOT NULL CHECK ("priceCents" > 0),
  "ivaCents" integer NOT NULL CHECK ("ivaCents" >= 0),
  "totalCents" integer NOT NULL CHECK ("totalCents" > 0),
  "currency" text NOT NULL DEFAULT 'USD',
  "status" text NOT NULL DEFAULT 'pending',
  "ref" text NOT NULL,
  "transactionId" text NULL,
  "createdBy" text NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" timestamp(3) without time zone NULL,
  "lastEvent" text NULL,
  CONSTRAINT "AiCreditPurchase_ref_key" UNIQUE ("ref"),
  CONSTRAINT "AiCreditPurchase_transaction_key" UNIQUE ("transactionId"),
  CONSTRAINT "AiCreditPurchase_status_check" CHECK ("status" IN ('pending', 'paid', 'failed', 'refunded')),
  CONSTRAINT "AiCreditPurchase_currency_check" CHECK ("currency" = 'USD')
);
CREATE INDEX IF NOT EXISTS "AiCreditPurchase_tenant_created_idx" ON public."AiCreditPurchase" ("tenantId", "createdAt" DESC);
ALTER TABLE public."AiCreditPurchase" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."AiTenantSpendLimit" (
  "tenantId" text PRIMARY KEY,
  "monthlyLimitMicros" bigint NOT NULL CHECK ("monthlyLimitMicros" > 0),
  "updatedBy" text NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public."AiTenantSpendLimit" ENABLE ROW LEVEL SECURITY;

COMMIT;
