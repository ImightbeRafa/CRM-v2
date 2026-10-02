/** One CSP source, own error tracking (Sentry removed), Turnstile off-by-default (security). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from '../turnstile'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('exactly one Content-Security-Policy source (next.config.js)', () => {
  const mw = read('src/middleware.ts')
  assert.doesNotMatch(mw, /Content-Security-Policy'/)
  assert.doesNotMatch(mw, /CSP_HEADER/)
  const cfg = read('next.config.js')
  assert.equal((cfg.match(/key: 'Content-Security-Policy'/g) || []).length, 1)
})

test('CSP: Turnstile allowed, Vercel preview hosts gone, blob storage kept', () => {
  const cfg = read('next.config.js')
  const csp = cfg.split("key: 'Content-Security-Policy'")[1].split('].join')[0]
  for (const dir of ['script-src', 'frame-src', 'connect-src']) {
    const line = csp.split('\n').find((l) => l.includes(`"${dir} `)) || ''
    assert.match(line, /https:\/\/challenges\.cloudflare\.com/, dir)
  }
  assert.doesNotMatch(csp, /vercel\.live|\*\.vercel\.app/)
  assert.match(csp, /\*\.vercel-storage\.com/)
  assert.match(csp, /"form-action 'self'"/)
  assert.match(cfg, /value: 'strict-origin-when-cross-origin'/)
})

test('Sentry is gone: no SDK, no relay, no Sentry host in the CSP (replaced by own tracking, 2026-10-02)', () => {
  const cfg = read('next.config.js')
  assert.doesNotMatch(cfg, /@sentry\/nextjs|withSentryConfig|ingest\.us\.sentry\.io/)
  assert.doesNotMatch(read('package.json'), /"@sentry\/nextjs"/)
  for (const f of ['instrumentation.ts', 'instrumentation-client.ts', 'src/app/error.tsx', 'src/app/global-error.tsx', 'src/middleware.ts']) {
    assert.doesNotMatch(read(f), /from ['"]@sentry\//, f)
  }
  assert.doesNotMatch(read('src/middleware.ts'), /'\/monitoring'/)
  assert.match(read('src/middleware.ts'), /'\/api\/client-errors',/)
})

test('own error tracking: browser reports are same-origin, rate limited, size capped and scrubbed', () => {
  const route = read('src/app/api/client-errors/route.ts')
  assert.match(route, /if \(!sameOrigin\(request\)\) return new NextResponse\(null, \{ status: 403 \}\)/)
  assert.match(route, /createIdentifierRateLimit\(\{ windowMs: 60_000, maxRequests: 10/)
  assert.match(route, /const MAX_BYTES = 8 \* 1024/)
  assert.match(route, /if \(text === null\) return new NextResponse\(null, \{ status: 413 \}\)/)
  const reporter = read('src/lib/observability/report-error.ts')
  assert.match(reporter, /message: clip\(scrubPii\(report\.message \|\| ''\), 500\)/)
  // The console wrapper records only the Error object, never the other arguments.
  assert.match(reporter, /const err = args\.find\(\(a\): a is Error => a instanceof Error\)/)
  assert.match(read('instrumentation.ts'), /installConsoleErrorCapture\(\)/)
  assert.match(read('src/app/error.tsx'), /reportClientError\(error, \{ digest: error\.digest \}\)/)
})

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
}

const never = (async () => {
  throw new Error('must not call Cloudflare')
}) as unknown as typeof fetch

test('Turnstile is OFF unless both keys exist (no call, always ok)', async () => {
  for (const env of [{}, { TURNSTILE_SITE_KEY: 'site' }, { TURNSTILE_SECRET_KEY: 'secret' }]) {
    await withEnv({ TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined, ...env }, async () => {
      assert.equal(turnstileEnabled(), false)
      assert.equal(turnstileSiteKey(), null)
      assert.deepEqual(await verifyTurnstile(undefined, '1.2.3.4', never), { ok: true })
    })
  }
})

test('Turnstile ON fails closed: missing token, rejected token, unreachable Cloudflare', async () => {
  await withEnv({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }, async () => {
    assert.equal(turnstileSiteKey(), 'site')
    assert.equal((await verifyTurnstile('', null, never)).ok, false)
    const reject = (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch
    assert.equal((await verifyTurnstile('tok', null, reject)).ok, false)
    assert.equal((await verifyTurnstile('tok', null, never)).ok, false)
    let sent = ''
    const accept = (async (_u: unknown, init?: RequestInit) => {
      sent = String(init?.body)
      return new Response(JSON.stringify({ success: true }))
    }) as unknown as typeof fetch
    assert.deepEqual(await verifyTurnstile('tok', '1.2.3.4', accept), { ok: true })
    assert.match(sent, /secret=secret/)
    assert.match(sent, /remoteip=1\.2\.3\.4/)
  })
})

test('Turnstile guards signup and password reset; worker forwards the keys', () => {
  for (const f of ['src/app/api/auth/register/route.ts', 'src/app/api/auth/forgot-password/route.ts']) {
    assert.match(read(f), /verifyTurnstile\(turnstileToken, getClientIP\(request\)\)/, f)
  }
  const w = read('src/cf-container-worker.ts')
  assert.match(w, /"TURNSTILE_SITE_KEY",\n\s+"TURNSTILE_SECRET_KEY",/)
})

test('Meta Pixel never loads on a URL carrying a one-time token; no automatic SPA pageviews (INT-01)', () => {
  const src = read('src/app/components/MetaPixel.tsx')
  assert.match(src, /\(function \(\) \{\s*if \(\/\(\?:\[\?&#\]\|%3F\|%26\|%23\)\(\?:token\|code\)\(\?:=\|%3D\)\/i\.test\(window\.location\.href\)\) \{ return; \}/)
  assert.match(src, /fbq\.disablePushState = true;/)
  const guard = /(?:[?&#]|%3F|%26|%23)(?:token|code)(?:=|%3D)/i
  assert.ok(guard.test('https://www.betsycrm.com/auth/reset-password?token=abc'))
  assert.ok(guard.test('https://www.betsycrm.com/auth/signin?callbackUrl=%2Fauth%2Fverify-email%3Ftoken%3Dabc'))
  assert.ok(!guard.test('https://www.betsycrm.com/home?plan=pro'))
})

test('error scrub: tokens redacted raw / encoded / before a JSON escape; unparsable → dropped', async () => {
  const { scrubTokens, scrubEvent } = await import('../observability/scrub')
  assert.equal(scrubTokens('/auth/reset-password?token=abc&x=1'), '/auth/reset-password?token=[redacted]&x=1')
  assert.match(scrubTokens('callbackUrl=%2Fauth%2Fverify-email%3Ftoken%3Dabc123'), /%3Ftoken%3D\[redacted\]/)
  const ev = scrubEvent({ message: 'url="/auth/reset-password?token=abc\\"x"' })
  assert.ok(ev && !JSON.stringify(ev).includes('abc'))
})
