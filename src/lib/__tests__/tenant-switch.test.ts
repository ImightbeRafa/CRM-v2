/** Phase 2b S8: business switcher — tenant isolation guards (+ SecureDog review round). 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  const sel = read('src/lib/selected-tenant.ts')
  assert.match(sel, /isActive: true,\n\s*user: \{ active: true \},\n\s*tenant: \{ isActive: true \},/)
})

test('L3: switch uses user-level auth (no billing guard of the current business), write guard list excludes it', () => {
  assert.match(read('src/app/api/tenant/switch/route.ts'), /const auth = await authenticateUserOnly\(request\)/)
  const helper = read('src/lib/auth-helpers.ts')
  const fn = helper.slice(helper.indexOf('export async function authenticateUserOnly'), helper.indexOf('export async function authenticateAPI('))
  assert.match(fn, /sessionStillValid\(ctx\.userId, ctx\.sv\)/)
  assert.doesNotMatch(fn, /applyBillingWriteGuard/)
  assert.doesNotMatch(read('src/lib/__tests__/tenant-write-coverage.test.ts'), /tenant\/switch/)
})

test('session: business is per session (M1); update() only forces a throttled DB re-sync; payload never read', () => {
  const src = read('src/lib/auth-options.ts')
  assert.match(src, /async jwt\(\{ token, user, account, trigger \}\)/)
  assert.doesNotMatch(src.slice(src.indexOf('async jwt('), src.indexOf('async jwt(') + 600), /session\b(?!s)/)
  assert.match(src, /if \(trigger === 'update' && Date\.now\(\) - \(token\.lastDbSync \|\| 0\) > 2000\) token\.lastDbSync = 0/)
  assert.match(src, /const keepCurrent =\n\s*trigger !== 'update' &&\n\s*typeof token\.tenantId === 'string' &&\n\s*activeTenantIds\.includes\(token\.tenantId\);/)
  assert.match(src, /: selectActiveTenantId\(dbUser\.defaultTenantId, activeTenantIds\);/)
  // L4: MASTER follows the SELECTED business role.
  assert.match(src, /token\.role = memberships\.find\(\(m\) => m\.tenantId === selectedTenantId\)\?\.role === 'OWNER' \? 'MASTER' : 'REGULAR';/)
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
  assert.match(ui, /const next = await update\(\)\n\s*if \(\(next\?\.user as \{ tenantId\?: string \} \| undefined\)\?\.tenantId !== b\.id\)/, 'L1: only navigates when the session moved')
  const watcher = read('src/app/components/Sessionprovider.tsx')
  assert.match(watcher, /<BusinessChangeWatcher \/>/)
  assert.match(watcher, /if \(loadedWith\.current !== tenantId\) \{\n\s*clearBusinessScopedBrowserState\(\)\n\s*window\.location\.replace\("\/dashboard"\)/)
  // The watcher never calls next-auth update() (that is the explicit switch path).
  assert.doesNotMatch(watcher, /\{ update \}|\bupdate\s*\(\s*\)\s*$|await update\(/m, 'the watcher never triggers a switch itself')
  // L2: drafts carry their business and are refused elsewhere.
  assert.equal(draftBelongsTo({ businessId: 'A' }, 'A'), true)
  assert.equal(draftBelongsTo({ businessId: 'A' }, 'B'), false)
  assert.equal(draftBelongsTo({ businessId: 'A' }, null), false)
  assert.equal(draftBelongsTo({}, 'B'), true, 'legacy untagged drafts (pre-switcher, single business)')
  const form = read('src/app/ventas/components/EnhancedSalesForm.tsx')
  assert.match(form, /businessId: businessIdRef\.current,/)
  assert.match(form, /if \(!draftBelongsTo\(parsed, businessId\)\) \{/)
})
