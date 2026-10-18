import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SILENT_LINE_CODE,
  businessMinutesBetween,
  formatSinceCr,
  inBusinessHours,
  lineDownLabel,
  lineDownNotificationText,
  lineDownReason,
  lostSiblingsSentence,
  parseLineDownKey,
  silenceThresholdMinutes,
} from '../channel-silence-core'
import { buildInstagramSuccessHtml, lostInstagramLinesHtml } from '../instagram-connect'
import { classifyTokenStatus } from '../social-account-token-health'
import { classifyChannelHealth } from '../../app/config/social/channel-health'

const read = (p: string) => readFileSync(p, 'utf8')
/** Costa Rica local time (UTC-6) → Date. */
const cr = (iso: string) => new Date(`${iso}-06:00`)

test('business window is 07:00–21:00 Costa Rica time', () => {
  assert.equal(inBusinessHours(cr('2026-10-18T06:59')), false)
  assert.equal(inBusinessHours(cr('2026-10-18T07:00')), true)
  assert.equal(inBusinessHours(cr('2026-10-18T20:59')), true)
  assert.equal(inBusinessHours(cr('2026-10-18T21:00')), false)
})

test('night hours do not count as silence', () => {
  assert.equal(businessMinutesBetween(cr('2026-10-18T09:03'), cr('2026-10-18T10:33')), 90)
  // Last message 20:50, now 07:10 next day: 10 + 10 business minutes, not 10 hours.
  assert.equal(businessMinutesBetween(cr('2026-10-17T20:50'), cr('2026-10-18T07:10')), 20)
  assert.equal(businessMinutesBetween(cr('2026-10-18T23:00'), cr('2026-10-19T06:00')), 0)
  assert.equal(businessMinutesBetween(cr('2026-10-18T10:00'), cr('2026-10-18T09:00')), 0)
  // Very old timestamps are capped (no unbounded loop), still way over any threshold.
  assert.ok(businessMinutesBetween(new Date(0), cr('2026-10-18T10:00')) > 360)
})

test('threshold scales with the line’s usual traffic, quiet lines are never judged', () => {
  assert.equal(silenceThresholdMinutes(0), null)
  assert.equal(silenceThresholdMinutes(29), null)
  assert.equal(silenceThresholdMinutes(30), 360) // ~1 every 3 business hours → cap 6 h
  assert.equal(silenceThresholdMinutes(200), 118) // ~1 every 29 min → ~2 h
  assert.equal(silenceThresholdMinutes(2000), 75) // very busy → floor 75 min
  assert.equal(silenceThresholdMinutes(Number.NaN), null)
})

test('line-down reason: token problems and silence; healthy lines are null', () => {
  assert.equal(lineDownReason({ tokenStatus: 'revoked' }), 'token')
  assert.equal(lineDownReason({ tokenStatus: 'expired' }), 'token')
  assert.equal(lineDownReason({ tokenStatus: 'error' }), 'token')
  assert.equal(lineDownReason({ tokenStatus: 'valid', lastErrorCode: SILENT_LINE_CODE }), 'silent')
  assert.equal(lineDownReason({ tokenStatus: 'valid', lastErrorCode: '100' }), null)
  assert.equal(lineDownReason({ tokenStatus: 'expiring' }), null)
})

test('Meta permission errors 10 / 200 (page unticked) count as revoked', () => {
  assert.equal(classifyTokenStatus({ graphOk: false, graphErrorCode: '10', graphHttpStatus: 400 }), 'revoked')
  assert.equal(classifyTokenStatus({ graphOk: false, graphErrorCode: 200, graphHttpStatus: 400 }), 'revoked')
  assert.equal(classifyTokenStatus({ graphOk: false, graphErrorCode: '100', graphHttpStatus: 400 }), 'error')
})

test('bell key round-trips and rejects junk; text names the line, the time and the fix', () => {
  const since = cr('2026-10-18T09:03')
  const key = `line_down:acc_1:silent:${Math.floor(since.getTime() / 60_000)}`
  assert.deepEqual(parseLineDownKey(key), { socialAccountId: 'acc_1', reason: 'silent', since })
  assert.equal(parseLineDownKey('line_down:acc_1:other:1'), null)
  assert.equal(parseLineDownKey('line_down::silent:1'), null)
  assert.equal(parseLineDownKey('ai_handoff:a:b:c'), null)
  assert.equal(parseLineDownKey(null), null)
  assert.equal(formatSinceCr(since), '18/10 09:03')
  const text = lineDownNotificationText('@patchhouse.cr', { reason: 'silent', since })
  assert.equal(text.title, 'Canal caído · @patchhouse.cr')
  assert.match(text.snippet, /18\/10 09:03/)
  assert.match(text.snippet, /Reconectá y marcá TODAS tus páginas/)
  assert.match(lineDownNotificationText('X', { reason: 'token', since }).snippet, /Perdió el acceso/)
})

