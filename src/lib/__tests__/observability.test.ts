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
