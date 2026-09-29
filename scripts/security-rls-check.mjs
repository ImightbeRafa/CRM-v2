// READ-ONLY security check (2026-09-29): is any public table reachable through Supabase's data
// API (PostgREST) without row-level security? Runs in a READ ONLY transaction; changes nothing.
// Run from the repo root:
//   node --env-file=../CRM-v2/.env.local scripts/security-rls-check.mjs
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
try {
  const out = await p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const tables = await tx.$queryRawUnsafe(`
      SELECT c.relname AS table,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS rls_forced,
             has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
             has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select,
             (SELECT count(*)::int FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      ORDER BY c.relname`)
    const openPolicies = await tx.$queryRawUnsafe(`
      SELECT tablename, policyname, roles::text AS roles, cmd, qual
      FROM pg_policies
      WHERE schemaname IN ('public','storage') AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles) OR 'public' = ANY(roles))
      ORDER BY tablename`)
    const exposed = await tx.$queryRawUnsafe(`SELECT current_setting('pgrst.db_schemas', true) AS api_schemas`)
    return { tables, openPolicies, exposed }
  })
  const exposedTables = out.tables.filter((t) => !t.rls && (t.anon_select || t.authed_select))
  console.log(`public tables: ${out.tables.length}`)
  console.log(`WITHOUT row-level security AND readable by anon/authenticated: ${exposedTables.length}`)
  for (const t of exposedTables) console.log('  EXPOSED ', t.table)
  const protectedCount = out.tables.filter((t) => t.rls).length
  console.log(`with row-level security enabled: ${protectedCount}`)
  console.log(`policies granting anon/authenticated/public: ${out.openPolicies.length}`)
  for (const pol of out.openPolicies) console.log('  POLICY  ', pol.tablename, pol.policyname, pol.roles, pol.cmd)
} catch (e) {
  console.error('check failed:', e?.message || e)
  process.exitCode = 1
} finally {
  await p.$disconnect()
}
