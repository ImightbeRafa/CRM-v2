-- Security (2026-09-29): close Supabase data-API (PostgREST) exposure.
-- scripts/security-rls-check.mjs found 7 public tables WITHOUT row-level security that the
-- anon / authenticated roles can SELECT. Anyone holding the project's anon key could read them
-- (TenantInvite holds invite tokens → join a business).
--
-- Enabling RLS with NO policies = deny-all for anon / authenticated. The app is NOT affected: it
-- connects as the table owner through Prisma / postgres, which bypasses RLS (68 other tables
-- already run this way). Data is not touched. Rollback: ALTER TABLE … DISABLE ROW LEVEL SECURITY.
--
-- HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE.
-- Gated: BETSY_V2_APPLY_FILES=033 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'TenantInvite',
    'lm_private_delivery_confirmations',
    'lm_retiro_handoffs',
    'lm_retiro_order_allocations',
    'lm_retiro_product_aliases',
    'lm_retiro_stock',
    'lm_retiro_stock_movements'
  ] LOOP
    -- Some lm_* tables were created outside this repo: skip any that do not exist.
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind IN ('r', 'p')
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
