import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

// In-memory fallback only: deterministic, no shared Redis bucket across test runs.
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

const { guardFinanceApi } = await import('@/lib/finance-auth')

function makeKey(label: string): string {
  return `test-finance-key-${label}-` + 'a'.repeat(32)
}

function makeReq(ip: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://betsy.test/api/finance/v1/meta', {
    headers: { 'cf-connecting-ip': ip, ...headers },
  })
}

async function silence<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn
  const error = console.error
  console.warn = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.warn = warn
    console.error = error
  }
}

function saveEnv() {
  return {
    FINANCE_API_KEY: process.env.FINANCE_API_KEY,
    FINANCE_API_KEY_PREVIOUS: process.env.FINANCE_API_KEY_PREVIOUS,
    TRUSTED_IP_HEADER: process.env.TRUSTED_IP_HEADER,
  }
}

function restoreEnv(saved: ReturnType<typeof saveEnv>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test('a: 50 valid-key calls in a row from one IP are all allowed', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  const key = makeKey('a')
  process.env.FINANCE_API_KEY = key
  delete process.env.FINANCE_API_KEY_PREVIOUS
  try {
    const ip = '10.0.1.1'
    for (let i = 0; i < 50; i++) {
      const res = await guardFinanceApi(makeReq(ip, { 'x-api-key': key }))
      assert.equal(res, null, `call ${i} should be allowed`)
    }
  } finally {
    restoreEnv(saved)
  }
})

test('b: valid key via Authorization: Bearer header is allowed', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  const key = makeKey('b')
  process.env.FINANCE_API_KEY = key
  delete process.env.FINANCE_API_KEY_PREVIOUS
  try {
    const ip = '10.0.1.2'
    const res = await guardFinanceApi(makeReq(ip, { authorization: `Bearer ${key}` }))
    assert.equal(res, null)
  } finally {
    restoreEnv(saved)
  }
})

test('c: a bad key under the limit gets 401 Unauthorized', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  process.env.FINANCE_API_KEY = makeKey('c-real')
  delete process.env.FINANCE_API_KEY_PREVIOUS
  try {
    const ip = '10.0.1.3'
    const res = await silence(() => guardFinanceApi(makeReq(ip, { 'x-api-key': makeKey('c-wrong') })))
    assert.ok(res)
    assert.equal(res!.status, 401)
    assert.deepEqual(await res!.json(), { error: 'Unauthorized' })
  } finally {
    restoreEnv(saved)
  }
})

test('d: bad-key burst: 30 calls get 401, the 31st gets 429', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  process.env.FINANCE_API_KEY = makeKey('d-real')
  delete process.env.FINANCE_API_KEY_PREVIOUS
  try {
    const ip = '10.0.1.4'
    const wrongKey = makeKey('d-wrong')
    for (let i = 0; i < 30; i++) {
      const res = await silence(() => guardFinanceApi(makeReq(ip, { 'x-api-key': wrongKey })))
      assert.equal(res!.status, 401, `call ${i}`)
    }
    const res31 = await silence(() => guardFinanceApi(makeReq(ip, { 'x-api-key': wrongKey })))
    assert.equal(res31!.status, 429)
    assert.deepEqual(await res31!.json(), { error: 'Too many requests' })
  } finally {
    restoreEnv(saved)
  }
})

test('e: no key configured returns 503 regardless of the provided key', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  delete process.env.FINANCE_API_KEY
  delete process.env.FINANCE_API_KEY_PREVIOUS
  try {
    const resNoKey = await silence(() => guardFinanceApi(makeReq('10.0.1.5')))
    assert.equal(resNoKey!.status, 503)
    assert.deepEqual(await resNoKey!.json(), { error: 'Finance API unavailable' })

    const resWithKey = await silence(() => guardFinanceApi(makeReq('10.0.1.6', { 'x-api-key': makeKey('e') })))
    assert.equal(resWithKey!.status, 503)
    assert.deepEqual(await resWithKey!.json(), { error: 'Finance API unavailable' })

    // Configured but under the 24-char floor counts as "not configured".
    process.env.FINANCE_API_KEY = 'short'
    const resShortKey = await silence(() => guardFinanceApi(makeReq('10.0.1.7', { 'x-api-key': 'short' })))
    assert.equal(resShortKey!.status, 503)
    assert.deepEqual(await resShortKey!.json(), { error: 'Finance API unavailable' })
  } finally {
    restoreEnv(saved)
  }
})

test('f: FINANCE_API_KEY_PREVIOUS still authenticates alongside FINANCE_API_KEY', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  const newKey = makeKey('f-new')
  const oldKey = makeKey('f-old')
  process.env.FINANCE_API_KEY = newKey
  process.env.FINANCE_API_KEY_PREVIOUS = oldKey
  try {
    const resOld = await guardFinanceApi(makeReq('10.0.1.8', { 'x-api-key': oldKey }))
    assert.equal(resOld, null)

    const resNew = await guardFinanceApi(makeReq('10.0.1.9', { 'x-api-key': newKey }))
    assert.equal(resNew, null)

    const resThird = await silence(() => guardFinanceApi(makeReq('10.0.1.10', { 'x-api-key': makeKey('f-third') })))
    assert.equal(resThird!.status, 401)
  } finally {
    restoreEnv(saved)
  }
})

test('g: a valid-key flood does not consume the anonymous burst bucket', async () => {
  const saved = saveEnv()
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  const validKey = makeKey('g-valid')
  process.env.FINANCE_API_KEY = validKey
  delete process.env.FINANCE_API_KEY_PREVIOUS
  try {
    const ip = '10.0.1.11'
    for (let i = 0; i < 40; i++) {
      const res = await guardFinanceApi(makeReq(ip, { 'x-api-key': validKey }))
      assert.equal(res, null, `call ${i}`)
    }
    const resBad = await silence(() => guardFinanceApi(makeReq(ip, { 'x-api-key': makeKey('g-wrong') })))
    assert.equal(resBad!.status, 401)
  } finally {
    restoreEnv(saved)
  }
})
