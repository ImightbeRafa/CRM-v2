-- Performance indexes for the Aurora release (Pedidos search, Canal column, chat search).
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Additive / expand-only: no column, table or data change. Gated: BETSY_V2_APPLY_FILES=032,
-- never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate against Supabase.
--
-- Plain CREATE INDEX (not CONCURRENTLY): the gated apply sends the file as one simple
-- query, where CONCURRENTLY is not allowed. Each index gets its OWN short transaction, so a
-- table is only write-blocked while that one index builds (locks are released at each
-- COMMIT, not held across all eight). Apply in the madrugada. lock_timeout makes a build
-- give up instead of queueing behind traffic; a failure rolls back only that index and the
-- apply script stops (re-running is safe: IF NOT EXISTS).
--
-- Rollback (instant, no data impact):
--   DROP INDEX IF EXISTS "ChatMessage_tenantId_orderId_idx", "Order_customerName_trgm_idx",
--     "Order_orderId_trgm_idx", "Order_phone_trgm_idx", "Order_product_trgm_idx",
--     "ChatConversation_peerName_trgm_idx", "ChatConversation_peerId_trgm_idx",
--     "ChatConversation_lastMessagePreview_trgm_idx";

-- Trigram operator class for ILIKE '%…%' (Prisma `contains` + mode: 'insensitive').
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
COMMIT;

-- GET /api/orders/lines (Pedidos "Canal" column). Partial: most messages have no order link.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "ChatMessage_tenantId_orderId_idx"
  ON public."ChatMessage" ("tenantId", "orderId")
  WHERE "orderId" IS NOT NULL;
COMMIT;

-- /api/orders `search` = OR of four ILIKE columns; all four need an index for a BitmapOr plan.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "Order_customerName_trgm_idx"
  ON public."Order" USING gin ("customerName" gin_trgm_ops);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "Order_orderId_trgm_idx"
  ON public."Order" USING gin ("orderId" gin_trgm_ops);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "Order_phone_trgm_idx"
  ON public."Order" USING gin ("phone" gin_trgm_ops);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "Order_product_trgm_idx"
  ON public."Order" USING gin ("product" gin_trgm_ops);
COMMIT;

-- /api/chat/conversations?q= (chat search, Ctrl/⌘K).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "ChatConversation_peerName_trgm_idx"
  ON public."ChatConversation" USING gin ("peerName" gin_trgm_ops);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "ChatConversation_peerId_trgm_idx"
  ON public."ChatConversation" USING gin ("peerId" gin_trgm_ops);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Supabase installs extensions in schema "extensions"; keep it on the path for gin_trgm_ops.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS "ChatConversation_lastMessagePreview_trgm_idx"
  ON public."ChatConversation" USING gin ("lastMessagePreview" gin_trgm_ops);
COMMIT;
