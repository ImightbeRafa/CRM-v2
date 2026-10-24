import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { scrubPii } from '../observability/scrub'
import { errorFingerprint, normalizeErrorMessage, topFrames } from '../observability/fingerprint'
import {
  installConsoleErrorCapture,
  pendingGroupCount,
  reportError,
  resetObservabilityForTests,
  sanitizeReport,
} from '../observability/report-error'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

test('scrubPii masks emails, phones, tokens, JWTs, DB urls and Postgres key details', () => {
  const out = scrubPii(
    'user ana.perez@gmail.com phone +506 8888-7777 url /auth/reset-password?token=abc123 ' +
      'Bearer sk_live_ABCDEF123456 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U ' +
      'postgres://u:p@db.host:5432/x Key (phone)=(88887777) already exists ' +
      'secret 0123456789abcdef0123456789abcdef',
  )
  for (const leaked of ['ana.perez', '8888-7777', 'abc123', 'sk_live', 'eyJhbGci', 'u:p@db', '88887777', '0123456789abcdef0123']) {
    assert.ok(!out.includes(leaked), `leaked ${leaked}: ${out}`)
  }
  assert.match(out, /\[email\]/)
  assert.match(out, /token=\[redacted\]/)
  assert.match(out, /Key \(phone\)=\(\[redacted\]\)/)
  // Ordinary words and short numbers stay readable.
  assert.equal(scrubPii('Order 42 failed: timeout'), 'Order 42 failed: timeout')
})

test('fingerprint groups the same error even when ids and numbers differ', () => {
  const stackA = 'Error: x\n    at handler (/app/.next/server/app/api/orders/route.js:10:5)\n    at node:internal/foo:1:1'
  const stackB = 'Error: x\n    at handler (/app/.next/server/app/api/orders/route.js:99:12)'
  const a = errorFingerprint({ source: 'server', name: 'Error', message: 'Order cmabc123def456ghi789jkl0 not found after 3 tries', stack: stackA })
  const b = errorFingerprint({ source: 'server', name: 'Error', message: 'Order cmzzz999yyy888xxx777www6 not found after 5 tries', stack: stackB })
  assert.equal(a, b)
  assert.match(a, /^server:[0-9a-f]{16}$/)
  assert.notEqual(a, errorFingerprint({ source: 'client', name: 'Error', message: 'Order x not found', stack: stackA }))
  assert.equal(normalizeErrorMessage('took 1234 ms'), 'took # ms')
  assert.deepEqual(topFrames(stackA), ['at handler (/app/.next/server/app/api/orders/route.js'])
})

test('reports are scrubbed and size-capped before they are logged or stored', () => {
  const r = sanitizeReport({ source: 'server', name: 'TypeError', message: `bad ${'x'.repeat(900)} for maria@x.com`, route: '/api/x?token=abc', stack: 'y'.repeat(9000) })
  assert.ok(r.message.length <= 500)
  assert.ok((r.stack ?? '').length <= 4000)
  assert.equal(r.route, '/api/x')
  assert.ok(!JSON.stringify(r).includes('abc'))
})

test('console.error capture records only the Error (never the other arguments) and cannot recurse', () => {
  resetObservabilityForTests()
  const lines: string[] = []
  const realError = console.error
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  try {
    installConsoleErrorCapture()
    const boom = new Error('boom')
    console.error('[orders] failed for', { phone: '88887777', name: 'María' }, boom)
    console.error('plain message without an error object')
    assert.equal(pendingGroupCount(), 1)
    const json = lines.find((l) => l.includes('"kind":"betsy.error"'))
    assert.ok(json, 'one structured line for Workers Logs')
    assert.ok(!json!.includes('88887777') && !json!.includes('María'))
    assert.match(json!, /"route":"\[orders\] failed for"/)
    console.error('[orders] failed again', boom)
    assert.equal(pendingGroupCount(), 1, 'same error → same group (counted, not duplicated)')
    reportError({ source: 'server', name: 'Error', message: 'another problem' })
    assert.equal(pendingGroupCount(), 2)
  } finally {
    resetObservabilityForTests()
    console.error = realError
  }
})

