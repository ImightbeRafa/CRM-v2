/**
 * Every table created by a migration from 033 on must enable row-level security in the same
 * file (Supabase's data API would otherwise expose it to the anon key). 2026-09-29.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

test('migrations ≥ 033 enable RLS on every table they create', () => {
  const dir = 'supabase/migrations'
  for (const file of readdirSync(dir)) {
    const n = parseInt(file, 10)
    if (!(n >= 33)) continue
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+public\."?([A-Za-z_]+)"?/g)].map((m) => m[1])
    for (const table of created) {
      const rls = new RegExp(`ALTER TABLE\s+public\."?${table}"?\s+ENABLE ROW LEVEL SECURITY`)
      assert.match(sql, rls, `${file}: ${table} is created without ENABLE ROW LEVEL SECURITY`)
    }
  }
})

test('033 locks down the 7 tables found exposed', () => {
  const sql = readFileSync('supabase/migrations/033_security_rls_lockdown.sql', 'utf8')
  for (const t of ['TenantInvite', 'lm_retiro_stock', 'lm_private_delivery_confirmations']) assert.match(sql, new RegExp(`'${t}'`))
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(sql, /CREATE POLICY/)
})
