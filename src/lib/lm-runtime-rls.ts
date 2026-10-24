import { prisma } from '@/lib/db'

/**
 * Some lm_* logistics tables are created by the app at runtime (CREATE TABLE IF NOT EXISTS) rather than by a
 * migration. A table created that way had no row-level security, so Supabase's data API exposed it to the
 * anon key (Supabase advisor "RLS Disabled in Public", 2026-10-23). Migration 033 locked down what existed then.
 *
 * Turns RLS on only when it is off: ALTER TABLE takes an ACCESS EXCLUSIVE lock even when RLS is already
 * enabled, so it must never run unconditionally on a live table. No policies are added (the app's own role
 * owns the tables and bypasses RLS; anon / authenticated get nothing), and no FORCE.
 */
const TABLE_NAME = /^lm_[a-z0-9_]{1,60}$/

export function rlsGuardSql(table: string): string {
  if (!TABLE_NAME.test(table)) throw new Error(`rlsGuardSql: unexpected table name ${table}`)
  // Looked up by name (a '…'::regclass literal would fail at parse time when the table is missing).
  return `DO $$
DECLARE rls boolean;
BEGIN
  SELECT c.relrowsecurity INTO rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = '${table}' AND c.relkind = 'r';
  IF rls IS FALSE THEN
    EXECUTE 'ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY';
  END IF;
END $$`
}

export async function ensureRlsEnabled(tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    await prisma.$executeRawUnsafe(rlsGuardSql(table))
  }
}
