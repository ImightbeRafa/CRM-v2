/**
 * PR-3 Bugbot follow-up — identity refresh must not stall GET /api/chat/accounts.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fetchInstagramPageIdentity } from '../meta-api'
import {
  IDENTITY_REFRESH_TIMEOUT_MS,
  refreshMissingAccountIdentities,
  type IdentityAccountRow,
  type IdentityRefreshJob,
} from '../social-account-identity-refresh'

function abortAfter(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      reject(err)
    }
    if (!signal) return
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function waRow(id: string): IdentityAccountRow {
  return {
    id,
    platform: 'whatsapp',
    accountId: '123456789012345',
    accessToken: 'tok',
    refreshToken: null,
    displayName: null,
    providerDisplayName: null,
    providerUsername: null,
    displayPhoneNumber: null,
    wabaId: 'waba-1',
    pageId: null,
    tokenLastCheckedAt: null,
  }
}

function igRow(id: string): IdentityAccountRow {
  return {
    id,
    platform: 'instagram',
    accountId: '17841400000000000',
    accessToken: 'tok',
    refreshToken: null,
    displayName: null,
    providerDisplayName: null,
    providerUsername: null,
    displayPhoneNumber: null,
    wabaId: null,
    pageId: 'page-1',
    tokenLastCheckedAt: null,
  }
}

describe('social-account-identity-refresh', () => {
  it('GET accounts route bounds Graph refresh with a timeout and still awaits it', () => {
    const src = readFileSync(resolve('src/app/api/chat/accounts/route.ts'), 'utf8')
    assert.match(src, /await refreshMissingAccountIdentities\(rows/)
    assert.match(src, /IDENTITY_REFRESH_TIMEOUT_MS/)
    assert.match(src, /timeoutMs:\s*IDENTITY_REFRESH_TIMEOUT_MS/)
    assert.equal(IDENTITY_REFRESH_TIMEOUT_MS, 2_000)
    assert.doesNotMatch(src, /void refreshMissingAccountIdentities/)
  })

  it('settles hung Graph within the request deadline and starts jobs concurrently', async () => {
    const starts: number[] = []
    const hung: IdentityRefreshJob = async (_row, signal) => {
      starts.push(Date.now())
      await hangUntilAbort(signal)
    }

    const t0 = Date.now()
    const result = await refreshMissingAccountIdentities([waRow('wa-1'), igRow('ig-1')], {
      timeoutMs: 80,
      claimSlot: async () => true,
      refreshWhatsApp: hung,
      refreshInstagram: hung,
    })
    const elapsed = Date.now() - t0

    assert.equal(result.attempted, 2)
    assert.equal(result.refreshed, 0)
    assert.equal(starts.length, 2)
    assert.ok(elapsed < 400, `expected settle <400ms, got ${elapsed}ms`)
    assert.ok(
      Math.abs(starts[1]! - starts[0]!) < 40,
      `expected concurrent starts, delta=${Math.abs(starts[1]! - starts[0]!)}ms`,
    )
  })

  it('one rejected account does not fail the rest of the batch', async () => {
    const result = await refreshMissingAccountIdentities([waRow('wa-1'), igRow('ig-1')], {
      timeoutMs: 200,
      claimSlot: async () => true,
      refreshWhatsApp: async () => {
        throw new Error('graph down')
      },
      refreshInstagram: async () => true,
    })
    assert.equal(result.attempted, 2)
    assert.equal(result.refreshed, 1)
  })

  it('does not claim a slot when identity is already present', async () => {
    let claims = 0
    const complete = {
      ...waRow('wa-ready'),
      displayPhoneNumber: '+506 6104 3737',
    }
    const result = await refreshMissingAccountIdentities([complete], {
      timeoutMs: 200,
      claimSlot: async () => {
        claims += 1
        return true
      },
      refreshWhatsApp: async () => true,
    })
    assert.equal(claims, 0)
    assert.equal(result.attempted, 0)
    assert.equal(result.refreshed, 0)
  })

  it('fetchInstagramPageIdentity returns fallback when Graph is aborted', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
      const signal = init?.signal
      await new Promise<void>((_resolve, reject) => {
        const abort = () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }
        if (signal?.aborted) {
          abort()
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
      })
      throw new Error('unreachable')
    }) as typeof fetch

    try {
      const t0 = Date.now()
      const fetched = await fetchInstagramPageIdentity({
        pageId: 'page-1',
        accessToken: 'tok',
        signal: abortAfter(50),
      })
      const elapsed = Date.now() - t0
      assert.equal(fetched.ok, false)
      assert.ok(elapsed < 400, `expected abort <400ms, got ${elapsed}ms`)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
