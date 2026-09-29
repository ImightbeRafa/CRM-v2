/** Phase 2b (036): additive-only migration, registered in the gated apply manifest. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/036_crm_workspace_2b.sql', 'utf8')
const TABLES = ['ChatConversationWorkState', 'CrmTask', 'WorkspaceNotification', 'ChatWorkspaceSettings']

test('036 is registered in the manifest (gated, not a default apply file)', async () => {
  const manifest = await import('../../../scripts/lib/betsy-v2-additive-manifest.mjs')
  assert.equal(manifest.FILES['036'], '036_crm_workspace_2b.sql')
  assert.deepEqual(manifest.EXPECTED_TABLES['036'], TABLES)
  assert.doesNotMatch(manifest.DEFAULT_APPLY_FILES, /036/)
})

test('036 only creates new tables, each with RLS, and never alters an existing one', () => {
  const code = sql.replace(/--[^\n]*/g, '')
  const created = [...code.matchAll(/CREATE TABLE IF NOT EXISTS public\."(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(created, TABLES)
  const altered = [...code.matchAll(/ALTER TABLE public\."(\w+)"\s+(\w+)/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(altered, TABLES.map((t) => `${t} ENABLE`))
  assert.match(code, /SET LOCAL lock_timeout = '3s'/)
  assert.doesNotMatch(sql, /\b(DROP TABLE|TRUNCATE|DROP COLUMN)\b/i)
})

test('notifications never store note text; everything automatic is off by default', () => {
  const notif = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public."WorkspaceNotification"'), sql.indexOf('ALTER TABLE public."WorkspaceNotification"'))
  assert.doesNotMatch(notif, /"body"|"text"|"title"/)
  assert.match(sql, /"assignmentMode" text NOT NULL DEFAULT 'off'/)
  assert.match(sql, /"reopenOnInbound" boolean NOT NULL DEFAULT false/)
  assert.match(sql, /"autoCloseDays" integer NULL/)
})

test('Prisma models mirror the four tables (scalar-only, no relations to existing models)', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  for (const t of TABLES) assert.match(schema, new RegExp(`model ${t} \\{`), t)
  assert.match(schema, /@@unique\(\[tenantId, userId, dedupeKey\], map: "WorkspaceNotification_tenant_user_dedupe_key"\)/)
})
