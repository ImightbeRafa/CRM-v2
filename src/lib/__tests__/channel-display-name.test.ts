/**
 * PR-3 — channel display name fallback chain + validation (§7.2).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  defaultDisplayNameAtConnect,
  formatCanalContextLine,
  formatInstagramHandle,
  formatThreadChannelMeta,
  resolveChannelDisplayName,
  syntheticChannelFallback,
  validateDisplayNameInput,
} from '../social-account-identity'
import { softAiCanalContextLine } from '../soft-ai/channel-context'
import { accountDisplayLabel } from '../chat-soft-copilot'

describe('channel-display-name', () => {
  it('fallback chain prefers displayName then provider then address then synthetic', () => {
    assert.equal(
      resolveChannelDisplayName({
        id: '1',
        platform: 'whatsapp',
        accountId: '123456789012345',
        displayName: 'Forge',
        providerDisplayName: 'Meta Store',
        displayPhoneNumber: '+506 6104 3737',
      }),
      'Forge',
    )
    assert.equal(
      resolveChannelDisplayName({
        id: '1',
        platform: 'whatsapp',
        accountId: '123456789012345',
        providerDisplayName: 'Meta Store',
        displayPhoneNumber: '+506 6104 3737',
      }),
      'Meta Store',
    )
    assert.equal(
      resolveChannelDisplayName({
        id: '1',
        platform: 'whatsapp',
        accountId: '123456789012345',
        displayPhoneNumber: '+506 6104 3737',
      }),
      '+506 6104 3737',
    )
    assert.equal(
      resolveChannelDisplayName({
        id: '1',
        platform: 'whatsapp',
        accountId: '123456789012345',
        phoneNumberId: '123456789012345',
      }),
      'WA · …2345',
    )
  })

  it('IG never treats numeric accountId as @handle', () => {
    assert.equal(formatInstagramHandle('17841400000000000'), null)
    assert.equal(formatInstagramHandle('betsy_crm'), '@betsy_crm')
    assert.equal(formatInstagramHandle('@shop'), '@shop')
    assert.equal(
      resolveChannelDisplayName({
        id: 'ig1',
        platform: 'instagram',
        accountId: '17841400000000000',
      }),
      'IG · …0000',
    )
    assert.equal(
      resolveChannelDisplayName({
        id: 'ig1',
        platform: 'instagram',
        accountId: '17841400000000000',
        providerUsername: 'betsy_crm',
      }),
      '@betsy_crm',
    )
    assert.equal(
      accountDisplayLabel({
        id: 'ig1',
        platform: 'instagram',
        accountId: '17841400000000000',
        isActive: true,
      }),
      'IG · …0000',
    )
  })

  it('validateDisplayNameInput enforces §7.2 rules', () => {
    assert.deepEqual(validateDisplayNameInput('Forge'), {
      ok: true,
      value: 'Forge',
      reset: false,
    })
    assert.equal(validateDisplayNameInput('').reset, true)
    assert.equal(validateDisplayNameInput('   ').reset, true)
    assert.equal(validateDisplayNameInput('a'.repeat(40)).ok, true)
    assert.equal(validateDisplayNameInput('a'.repeat(41)).ok, false)
    assert.equal(validateDisplayNameInput('Bad\nname').ok, false)
    assert.equal(validateDisplayNameInput('Hello!').ok, false)
    assert.equal(validateDisplayNameInput("Cafe & Co.’s").ok, true)
    assert.deepEqual(validateDisplayNameInput('@betsy_crm'), {
      ok: true,
      value: '@betsy_crm',
      reset: false,
    })
    assert.deepEqual(validateDisplayNameInput('+506 6104 3737'), {
      ok: true,
      value: '+506 6104 3737',
      reset: false,
    })
    assert.equal(validateDisplayNameInput('Bad#name').ok, false)
  })

  it('default at connect follows WA verified_name / phone and IG @username', () => {
    assert.equal(
      defaultDisplayNameAtConnect({
        platform: 'whatsapp',
        providerDisplayName: 'Forge Store',
        displayPhoneNumber: '+506 1',
      }),
      'Forge Store',
    )
    assert.equal(
      defaultDisplayNameAtConnect({
        platform: 'whatsapp',
        displayPhoneNumber: '+506 6104 3737',
      }),
      '+506 6104 3737',
    )
    assert.equal(
      defaultDisplayNameAtConnect({
        platform: 'instagram',
        providerUsername: 'betsy_crm',
      }),
      '@betsy_crm',
    )
  })

  it('Canal and thread meta lines never blank', () => {
    assert.equal(
      formatCanalContextLine({
        id: '1',
        platform: 'whatsapp',
        accountId: 'x',
        displayName: 'Forge',
      }),
      'Canal: WhatsApp · Forge',
    )
    assert.equal(
      softAiCanalContextLine({
        id: '1',
        platform: 'instagram',
        accountId: '17841',
        providerUsername: 'shop',
      }),
      'Canal: Instagram · @shop',
    )
    assert.equal(
      formatThreadChannelMeta({
        id: '1',
        platform: 'whatsapp',
        accountId: 'pnid',
        displayName: 'Forge',
        displayPhoneNumber: '+506 6104 3737',
      }),
      'WhatsApp · Forge · +506 6104 3737',
    )
    assert.ok(syntheticChannelFallback({ id: '1', platform: 'whatsapp', accountId: '' }))
  })
})