function clientReq(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('https://www.betsycrm.com/api/client-errors', {
    method: 'POST',
    body,
    headers: { origin: 'https://www.betsycrm.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
  })
}

test('browser error endpoint: same-origin only, 8 KB cap, rate limited, always quiet', async () => {
  resetObservabilityForTests()
  const realError = console.error
  console.error = () => undefined
  try {
    const { POST } = await import('../../app/api/client-errors/route')
    assert.equal((await POST(clientReq('{"message":"x"}', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))).status, 403)
    assert.equal((await POST(clientReq('{"message":"x"}', { origin: '' }))).status, 403)
    assert.equal((await POST(clientReq(JSON.stringify({ message: 'x'.repeat(9000) }), { 'x-forwarded-for': '203.0.113.10' }))).status, 413)
    assert.equal((await POST(clientReq('not json', { 'x-forwarded-for': '203.0.113.11' }))).status, 204)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await POST(clientReq(JSON.stringify({ name: 'TypeError', message: `fail ${i}`, route: '/chats?token=abc' }), { 'x-forwarded-for': '203.0.113.12' }))).status)
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(204))
    assert.equal(statuses[10], 429)
  } finally {
    resetObservabilityForTests()
    console.error = realError
  }
})

test('SQL 040 is additive, platform-only and locked down; Salud is admin only', () => {
  const sql = read('supabase/migrations/040_ops_error_groups.sql')
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE)\b/i)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."OpsErrorGroup"/)
  assert.match(sql, /ALTER TABLE public\."OpsErrorGroup" ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(sql, /REFERENCES/)
  const manifest = read('scripts/lib/betsy-v2-additive-manifest.mjs')
  assert.match(manifest, /'040': '040_ops_error_groups\.sql'/)
  assert.doesNotMatch(manifest.match(/DEFAULT_APPLY_FILES = '([^']*)'/)?.[1] ?? '', /040/)
  for (const p of ['src/app/api/super-admin/health/route.ts', 'src/app/api/super-admin/errors/[id]/route.ts']) {
    assert.match(read(p), /if \(!\(await isSuperAdmin\(auth\.userId\)\)\) return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404/)
  }
  assert.match(read('src/app/super-admin/salud/page.tsx'), /if \(!\(await isSuperAdmin\(userId\)\)\) redirect\('\/dashboard'\)/)
})

