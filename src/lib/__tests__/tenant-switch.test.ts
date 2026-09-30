/** Phase 2b S8: business switcher — tenant isolation guards (+ SecureDog review rounds). 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { clearBusinessScopedBrowserState } from '../business-switch-client'
import { draftBelongsTo } from '../order-draft'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

/** All .ts / .tsx files under a folder (POSIX paths), no git needed. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

test('round 4: invite mail escaped + rate limited, no direct reactivation, seats on accept, accept moves session', () => {
  const mail = read('src/lib/email.ts')
  assert.match(mail, /const tenantName = escapeHtml\(/)
  assert.match(mail, /Únete a \$\{tenantName\}/)
  assert.doesNotMatch(mail, /\$\{input\.tenantName\}/)
  assert.match(mail, /replace\(\/\[\\r\\n\\t\]\+\/g, ' '\)/)
  const svc = read('src/lib/team-invite-service.ts')
  assert.match(svc, /identifier: 'invite-sender'/)
  assert.match(svc, /identifier: 'invite-recipient'/)
  assert.match(svc, /if \(usage\.currentCount >= usage\.limit\) throw new SeatLimitReached/)
  for (const f of ['src/app/api/users/route.ts', 'src/app/api/users/[id]/route.ts']) {
    assert.match(read(f), /if \(active === true && !membership\.isActive\) \{\n\s*return createErrorResponse\('Esta persona ya no es miembro: enviale una invitación para que vuelva\.', 409\)/, f)
  }
  assert.match(read('src/app/api/users/route.ts'), /const existingUserId = await findUserIdByEmail\(normalizedEmail\)/)
  const accept = read('src/app/auth/accept-invite/page.tsx')
  assert.match(accept, /let next = await update\(\)/)
  assert.match(accept, /clearBusinessScopedBrowserState\(\)\n\s*window\.location\.assign\('\/dashboard'\)/)
  const auth = read('src/lib/auth-options.ts')
  assert.match(auth, /token\.lastDbSync = 0;\n/, 'login applies the re-sync rules immediately')
  assert.doesNotMatch(auth, /const hasOwnerRole = memberships\.some\(\(m\) => m\.role === 'OWNER'\)/)
  assert.match(read('src/app/ventas/components/EnhancedSalesForm.tsx'), /if \(!draftWritable\(\)\) \{\n\s*setSubmitStatus\(/)
})

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
  const users = walk('src').filter((f) => readFileSync(f, 'utf8').includes('authenticateUserOnly')).sort()
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

test('round 5: invites never lock anyone out; mails escape names; seats checked before sending', () => {
  const auth = read('src/lib/auth-options.ts')
  // Google sign-in with an unacceptable invite: own businesses still log in; none → explained redirect.
  assert.match(auth, /return `\/auth\/signin\?error=\$\{accepted\.status === 402 \? 'invite_seat_limit' : accepted\.status === 409 \? 'invite_retry' : 'invite_invalid'\}`/)
  // New Google user: cleanup is conditional (only this account, only without memberships) and
  // also runs when the accept throws.
  assert.match(auth, /prisma\.user\.deleteMany\(\{ where: \{ id: createdForInvite\.id, memberships: \{ none: \{\} \} \} \}\)/)
  assert.match(auth, /catch \(acceptError\) \{[\s\S]{0,200}await undoNewUser\(\)/)
  assert.doesNotMatch(auth, /defaultTenantId: pendingForNew\.tenantId/)
  assert.doesNotMatch(auth, /Invite accept failed for \$\{updatedUser\.email\}:`, accepted\.error\)\n\s*return false/)
  const svc = read('src/lib/team-invite-service.ts')
  assert.match(svc, /const seats = await getTenantSeatUsage\(input\.tenantId\)/)
  assert.ok(svc.indexOf('const seats = await getTenantSeatUsage') < svc.indexOf('inviteSenderLimit(`'), 'limits counted only after validation')
  assert.match(svc, /inviteTenantRecipientLimit\(`\$\{input\.tenantId\}:\$\{recipientKey\}`\)/)
  // Sequential, first refusal stops (a refused call never spends the shared recipient limit).
  assert.doesNotMatch(svc, /Promise\.all\(\[\n\s*inviteSenderLimit/)
  assert.ok(svc.indexOf('inviteTenantRecipientLimit(`') < svc.indexOf('inviteRecipientLimit(recipientKey)'))
  assert.match(svc, /createHash\('sha256'\)\.update\(email\)/)
  assert.match(svc, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/)
  const mail = read('src/lib/email.ts')
  assert.doesNotMatch(mail, /Hola \$\{name \|\| ''\}/)
  assert.doesNotMatch(mail, /Hola\$\{name \? ` \$\{name\}` : ''\}/)
  assert.match(read('src/app/api/invites/accept/route.ts'), /if \(result\.status !== 409\) failed\.cookies\.set\(TEAM_INVITE_COOKIE, '', \{ httpOnly: true, path: '\/', maxAge: 0 \}\)/)
  assert.match(read('src/app/api/auth/register/route.ts'), /data: \{ defaultTenantId: null \}/)
  assert.match(read('src/app/auth/accept-invite/page.tsx'), /if \(joined && \(next\?\.user as \{ tenantId\?: string \} \| undefined\)\?\.tenantId !== joined\)/)
})

test('every seat admission that takes the bot-seat lock stays Serializable (no over-admission)', () => {
  const sites = walk('src').filter((f) => !f.includes('__tests__') && read(f).includes('bot-seat:'))
  assert.ok(sites.length >= 3, sites.join(','))
  for (const f of sites) {
    const src = read(f)
    const locks = (src.match(/pg_advisory_xact_lock\(hashtext\(\$\{`bot-seat:/g) || []).length
    const serializable = (src.match(/isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/g) || []).length
    assert.ok(serializable >= Math.min(locks, 1), `${f}: ${locks} lock(s), ${serializable} Serializable`)
  }
})
