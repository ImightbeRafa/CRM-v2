/** One CSP source, Sentry tunnel, Turnstile off-by-default (security, 2026-09-28). */
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

test('Sentry: own relay (no cookie-forwarding rewrite), tokens scrubbed, replay masked', () => {
  assert.doesNotMatch(read('next.config.js'), /^\s*tunnelRoute:/m, 'the rewrite tunnel forwarded cookies (M6)')
  assert.match(read('src/middleware.ts'), /'\/monitoring'/)
  const client = read('instrumentation-client.ts')
  assert.match(client, /tunnel: "\/monitoring"/)
  assert.match(client, /maskAllText: true,\s*maskAllInputs: true,\s*blockAllMedia: true/)
  assert.match(client, /beforeSend: \(event\) => scrubEvent\(event\)/)
  const relay = read('src/app/monitoring/route.ts')
  assert.match(relay, /headers: \{ 'Content-Type': 'application\/x-sentry-envelope' \}/, 'only the body goes upstream')
  assert.match(relay, /MAX_ENVELOPE_BYTES/)
})

test('Sentry relay only accepts this app\'s DSN', async () => {
  const { sentryEnvelopeTarget, SENTRY_DSN } = await import('../sentry-tunnel')
  const env = (dsn: string) => new TextEncoder().encode(`${JSON.stringify({ dsn })}\n{"type":"event"}\n{}`)
  assert.match(sentryEnvelopeTarget(env(SENTRY_DSN)) || '', /^https:\/\/o4511109425725440\.ingest\.us\.sentry\.io\/api\/4511109427494912\/envelope\/$/)
  assert.equal(sentryEnvelopeTarget(env('https://abc@o1.ingest.us.sentry.io/42')), null)
  assert.equal(sentryEnvelopeTarget(env('https://34154b8e86072342dbf9c6e55236e963@evil.example/4511109427494912')), null)
  assert.equal(sentryEnvelopeTarget(new TextEncoder().encode('not json')), null)
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

test('Sentry scrub: tokens redacted raw / encoded / before a JSON escape; unparsable → dropped', async () => {
  const { scrubTokens, scrubEvent } = await import('../sentry-scrub')
  assert.equal(scrubTokens('/auth/reset-password?token=abc&x=1'), '/auth/reset-password?token=[redacted]&x=1')
  assert.match(scrubTokens('callbackUrl=%2Fauth%2Fverify-email%3Ftoken%3Dabc123'), /%3Ftoken%3D\[redacted\]/)
  const ev = scrubEvent({ message: 'url="/auth/reset-password?token=abc\\"x"' })
  assert.ok(ev && !JSON.stringify(ev).includes('abc'))
})
