/** Session revocation wiring + 034 migration shape (security, 2026-09-28). No DB. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sessionMatches } from '../session-revocation'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('a token without sv equals version 0 (the column default): the deploy logs nobody out', () => {
  assert.equal(sessionMatches({ active: true, sessionVersion: 0 }, undefined), true)
  assert.equal(sessionMatches({ active: true, sessionVersion: 0 }, null), true)
  assert.equal(sessionMatches({ active: true, sessionVersion: 0 }, 0), true)
})

test('a bumped version (password reset) or a deactivation ends the session', () => {
  assert.equal(sessionMatches({ active: true, sessionVersion: 1 }, 0), false)
  assert.equal(sessionMatches({ active: true, sessionVersion: 2 }, 2), true)
  assert.equal(sessionMatches({ active: false, sessionVersion: 0 }, 0), false)
  assert.equal(sessionMatches(null, 0), false, 'deleted user')
})

test('pre-034: missing column falls back to version 0, a bump is a no-op', () => {
  const src = read('src/lib/session-revocation.ts')
  assert.match(src, /code === '42703'/)
  assert.match(src, /SELECT active FROM "User" WHERE id = \$\{userId\}/)
  assert.match(src, /if \(!isMissingColumn\(error\)\) throw error\s*\/\/ pre-034: nothing to bump/)
})

test('wiring: signed context carries sv, API fast path checks it, JWT refresh clears, reset revokes', () => {
  assert.match(read('src/lib/internal-auth-context.ts'), /String\(ctx\.sv \|\| 0\)\]/)
  assert.match(read('src/middleware.ts'), /sv: Number\(\(token as \{ sv\?: number \}\)\.sv\) \|\| 0/)
  assert.match(read('src/middleware.ts'), /tokenError === 'session_revoked'/)
  const helpers = read('src/lib/auth-helpers.ts')
  const check = 'sessionStillValid(ctx.userId, ctx.sv, { tenantId: ctx.tenantId, role: ctx.role })'
  assert.ok(helpers.indexOf(check) > 0)
  assert.ok(helpers.indexOf(check) < helpers.indexOf('return applyBillingWriteGuard(request, auth, opts);'))
  const opts = read('src/lib/auth-options.ts')
  assert.match(opts, /\(token as any\)\.sv = \(user as any\)\.sv;/)
  assert.match(opts, /cleared\.error = revoked \? 'session_revoked' : 'inactive_user'/)
  // The reset bumps the version inside the same UPDATE that changes the password.
  assert.match(read('src/app/api/auth/reset-password/route.ts'), /"sessionVersion" = "sessionVersion" \+ 1/)
  assert.match(read('src/lib/live-token.ts'), /sessionStillValid\(token\.sub, t\.sv, \{ tenantId: t\.tenantId \?\? null, role: t\.currentTenant\?\.role \?\? null \}\)/)
  assert.match(read('src/cf-container-worker.ts'), /"x-betsy-sv"/)
})

test('034 is additive, gated, registered with column postconditions, not in the default set', async () => {
  const sql = read('supabase/migrations/034_user_session_version.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "sessionVersion" integer NOT NULL DEFAULT 0/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp\(3\) NULL/)
  assert.match(sql, /SET LOCAL lock_timeout = '3s'/)
  assert.doesNotMatch(sql, /\b(DROP TABLE|TRUNCATE|UPDATE |DELETE )/i)
  assert.doesNotMatch(sql, /ALTER TABLE\b[\s\S]{0,80}DROP COLUMN/i, 'the apply script refuses this pattern')
  const m = await import('../../../scripts/lib/betsy-v2-additive-manifest.mjs')
  assert.equal(m.FILES['034'], '034_user_session_version.sql')
  assert.deepEqual(m.EXPECTED_COLUMNS['034'], [['User', 'sessionVersion'], ['User', 'passwordChangedAt']])
  assert.doesNotMatch(m.DEFAULT_APPLY_FILES, /034/)
})

test('schema.prisma does not reference the new columns (deploy-order safe until 034 is applied)', () => {
  assert.doesNotMatch(read('prisma/schema.prisma'), /sessionVersion|passwordChangedAt/)
})
