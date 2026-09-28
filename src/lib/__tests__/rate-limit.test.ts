import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getClientIP, normalizeClientIp, pruneMemoryStore, rateLimitAsync } from '@/lib/rate-limit'

const req = (headers: Record<string, string>) => new Request('https://x.test/', { headers })

test('behind Cloudflare, a spoofed X-Forwarded-For cannot pick the rate-limit key', () => {
  const prev = process.env.TRUSTED_IP_HEADER
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  try {
    assert.equal(
      getClientIP(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'cf-connecting-ip': '203.0.113.9' })),
      '203.0.113.9',
    )
    // Header missing (e.g. internal cron fetch): fixed bucket, never the spoofable headers.
    assert.equal(getClientIP(req({ 'x-real-ip': '10.0.0.1', 'x-forwarded-for': '6.6.6.6' })), 'trusted-header-missing')
    // IPv6: one bucket per /64 so rotating inside a customer network does not reset limits.
    assert.equal(getClientIP(req({ 'cf-connecting-ip': '2001:db8:abcd:12:1::5' })), '2001:db8:abcd:12::/64')
    assert.equal(getClientIP(req({ 'cf-connecting-ip': '2001:db8:abcd:12:ffff::9' })), '2001:db8:abcd:12::/64')
  } finally {
    if (prev === undefined) delete process.env.TRUSTED_IP_HEADER
    else process.env.TRUSTED_IP_HEADER = prev
  }
})

test('without TRUSTED_IP_HEADER the legacy order is unchanged (Railway / local)', () => {
  const prev = process.env.TRUSTED_IP_HEADER
  delete process.env.TRUSTED_IP_HEADER
  try {
    assert.equal(getClientIP(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '1.1.1.1')
    assert.equal(getClientIP(req({})), 'unknown')
  } finally {
    if (prev !== undefined) process.env.TRUSTED_IP_HEADER = prev
  }
})

test('Cloudflare worker always tells the container to trust cf-connecting-ip', () => {
  assert.match(readFileSync('src/cf-container-worker.ts', 'utf8'), /envVars\.TRUSTED_IP_HEADER = "cf-connecting-ip"/)
})

test('memory fallback store is bounded and Redis calls time out', () => {
  const src = readFileSync('src/lib/rate-limit.ts', 'utf8')
  assert.match(src, /MEMORY_STORE_MAX/)
  assert.match(src, /timeout: 1000/)
  assert.match(src, /ephemeralCache: new Map\(\)/)
})

test('AUTH-P2: an Upstash timeout (success:true, reason:timeout) is enforced by the memory limiter', async () => {
  const timeoutLimiter = { limit: async () => ({ success: true, limit: 0, remaining: 0, reset: 0, reason: 'timeout' }) } as any
  const cfg = { maxRequests: 2, windowMs: 60_000, prefix: `t-${Date.now()}` }
  const results = []
  for (let i = 0; i < 3; i++) results.push((await rateLimitAsync('same-ip', timeoutLimiter, cfg)).allowed)
  assert.deepEqual(results, [true, true, false])
})

test('AUTH-P1: pruning a flooded store keeps live blocks (e.g. a locked login)', () => {
  const now = Date.now()
  const store = new Map<string, { count: number; resetTime: number; limit: number }>()
  store.set('login:victim', { count: 11, resetTime: now + 900_000, limit: 10 }) // blocked, oldest key
  for (let i = 0; i < 99; i++) store.set(`login:junk${i}`, { count: 1, resetTime: now + 900_000, limit: 10 })
  pruneMemoryStore(now, store, 100)
  assert.ok(store.has('login:victim'), 'blocked entry survives the flood')
  assert.ok(store.size <= 50)
})

test('normalizeClientIp keeps IPv4 and brackets-free IPv6 /64', () => {
  assert.equal(normalizeClientIp('203.0.113.9'), '203.0.113.9')
  assert.equal(normalizeClientIp('[2001:db8::1]'), '2001:db8:0:0::/64')
})

test('AUTH-P6: IPv4-mapped IPv6 is the IPv4 client; zero-padded groups share a bucket', () => {
  assert.equal(normalizeClientIp('::ffff:198.51.100.7'), '198.51.100.7')
  assert.equal(normalizeClientIp('2001:0db8:00ab:0012::1'), normalizeClientIp('2001:db8:ab:12::9'))
})
