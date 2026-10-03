import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { isSameOriginJson, isSameOriginRequest } from '@/lib/same-origin'

// Inside the standalone container Next builds route URLs on http://0.0.0.0:3000 (INT-43): the public origin must
// come from the Host header, never from nextUrl.origin.
const req = (headers: Record<string, string>) =>
  new NextRequest('http://0.0.0.0:3000/api/chat/agents/ai-terms', { method: 'POST', headers })

describe('same-origin guard (INT-43/46)', () => {
  it('accepts the real site behind the container URL', () => {
    const ok = req({
      host: 'www.betsycrm.com',
      origin: 'https://www.betsycrm.com',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    })
    assert.equal(isSameOriginJson(ok), true)
  })
  it('refuses another site, cross-site fetches and non-JSON bodies', () => {
    assert.equal(isSameOriginRequest(req({ host: 'www.betsycrm.com', origin: 'https://evil.example' })), false)
    assert.equal(isSameOriginRequest(req({ host: 'www.betsycrm.com', origin: 'https://www.betsycrm.com', 'sec-fetch-site': 'cross-site' })), false)
    assert.equal(
      isSameOriginJson(req({ host: 'www.betsycrm.com', origin: 'https://www.betsycrm.com', 'content-type': 'text/plain' })),
      false,
    )
  })
  it('a client without Origin (not a browser) is left to the session cookie', () => {
    assert.equal(isSameOriginRequest(req({ host: 'www.betsycrm.com' })), true)
  })
})
