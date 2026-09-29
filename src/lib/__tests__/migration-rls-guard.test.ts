/**
 * Every table created by a migration from 033 on must enable row-level security in the same
 * file (Supabase's data API would otherwise expose it to the anon key). 2026-09-29.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

/** SQL without comments: a word in a comment must neither create a phantom table nor satisfy RLS. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

test('migrations ≥ 033 enable RLS on every table they create', () => {
  const dir = 'supabase/migrations'
  for (const file of readdirSync(dir)) {
    const n = parseInt(file, 10)
    if (!(n >= 33)) continue
    const sql = stripSqlComments(readFileSync(`${dir}/${file}`, 'utf8'))
    // `IF NOT EXISTS` optional: a plain CREATE TABLE must not skip the guard.
    const created = [...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map((m) => m[1])
    for (const table of created) {
      // String.raw: in a plain template literal `\s` would silently become `s`.
      const rls = new RegExp(String.raw`ALTER TABLE\s+(?:public\.)?"?${table}"?\s+ENABLE ROW LEVEL SECURITY`, 'i')
      assert.match(sql, rls, `${file}: ${table} is created without ENABLE ROW LEVEL SECURITY`)
    }
  }
})

test('the guard itself catches a table without RLS and accepts one with it', () => {
  const check = (raw: string) => {
    const sql = stripSqlComments(raw)
    const created = [...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map((m) => m[1])
    return created.every((t) => new RegExp(String.raw`ALTER TABLE\s+(?:public\.)?"?${t}"?\s+ENABLE ROW LEVEL SECURITY`, 'i').test(sql))
  }
  assert.equal(check('CREATE TABLE public."CrmNote" (id text);\nALTER TABLE public."CrmNote" ENABLE ROW LEVEL SECURITY;'), true)
  assert.equal(check('CREATE TABLE IF NOT EXISTS public."A" (id text);\nALTER TABLE public."A"\n  ENABLE ROW LEVEL SECURITY;'), true)
  assert.equal(check('CREATE TABLE public."Leaky" (id text);'), false)
  assert.equal(check('CREATE TABLE "Leaky2" (id text);'), false)
  // Comments: no phantom table, and an RLS line that is only commented out does not count.
  assert.equal(check('-- CREATE TABLE takes brief locks\nSELECT 1;'), true)
  assert.equal(check('CREATE TABLE public."B" (id text);\n-- ALTER TABLE public."B" ENABLE ROW LEVEL SECURITY;'), false)
  assert.equal(check('CREATE TABLE public."C" (id text);\n/* ALTER TABLE public."C" ENABLE ROW LEVEL SECURITY; */'), false)
})

test('033 locks down the 7 tables found exposed', () => {
  const sql = readFileSync('supabase/migrations/033_security_rls_lockdown.sql', 'utf8')
  for (const t of ['TenantInvite', 'lm_retiro_stock', 'lm_private_delivery_confirmations']) assert.match(sql, new RegExp(`'${t}'`))
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(sql, /CREATE POLICY/)
})
