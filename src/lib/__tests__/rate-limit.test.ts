import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getClientIP } from '@/lib/rate-limit'

const req = (headers: Record<string, string>) => new Request('https://x.test/', { headers })

test('behind Cloudflare, a spoofed X-Forwarded-For cannot pick the rate-limit key', () => {
  const prev = process.env.TRUSTED_IP_HEADER
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  try {
    assert.equal(
      getClientIP(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'cf-connecting-ip': '203.0.113.9' })),
      '203.0.113.9',
    )
    // Header missing (e.g. internal cron fetch) → previous behaviour, never throws.
    assert.equal(getClientIP(req({ 'x-real-ip': '10.0.0.1' })), '10.0.0.1')
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
