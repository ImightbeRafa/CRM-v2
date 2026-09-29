/** Phase 2b S8: business switcher — tenant isolation guards (+ SecureDog review rounds). 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { clearBusinessScopedBrowserState } from '../business-switch-client'
import { draftBelongsTo } from '../order-draft'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('switch: membership re-checked fresh AND inside a conditional write of my own user row', () => {
  const src = read('src/app/api/tenant/switch/route.ts')
  assert.match(src, /const membership = await getSelectedTenantMembership\(auth\.userId, target\)/)
  assert.match(src, /memberships: \{ some: \{ tenantId: target, isActive: true, tenant: \{ isActive: true \} \} \},/)
  assert.match(src, /where: \{\n\s*id: auth\.userId,\n\s*active: true,/)
  assert.match(src, /if \(written\.count !== 1\)/)
  assert.match(src, /identifier: 'tenant-switch'/)
  // Denials never written into another business's audit log.
  assert.doesNotMatch(src.slice(src.indexOf('export async function POST'), src.indexOf('const written')), /logAuditEvent\(/)
  // The "left" row only if the user is still an active member of the previous business.
  assert.match(src, /const previous = auth\.unverifiedTenantId \? await getSelectedTenantMembership\(auth\.userId, auth\.unverifiedTenantId\) : null/)
  const sel = read('src/lib/selected-tenant.ts')
  assert.match(sel, /isActive: true,\n\s*user: \{ active: true \},\n\s*tenant: \{ isActive: true \},/)
})

test('L3 / N3: user-level auth for the switch only — signed context, no fallback, no billing guard', () => {
  assert.match(read('src/app/api/tenant/switch/route.ts'), /const auth = await authenticateUserOnly\(request\)/)
  const helper = read('src/lib/auth-helpers.ts')
  const fn = helper.slice(helper.indexOf('export async function authenticateUserOnly'), helper.indexOf('export async function authenticateAPI('))
  assert.match(fn, /sessionStillValid\(ctx\.userId, ctx\.sv\)/)
  assert.doesNotMatch(fn, /applyBillingWriteGuard/)
  assert.doesNotMatch(fn, /getServerSession/, 'no unsigned fallback')
  assert.match(fn, /unverifiedTenantId/)
  assert.doesNotMatch(read('src/lib/__tests__/tenant-write-coverage.test.ts'), /tenant\/switch/)
  // Only the switch route may use the user-only helper.
  const users = execSync('git grep -l "authenticateUserOnly" -- src', { encoding: 'utf8' }).trim().split(/\r?\n/).sort()
  assert.deepEqual(users, ['src/app/api/tenant/switch/route.ts', 'src/lib/__tests__/tenant-switch.test.ts', 'src/lib/auth-helpers.ts'])
})

test('session: business is per session (M1), never an inactive business (N2); update() throttled; payload never read', () => {
  const src = read('src/lib/auth-options.ts')
  assert.match(src, /async jwt\(\{ token, user, account, trigger \}\)/)
  assert.match(src, /if \(trigger === 'update' && Date\.now\(\) - \(token\.lastDbSync \|\| 0\) > 2000\) token\.lastDbSync = 0/)
  assert.match(src, /const liveTenantIds = memberships\.filter\(\(m\) => m\.tenant\?\.isActive !== false\)\.map\(\(m\) => m\.tenantId\);/)
  assert.match(src, /const keepCurrent =\n\s*trigger !== 'update' &&\n\s*typeof token\.tenantId === 'string' &&\n\s*selectable\.includes\(token\.tenantId\);/)
  assert.match(src, /: selectActiveTenantId\(dbUser\.defaultTenantId, selectable\);/)
  assert.match(src, /orderBy: \{ joinedAt: 'asc' \},/)
  // L4: MASTER follows the SELECTED business role (re-sync and Google login).
  assert.match(src, /token\.role = memberships\.find\(\(m\) => m\.tenantId === selectedTenantId\)\?\.role === 'OWNER' \? 'MASTER' : 'REGULAR';/)
  assert.match(src, /\(user as any\)\.role = updatedUser\.memberships\.find\(\(m\) => m\.tenantId === selectedTenantId\)\?\.role === 'OWNER' \? 'MASTER' : 'REGULAR';/)
  assert.doesNotMatch(src, /hasOwnerRole = updatedUser\.memberships\.some/)
})

test('N1: an existing account is only ever invited (it must accept), never attached directly', () => {
  const users = read('src/app/api/users/route.ts')
  const start = users.indexOf('if (existingUser) {')
  const existing = users.slice(start, users.indexOf('} else {', start))
  assert.match(existing, /return sendInvite\(\)/)
  assert.doesNotMatch(existing, /membership\.(create|update)\(/)
  assert.match(users, /if \(raceConditionUser\) \{\n\s*\/\/[^\n]*\n\s*return sendInvite\(\)/)
})

test('memberships list: only my own active memberships of active businesses', () => {
  const src = read('src/app/api/tenant/memberships/route.ts')
  assert.match(src, /where: \{ userId: auth\.userId, isActive: true, user: \{ active: true \}, tenant: \{ isActive: true \} \}/)
  assert.doesNotMatch(src, /email/)
})

function fakeStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init))
  return {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage
}

test('switching clears drafts / session caches; other tabs reload; drafts only restore in their business', () => {
  const local = fakeStorage({ betsy_autosave: '{}', 'betsy_autosave:chat:c1': '{}', 'betsy.chat.railTab.v2': 'cliente', betsy_autosave_other: 'x' })
  const session = fakeStorage({ businessInfoFields: '{}' })
  assert.equal(clearBusinessScopedBrowserState({ local, session }), 2)
  assert.equal(local.getItem('betsy.chat.railTab.v2'), 'cliente')
  assert.equal(local.getItem('betsy_autosave_other'), 'x', 'prefix match is exact')
  assert.equal(session.length, 0)
  const ui = read('src/components/aurora/BusinessSwitcher.tsx')
  assert.match(ui, /let next = await update\(\)/)
  assert.match(ui, /if \(\(next\?\.user as \{ tenantId\?: string \} \| undefined\)\?\.tenantId !== b\.id\) \{\n\s*setError\(/, 'L1: only navigates when the session moved')
  assert.match(ui, /const canSwitch = Boolean\(businesses\?\.some\(\(b\) => !b\.current\)\)/)
  const watcher = read('src/app/components/Sessionprovider.tsx')
  assert.match(watcher, /<BusinessChangeWatcher \/>/)
  assert.match(watcher, /if \(loadedWith\.current !== tenantId\) \{\n\s*clearBusinessScopedBrowserState\(\)\n\s*window\.location\.replace\("\/dashboard"\)/)
  assert.doesNotMatch(watcher, /\{ update \}|await update\(/, 'the watcher never triggers a switch itself')
  // L2: drafts carry their business; new untagged drafts are refused; legacy ones only if old.
  assert.equal(draftBelongsTo({ businessId: 'A' }, 'A'), true)
  assert.equal(draftBelongsTo({ businessId: 'A' }, 'B'), false)
  assert.equal(draftBelongsTo({ businessId: 'A' }, null), false)
  assert.equal(draftBelongsTo({ timestamp: '2026-09-20T10:00:00Z' }, 'B'), true)
  assert.equal(draftBelongsTo({ timestamp: '2026-10-02T10:00:00Z' }, 'B'), false)
  assert.equal(draftBelongsTo({}, 'B'), false)
  const form = read('src/app/ventas/components/EnhancedSalesForm.tsx')
  assert.match(form, /const draftWritable = \(\) => Boolean\(businessIdRef\.current\) && sessionBusinessRef\.current === businessIdRef\.current;/)
  assert.match(form, /if \(!businessIdRef\.current && sessionStatus === 'authenticated' && sessionBusiness\) businessIdRef\.current = sessionBusiness;/)
  assert.match(form, /if \(!draftBelongsTo\(parsed, businessId\)\) \{/)
})
