/** Phase 2b S8: business switcher — tenant isolation guards. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clearBusinessScopedBrowserState } from '../business-switch-client'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('switch: membership re-checked server-side (active user + membership + business), own user only', () => {
  const src = read('src/app/api/tenant/switch/route.ts')
  assert.match(src, /const membership = await getSelectedTenantMembership\(auth\.userId, target\)/)
  assert.match(src, /if \(!membership\) return NextResponse\.json\(\{ success: false, error: 'No tenés acceso a ese negocio' \}, \{ status: 403 \}\)/)
  assert.match(src, /prisma\.user\.updateMany\(\{ where: \{ id: auth\.userId, active: true \}, data: \{ defaultTenantId: target \} \}\)/)
  assert.match(src, /identifier: 'tenant-switch'/)
  assert.match(src, /for \(const tenantId of \[auth\.tenantId, target\]\)/, 'audited in both businesses')
  // getSelectedTenantMembership checks all three: membership, user and tenant active.
  const sel = read('src/lib/selected-tenant.ts')
  assert.match(sel, /isActive: true,\n\s*user: \{ active: true \},\n\s*tenant: \{ isActive: true \},/)
})

test('session: update() only forces a DB re-sync; the client payload is never read', () => {
  const src = read('src/lib/auth-options.ts')
  assert.match(src, /async jwt\(\{ token, user, account, trigger \}\)/)
  assert.doesNotMatch(src.slice(src.indexOf('async jwt('), src.indexOf('async jwt(') + 400), /session/, 'no session payload destructured')
  assert.match(src, /if \(trigger === 'update'\) token\.lastDbSync = 0/)
  // The re-sync picks the tenant from the DB (defaultTenantId among ACTIVE memberships).
  assert.match(src, /selectActiveTenantId\(\n\s*dbUser\.defaultTenantId,\n\s*memberships\.map\(\(m\) => m\.tenantId\),\n\s*\)/)
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

test('switching clears order drafts and session caches of the previous business, keeps UI prefs', () => {
  const local = fakeStorage({ betsy_autosave: '{}', 'betsy_autosave:chat:c1': '{}', 'betsy.chat.railTab.v2': 'cliente', betsy_autosave_other: 'x' })
  const session = fakeStorage({ businessInfoFields: '{}' })
  assert.equal(clearBusinessScopedBrowserState({ local, session }), 2)
  assert.equal(local.getItem('betsy_autosave'), null)
  assert.equal(local.getItem('betsy_autosave:chat:c1'), null)
  assert.equal(local.getItem('betsy.chat.railTab.v2'), 'cliente')
  assert.equal(local.getItem('betsy_autosave_other'), 'x', 'prefix match is exact')
  assert.equal(session.length, 0)
  const ui = read('src/components/aurora/BusinessSwitcher.tsx')
  assert.match(ui, /await update\(\)\n\s*clearBusinessScopedBrowserState\(\)\n\s*window\.location\.assign\('\/dashboard'\)/)
})
