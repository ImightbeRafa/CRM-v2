-- 062 Short order numbers (wave 2026-10-22, lane J): a per-business sequential number (#1042) that people read
-- and say on the phone. The long "Order"."orderId" ("ORDER-1792711884367") stays the internal/external id
-- (URLs, guías, Correos, lm_orders.crm_order_id, exports, integrations, staff bot) and is not touched.
-- Additive only. Gated: BETSY_V2_APPLY_FILES=062 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
-- Apply in a quiet window: ADD COLUMN takes an ACCESS EXCLUSIVE lock on "Order" (blocks reads AND writes) until
-- COMMIT, which includes the unique index build (~4k rows on prod 2026-10-22: well under a second). lock_timeout 3s
-- aborts instead of queueing behind long transactions. The CHECK is NOT VALID on purpose (every value is NULL; new
-- rows are still checked), so there is no extra table scan.
-- ORDER: code first or SQL first, either works. "orderNo" is deliberately NOT in schema.prisma: Prisma never
-- names it, and the app reads it with raw SQL (src/lib/orders/order-number-server.ts; 42703 → long id).
-- After applying: run scripts/order-number-backfill.ts (dry-run first, then --apply with Rafael's GO), then take a
-- backup (the backfill does not bump updatedAt). After a restore from backup, re-apply this file (idempotent) if the
-- trigger is missing; the self-healing counter catches up by itself.
--
--   "Order"."orderNo"            integer NULL; unique per tenant when set (partial unique index)
--   "OrderNumberCounter"         one row per tenant: the last number handed out (RLS on, no policies; app role owns it)
--   trigger "Order_orderNo_trg"  BEFORE INSERT: numbers every new order, whatever path creates it (Ventas, website,
--                                staff bot, Excel, lifecycle), so no app code has to remember it.
--
-- Atomicity: the counter row is updated (row-locked until the inserting transaction ends), so two concurrent
-- orders of the same business never get the same number; the unique index is the backstop. Under SERIALIZABLE
-- (order lifecycle v2) the second concurrent create gets 40001 → Prisma P2034 → withSerializationRetry retries.
-- A rolled-back insert leaves a gap; numbers are never reused.
-- Self-healing: the next number is GREATEST(counter, max orderNo) + 1, so a counter that fell behind (restore,
-- manual insert) can never hand out a duplicate and block order creation.
-- First order of a business after this file: the counter starts at GREATEST(rows, max orderNo) + 1, so 1..N stay
-- free for the N existing orders, which the backfill numbers in creation order ("timestamp", id).
--
-- Rollback (no data loss): deploy previous code (it never reads orderNo) and
--   ALTER TABLE public."Order" DISABLE TRIGGER "Order_orderNo_trg";
-- The column, index and counter table can stay (ignored).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "orderNo" integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_orderNo_positive_check') THEN
    ALTER TABLE public."Order"
      ADD CONSTRAINT "Order_orderNo_positive_check" CHECK ("orderNo" IS NULL OR "orderNo" > 0) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_tenantId_orderNo_key"
  ON public."Order"("tenantId", "orderNo")
  WHERE "orderNo" IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."OrderNumberCounter" (
  "tenantId" text PRIMARY KEY,
  "lastNo" integer NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderNumberCounter_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderNumberCounter_lastNo_check" CHECK ("lastNo" >= 0)
);
ALTER TABLE public."OrderNumberCounter" ENABLE ROW LEVEL SECURITY;

-- SECURITY INVOKER (default): runs as the role inserting the order (the app role owns both tables).
CREATE OR REPLACE FUNCTION public."Order_assign_orderNo"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW."orderNo" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Usual case: one row-locking UPDATE (the max() is one backward probe on the partial unique index).
  UPDATE public."OrderNumberCounter" AS c
     SET "lastNo" = GREATEST(
           c."lastNo",
           COALESCE((SELECT max(o."orderNo") FROM public."Order" o WHERE o."tenantId" = NEW."tenantId"), 0)
         ) + 1,
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE c."tenantId" = NEW."tenantId"
  RETURNING c."lastNo" INTO NEW."orderNo";

  IF NOT FOUND THEN
    -- First order of this business since 062: start after its existing orders (they keep 1..N for the backfill).
    INSERT INTO public."OrderNumberCounter" AS c ("tenantId", "lastNo", "updatedAt")
    VALUES (
      NEW."tenantId",
      GREATEST(
        (SELECT count(*) FROM public."Order" o WHERE o."tenantId" = NEW."tenantId"),
        COALESCE((SELECT max(o."orderNo") FROM public."Order" o WHERE o."tenantId" = NEW."tenantId"), 0)
      ) + 1,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tenantId") DO UPDATE
      SET "lastNo" = GREATEST(
            c."lastNo",
            COALESCE((SELECT max(o."orderNo") FROM public."Order" o WHERE o."tenantId" = NEW."tenantId"), 0)
          ) + 1,
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING c."lastNo" INTO NEW."orderNo";
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER "Order_orderNo_trg"
  BEFORE INSERT ON public."Order"
  FOR EACH ROW
  EXECUTE FUNCTION public."Order_assign_orderNo"();

COMMIT;