test('SecureDog 2026-10-02: scrubber is fast on long input, drops row details / Prisma arguments, strips NUL', async () => {
  const { reducePrismaMessage, cleanText, SCRUB_INPUT_MAX } = await import('../observability/scrub')
  const started = Date.now()
  scrubPii('a'.repeat(200_000))
  assert.ok(Date.now() - started < 1_000, 'bounded patterns + input cut (was quadratic)')
  assert.equal(SCRUB_INPUT_MAX, 12_000)
  const prismaMsg = 'Invalid `prisma.order.create()` invocation:\n\n{\n  data: {\n    customerName: "María José Rodríguez",\n    address: "200 m sur de la iglesia"\n  }\n}\n\nArgument `total` is missing.'
  const reduced = reducePrismaMessage(prismaMsg)
  assert.ok(!reduced.includes('María') && !reduced.includes('iglesia'))
  assert.match(reduced, /Argument `total` is missing\./)
  const pg = scrubPii('null value violates constraint. DETAIL: Failing row contains (1, Juan Pérez, Barrio Escalante)')
  assert.ok(!pg.includes('Juan') && !pg.includes('Escalante'))
  assert.ok(!cleanText('x\u0000y').includes('\u0000'))
  const clipped = sanitizeReport({ source: 'client', name: 'E', message: `${'a'.repeat(498)}😀😀😀` })
  assert.doesNotMatch(clipped.message, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no half emoji')
})

test('SecureDog 2026-10-02: browser reports have their own budget, only production writes, emails carry no error text', () => {
  const src = read('src/lib/observability/report-error.ts')
  assert.match(src, /const MAX_PENDING_CLIENT_GROUPS = 20/)
  assert.match(src, /const MAX_NEW_CLIENT_GROUPS_PER_DAY = 200/)
  assert.match(src, /if \(!isProductionContainer\(env\)\) return \{ written: 0, newGroups: 0, failed: 0, skipped: 'not_production' \}/)
  assert.match(src, /if \(p\.report\.source === 'client'\) clientBudget -= 1\n\s+else fresh\.push\(p\.report\)/, 'browser groups never email')
  assert.match(src, /groups\.slice\(0, 5\)\.map\(\(g\) => `\$\{g\.source\} · \$\{emailSafe\(g\.route, 120\)\} · \$\{emailSafe\(g\.name, 60\)\}`\)/)
  assert.doesNotMatch(src, /g\.message\.slice/)
  // One bad row never hides the others: each row has its own try / catch.
  assert.match(src, /for \(const \[id, p\] of batch\) \{\n\s+try \{/)
  assert.match(src, /export async function purgeErrorGroups/)
  assert.match(read('src/lib/workspace-retention.ts'), /const purged = await purgeErrorGroups\(\)/)
  assert.match(read('src/lib/observability/client-report.ts'), /type: 'text\/plain;charset=UTF-8'/)
})

test('flush on a non-production container writes nothing (Railway preview shares the database)', async () => {
  resetObservabilityForTests()
  const realError = console.error
  console.error = () => undefined
  try {
    reportError({ source: 'server', name: 'Error', message: 'preview noise' })
    const { flushErrorGroups } = await import('../observability/report-error')
    const r = await flushErrorGroups({})
    assert.equal(r.skipped, 'not_production')
    assert.equal(pendingGroupCount(), 0)
  } finally {
    resetObservabilityForTests()
    console.error = realError
  }
})

test('uptime: public /api/health pings the DB with a 3 s limit; the Worker checks it every 5 min and emails when down', () => {
  const health = read('src/app/api/health/route.ts')
  assert.match(health, /prisma\.\$queryRaw`SELECT 1`/)
  assert.match(health, /setTimeout\(\(\) => resolve\('timeout'\), 3_000\)/)
  assert.doesNotMatch(health, /tenant|session|auth/i)
  assert.match(read('src/middleware.ts'), /'\/api\/health',/)
  const worker = read('src/cf-container-worker.ts')
  assert.match(worker, /if \(controller\.cron === "\*\/5 \* \* \* \*"\) \{\n\s+await healthWatch\(env\)/)
  assert.match(worker, /await new Promise\(\(r\) => setTimeout\(r, 20_000\)\);/, 'second check before alerting')
  assert.match(worker, /planWatchRound\(previous, checks, now, shared \? \{\} : \{ downRounds: 1 \}\)/, 'every email decided by the tested planner; first-failure email without the shared state')
  assert.match(worker, /buildUpEmail\(previous\?\.outage \?\? null, last, now\)/)
  assert.match(worker, /HEALTH_CHECK_TIMEOUT_MS/, 'a hung container counts as down')
  assert.match(health, /dbMs: Date\.now\(\) - started/)
  // 2026-10-23: state shared by every data center (Durable Object), edge cache only as fallback.
  assert.match(worker, /async getWatchState\(\): Promise<string \| null> \{\n\s+return this\.ctx\.storage\.kv\.get<string>\(WATCH_STATE_KEY\)/)
  assert.match(worker, /const \{ state: previous, shared \} = await loadWatchState\(env\);/)
  assert.match(worker, /if \(state \|\| previous\) await saveWatchState\(env, state\);/)
  assert.match(worker, /using edge cache/)
  // The connection-error count only for the watchdog's own check (header = CRON_SECRET, constant-time).
  assert.match(worker, /"x-betsy-watch": \(env\.CRON_SECRET \|\| ""\)\.trim\(\)/)
  assert.match(health, /request\.headers\.get\('x-betsy-watch'\)/)
  assert.match(health, /timingSafeEqual\(a, b\)/)
  assert.match(health, /: \{ ok: true, dbMs: Date\.now\(\) - started \}/, 'public answer unchanged')
})

test('uptime emails: cause in plain words, CR time, attempts, duration on recovery, hourly reminder', async () => {
  const h = await import('../ops/health-watch-text')
  const worker = () => read('src/cf-container-worker.ts')
  assert.equal(h.classifyHealth(503, '{"ok":false,"db":"timeout"}'), 'db_timeout')
  assert.equal(h.classifyHealth(503, '{"ok":false,"db":"error"}'), 'db_error')
  assert.equal(h.classifyHealth(503, '{"error":"Servicio temporalmente no disponible"}'), 'app_unreachable')
  assert.equal(h.classifyHealth(500, 'oops'), 'app_error')
  assert.equal(h.classifyHealth(0, '', 'timeout'), 'no_answer')
  assert.equal(h.classifyHealth(0, '', 'TypeError'), 'app_unreachable')
  assert.equal(h.classifyHealth(200, '{"ok":true,"dbMs":12}'), undefined)
  assert.equal(h.parseDbMs('{"ok":true,"dbMs":42}'), 42)
  assert.equal(h.crTime('2026-10-13T03:26:12.068Z', true), '12/10 21:26')
  assert.equal(h.humanDuration(4 * 60_000 + 20_000), '4 min')
  assert.equal(h.humanDuration(95 * 60_000), '1 h 35 min')

  const fail = { ok: false, status: 503, ms: 3100, cause: 'db_timeout' as const, detail: 'HTTP 503 {"ok":false,"db":"timeout"}' }
  const checks = [
    { ...fail, at: '2026-10-13T03:25:51.000Z' },
    { ...fail, at: '2026-10-13T03:26:11.500Z' },
  ]
  // Round 1 fails: tracked, NO email (a single failed round is a blip — 2026-10-23 sent "down" for those).
  const r1 = h.planWatchRound(null, checks, '2026-10-13T03:26:12.068Z')
  assert.deepEqual(r1.emails, [])
  assert.equal(r1.state?.outage?.since, '2026-10-13T03:25:51.000Z')
  assert.equal(r1.state?.outage?.emailed, false)
  // A one-round blip that recovers: no email at all, state cleared.
  const ok = { at: '2026-10-13T03:30:49.000Z', ok: true, status: 200, ms: 180, dbMs: 9, detail: 'HTTP 200' }
  const blip = h.planWatchRound(r1.state, [ok], '2026-10-13T03:31:00.000Z')
  assert.deepEqual(blip.emails, [])
  assert.equal(blip.state, null)

  // Round 2 still failing: ONE "down" email.
  const r2 = h.planWatchRound(r1.state, checks, '2026-10-13T03:31:12.000Z')
  assert.deepEqual(r2.emails, ['down'])
  assert.equal(r2.state?.outage?.failedRounds, 2)
  const down = h.buildDownEmail(r2.state!.outage!, checks, '2026-10-13T03:31:12.000Z')
  assert.match(down.subject, /NO responde — base de datos lenta/)
  assert.match(down.text, /Supabase\) tardó más de 3 segundos/)
  assert.match(down.text, /12\/10 21:25 hora CR \(03:25 UTC\)/)
  assert.match(down.text, /2\) 21:26 — HTTP 503/)
  assert.match(down.text, /status\.supabase\.com/)

  // Later rounds inside the hour: no email; after an hour: one reminder.
  const r3 = h.planWatchRound(r2.state, checks, '2026-10-13T03:36:12.000Z')
  assert.deepEqual(r3.emails, [])
  const r4 = h.planWatchRound({ ...r3.state!, updatedAt: '2026-10-13T04:26:00.000Z' }, checks, '2026-10-13T04:31:30.000Z')
  assert.deepEqual(r4.emails, ['remind'])
  assert.equal(r4.state?.outage?.lastEmailAt, '2026-10-13T04:31:30.000Z')
  assert.match(h.buildDownEmail(r4.state!.outage!, checks, '2026-10-13T04:31:30.000Z', true).subject, /SIGUE sin responder \(1 h 6 min\) — base de datos lenta/)
  // Cause follows the latest failure (Supabase slow → container down).
  const gone = [{ ...fail, at: '2026-10-13T04:36:10.000Z', status: 0, cause: 'app_unreachable' as const, detail: 'Error' }]
  const r5 = h.planWatchRound(r4.state, gone, '2026-10-13T04:36:30.000Z')
  assert.equal(r5.state?.outage?.cause, 'app_unreachable')
  assert.equal(r5.state?.outage?.since, '2026-10-13T03:25:51.000Z')
  // Resend did not accept the first email: the worker marks it unsent and the next round sends again.
  const unsent = { ...r2.state!, outage: { ...r2.state!.outage!, emailed: false, lastEmailAt: h.UNSENT_EMAIL_AT } }
  assert.deepEqual(h.planWatchRound(unsent, checks, '2026-10-13T03:36:12.000Z').emails, ['down'])
  assert.match(worker(), /if \(kind === "down"\) state\.outage\.emailed = false;/)
  assert.match(worker(), /max-age=7200/)

  // Recovery: one "up" email with the real range (last failure → first OK), not "since the first failure".
  const r6 = h.planWatchRound(r2.state, [ok], '2026-10-13T03:36:00.000Z')
  assert.deepEqual(r6.emails, ['up'])
  assert.equal(r6.state, null)
  const stored = h.parseWatchState(JSON.stringify(r2.state))
  const up = h.buildUpEmail(stored!.outage, ok, '2026-10-13T03:36:00.000Z')
  assert.match(up.subject, /volvió a responder \(caído ~10 min\)/)
  assert.match(up.text, /Duración: entre 5 min y 10 min/)
  assert.match(up.text, /Último fallo visto: 21:31/)
  assert.match(up.text, /base de datos 9 ms/)
  assert.match(up.text, /Revisiones fallidas seguidas: 2/)
  assert.match(h.buildUpEmail(null, ok, '2026-10-13T03:30:49.693Z').subject, /^www\.betsycrm\.com volvió a responder$/)
  assert.doesNotMatch(down.text + up.text, /@/, 'no addresses or customer data in the texts')

  // State left behind while crons were paused (> 2 h): dropped, no "recovered after 3 days" email.
  const old = { ...r2.state!, updatedAt: '2026-10-10T03:31:12.000Z' }
  const late = h.planWatchRound(old, [ok], '2026-10-13T03:36:00.000Z')
  assert.deepEqual(late.emails, [])
  assert.equal(late.state, null)
  assert.equal(h.parseWatchState('1'), null)
  assert.equal(h.parseWatchState(null), null)

  // Database slow while the site answers: one warning after 2 slow rounds, one "back to normal" after 2 normal rounds.
  const slow = { ...ok, dbMs: 2500, connErrors: 0 }
  const s1 = h.planWatchRound(null, [slow], '2026-10-13T05:00:00.000Z')
  assert.deepEqual(s1.emails, [])
  const s2 = h.planWatchRound(s1.state, [{ ...ok, dbMs: 40, connErrors: 9 }], '2026-10-13T05:05:00.000Z')
  assert.deepEqual(s2.emails, ['degraded'])
  assert.equal(s2.state?.degraded?.worstDbMs, 2500)
  assert.equal(s2.state?.degraded?.worstConnErrors, 9)
  const s3 = h.planWatchRound(s2.state, [ok], '2026-10-13T05:10:00.000Z')
  assert.deepEqual(s3.emails, [])
  const s4 = h.planWatchRound(s3.state, [ok], '2026-10-13T05:15:00.000Z')
  assert.deepEqual(s4.emails, ['degraded_clear'])
  assert.equal(s4.state, null)
  assert.match(h.buildDegradedEmail(s2.state!.degraded!, slow, '2026-10-13T05:05:00.000Z', false).subject, /sigue arriba, pero la base de datos está lenta/)
  // A one-round blip during a "slow" episode keeps it: its promised "back to normal" email still comes.
  const b1 = h.planWatchRound(s2.state, checks, '2026-10-13T05:10:00.000Z')
  assert.deepEqual(b1.emails, [])
  assert.equal(b1.state?.degraded?.emailed, true)
  const b2 = h.planWatchRound(b1.state, [ok], '2026-10-13T05:15:00.000Z')
  const b3 = h.planWatchRound(b2.state, [ok], '2026-10-13T05:20:00.000Z')
  assert.deepEqual([...b2.emails, ...b3.emails], ['degraded_clear'])
  // Shared state unreadable (per-data-center fallback): email on the first failed round.
  assert.deepEqual(h.planWatchRound(null, checks, '2026-10-13T06:00:00.000Z', { downRounds: 1 }).emails, ['down'])
  assert.equal(h.parseConnErrors('{"ok":true,"dbMs":5,"connErrors5m":7}'), 7)
})

test('crons: one run per cron per minute (2026-10-13 Cloudflare fired every slot twice, ~:04 and ~:43)', async () => {
  const c = await import('../ops/cron-slot')
  const at = (iso: string) => c.cronSlotMinute(Date.parse(iso))
  // The two copies of the 14:00 hot backup: same minute → the second skips.
  assert.equal(at('2026-10-13T14:00:04Z'), at('2026-10-13T14:00:43Z'))
  assert.equal(c.shouldRunCronSlot(undefined, at('2026-10-13T14:00:04Z')), true)
  assert.equal(c.shouldRunCronSlot(at('2026-10-13T14:00:04Z'), at('2026-10-13T14:00:43Z')), false)
  // Every-minute crons still run each minute.
  assert.equal(c.shouldRunCronSlot(at('2026-10-13T14:00:43Z'), at('2026-10-13T14:01:04Z')), true)
  assert.equal(c.shouldRunCronSlot(Number.NaN, 5), true, 'unreadable storage never blocks a run')
  assert.equal(c.cronSlotStorageKey('0 14 * * *'), 'betsy-cron-slot:0 14 * * *')

  const worker = read('src/cf-container-worker.ts')
  assert.match(worker, /if \(!\(await claimCronSlot\(env, controller\.cron, controller\.scheduledTime\)\)\) \{/)
  assert.ok(worker.indexOf('await claimCronSlot(env, controller.cron') < worker.indexOf('await healthWatch(env)'), 'claim before any work')
  assert.ok(worker.includes('this.ctx.storage.kv.get<number>(key)'), 'claim is atomic (sync KV) inside the Durable Object')
  assert.doesNotMatch(worker, /blockConcurrencyWhile\(/, 'a storage error must not reset the primary object')
  assert.match(worker, /slot check failed, running cron/, 'fail-open: a stuck object never stops backups')
})

test('backups: a second copy finding the lock taken is skipped, not a FALLÓ alert', async () => {
  const s = read('src/lib/backups/service.ts')
  assert.match(s, /if \(!lock\?\.ok\) throw new Error\(ALREADY_RUNNING\);/)
  for (const p of ['src/app/api/cron/backup/route.ts', 'src/app/api/cron/backup/hot/route.ts']) {
    const r = read(p)
    const skip = r.indexOf('if (isBackupAlreadyRunning(error))')
    assert.ok(skip > 0 && skip < r.indexOf('await sendOpsAlert('), `${p}: skip before the alert`)
    assert.match(r, /skipped: 'already_running'/)
  }
})
