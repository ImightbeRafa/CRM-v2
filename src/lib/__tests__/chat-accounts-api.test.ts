/**
 * PR-3 — GET/PATCH /api/chat/accounts identity surfaces (source + helper assertions).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  needsIdentityRefresh,
  toChatAccountDto,
  validateDisplayNameInput,
} from '../social-account-identity'

describe('chat-accounts-api', () => {
  it('GET accounts route refreshes missing identity and returns §7.5 fields', () => {
    const src = readFileSync(resolve('src/app/api/chat/accounts/route.ts'), 'utf8')
    assert.match(src, /refreshMissingAccountIdentities/)
    assert.match(src, /toChatAccountDto/)
    assert.match(src, /displayName/)
    assert.match(src, /logoKey/)
    assert.match(src, /tokenStatus/)
  })

  it('PATCH accounts/:id requires update_config and validates displayName', () => {
    const src = readFileSync(resolve('src/app/api/chat/accounts/[id]/route.ts'), 'utf8')
    assert.match(src, /update_config/)
    assert.match(src, /validateDisplayNameInput/)
    assert.match(src, /defaultDisplayNameAtConnect/)
    assert.match(src, /status: 404/)
    const rbac = readFileSync(resolve('src/lib/rbac.ts'), 'utf8')
    assert.match(rbac, /PATCH \/api\/chat\/accounts\/\*: 'update_config'/)
  })

  it('toChatAccountDto never blanks displayName', () => {
    const dto = toChatAccountDto({
      id: 'a1',
      platform: 'whatsapp',
      accountId: '999988887777',
      linkedAt: new Date('2026-01-01'),
      isActive: true,
    })
    assert.equal(dto.displayName, 'WA · …7777')
    assert.equal(dto.logoKey, 'whatsapp')
    assert.equal(dto.tokenStatus, 'unknown')
  })

  it('needsIdentityRefresh only when provider fields missing and token present', () => {
    assert.equal(
      needsIdentityRefresh({
        platform: 'whatsapp',
        accessToken: 'tok',
        providerDisplayName: null,
        displayPhoneNumber: null,
      }),
      true,
    )
    assert.equal(
      needsIdentityRefresh({
        platform: 'whatsapp',
        accessToken: 'tok',
        displayPhoneNumber: '+506',
      }),
      false,
    )
    assert.equal(
      needsIdentityRefresh({
        platform: 'instagram',
        accessToken: null,
        providerUsername: null,
      }),
      false,
    )
  })

  it('empty PATCH displayName is treated as reset', () => {
    const v = validateDisplayNameInput('  ')
    assert.equal(v.ok, true)
    if (v.ok) assert.equal(v.reset, true)
  })
})
