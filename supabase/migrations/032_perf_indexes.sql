-- Performance indexes for the Aurora release (Pedidos search, Canal column, chat search).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only: no column, table or data change. Gated: BETSY_V2_APPLY_FILES=032,
-- never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate against Supabase.
--
-- Plain CREATE INDEX (not CONCURRENTLY) because the gated apply runs each file in one
-- transaction, same as 025/031. Each build briefly blocks writes on its table, so apply
-- in the madrugada. lock_timeout makes it give up instead of queueing behind traffic.
--
-- Rollback (instant, no data impact):
--   DROP INDEX IF EXISTS "ChatMessage_tenantId_orderId_idx", "Order_customerName_trgm_idx",
--     "Order_orderId_trgm_idx", "Order_phone_trgm_idx", "Order_product_trgm_idx",
--     "ChatConversation_peerName_trgm_idx", "ChatConversation_peerId_trgm_idx",
--     "ChatConversation_lastMessagePreview_trgm_idx";

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;

-- Trigram operator class for ILIKE '%…%' (Prisma `contains` + mode: 'insensitive').
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- GET /api/orders/lines (Pedidos "Canal" column): ChatMessage by tenant + orderId IN (…).
-- Partial: most messages have no order link, so this stays small.
CREATE INDEX IF NOT EXISTS "ChatMessage_tenantId_orderId_idx"
  ON public."ChatMessage" ("tenantId", "orderId")
  WHERE "orderId" IS NOT NULL;

-- /api/orders `search` = OR of four ILIKE '%q%' columns. All four need an index for a
-- BitmapOr plan; with any one missing Postgres falls back to scanning.
CREATE INDEX IF NOT EXISTS "Order_customerName_trgm_idx"
  ON public."Order" USING gin ("customerName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_orderId_trgm_idx"
  ON public."Order" USING gin ("orderId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_phone_trgm_idx"
  ON public."Order" USING gin ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_product_trgm_idx"
  ON public."Order" USING gin ("product" gin_trgm_ops);

-- /api/chat/conversations?q= (chat search, now also used by Ctrl/⌘K search).
CREATE INDEX IF NOT EXISTS "ChatConversation_peerName_trgm_idx"
  ON public."ChatConversation" USING gin ("peerName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ChatConversation_peerId_trgm_idx"
  ON public."ChatConversation" USING gin ("peerId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ChatConversation_lastMessagePreview_trgm_idx"
  ON public."ChatConversation" USING gin ("lastMessagePreview" gin_trgm_ops);

COMMIT;