test('line label is the owner’s own line name', () => {
  assert.equal(lineDownLabel({ platform: 'instagram', accountId: '1', providerUsername: 'patchhouse.cr' }), '@patchhouse.cr')
  assert.equal(lineDownLabel({ platform: 'whatsapp', accountId: '1', displayName: 'Forge' }), 'Forge')
  assert.equal(lineDownLabel({ platform: 'whatsapp', accountId: '123' }), '123')
})

test('connect result page names the lines that were dropped, escaped, and stays open', () => {
  assert.equal(lostSiblingsSentence('@a', []), null)
  assert.equal(
    lostSiblingsSentence('@prototipo.cr', ['@patchhouse.cr']),
    'Al conectar @prototipo.cr se desconectó @patchhouse.cr: volvé a conectar marcando todas las páginas.',
  )
  assert.match(lostSiblingsSentence('@a', ['@b', '@c', '@d']) as string, /se desconectaron @b, @c y @d:/)
  assert.equal(lostInstagramLinesHtml('@a', []), '')
  assert.match(lostInstagramLinesHtml('@a', ['<img src=x>']), /&lt;img src=x&gt;/)

  const ok = buildInstagramSuccessHtml({ igUsername: 'a' })
  assert.match(ok, /window\.close\(\)/)
  assert.doesNotMatch(ok, /ig-lost-lines/)
  const lost = buildInstagramSuccessHtml({ igUsername: 'prototipo.cr', lostLines: ['@patchhouse.cr'] })
  assert.match(lost, /data-testid="ig-lost-lines"/)
  assert.match(lost, /Al conectar @prototipo\.cr se desconectó @patchhouse\.cr/)
  assert.doesNotMatch(lost, /window\.close\(\)/, 'the warning must not auto-close')
})

test('Canales / chats banner: a silent line needs action', () => {
  const base = { id: 'a', platform: 'instagram', accountId: '1', linkedAt: '', isActive: true, tokenStatus: 'valid' }
  assert.equal(classifyChannelHealth(base).healthy, true)
  const silent = classifyChannelHealth({ ...base, silentSince: '2026-10-18T15:03:00Z' })
  assert.equal(silent.label, 'No llegan mensajes')
  assert.equal(silent.needsAction, true)
  assert.equal(silent.action, 'reconnect')
})

test('guards: cron-only, tenant-scoped writes, no webhook load, no token / raw code to the client', () => {
  const runner = read('src/lib/channel-silence.ts')
  const updates = runner.match(/socialAccount\.updateMany\(\{[^]*?\}\)/g) ?? []
  assert.ok(updates.length >= 3)
  for (const u of updates) assert.match(u, /where: \{ id: row\.id, tenantId: row\.tenantId/)
  assert.doesNotMatch(runner, /socialAccount\.update\(/)
  assert.match(runner, /probe\.transient\) continue/)

  const sib = read('src/lib/instagram-sibling-recheck.ts')
  assert.match(sib, /tenantId: params\.tenantId,\s+platform: 'instagram'/)
  assert.match(sib, /where: \{ id: row\.id, tenantId: params\.tenantId \}/)

  const route = read('src/app/api/cron/channel-silence/route.ts')
  assert.match(route, /requireCronBearer\(request\)/)
  assert.match(read('src/cf-container-worker.ts'), /"\*\/5 \* \* \* \*": \[[^\]]*"\/api\/cron\/channel-silence"/)

  for (const p of ['src/app/api/chat/webhook/route.ts', 'src/lib/chat-conversation-write.ts']) {
    assert.doesNotMatch(read(p), /channel-silence|instagram-sibling-recheck/, `${p} must stay untouched`)
  }

  const accounts = read('src/app/api/chat/accounts/route.ts')
  assert.match(accounts, /silentSince: row\.lastErrorCode === SILENT_LINE_CODE/)
  assert.doesNotMatch(accounts, /lastErrorCode: row\./, 'raw error code never goes to the client')

  for (const p of ['src/app/api/auth/instagram/callback/route.ts', 'src/app/api/auth/instagram/complete/route.ts']) {
    assert.match(read(p), /recheckOtherInstagramLines\(/)
  }
  assert.match(read('src/app/config/social/page.tsx'), /marcá todas tus páginas, no solo la nueva/)
})
