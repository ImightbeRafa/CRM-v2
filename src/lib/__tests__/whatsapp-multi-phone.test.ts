import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  resolveExistingWhatsAppPhoneForWaba,
  whatsappAccountsForWabaWhere,
} from '../social-account-meta'

test('single existing account for the WABA is reused on reconnect', () => {
  const result = resolveExistingWhatsAppPhoneForWaba([{ id: 'sa-1', accountId: '106540352242922' }])
  assert.deepEqual(result, {
    ok: true,
    accountId: '106540352242922',
    socialAccountId: 'sa-1',
    source: 'single_waba',
  })
})

test('multiple accounts on one WABA are never resolved by picking the first', () => {
  const result = resolveExistingWhatsAppPhoneForWaba([
    { id: 'sa-1', accountId: '106540352242922' },
    { id: 'sa-2', accountId: '106540352242999' },
  ])
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'ambiguous_waba_accounts')
    assert.equal(result.candidateCount, 2)
  }
})

test('explicit phone_number_id wins even with several lines on the WABA', () => {
  const accounts = [
    { id: 'sa-1', accountId: '106540352242922' },
    { id: 'sa-2', accountId: '106540352242999' },
  ]
  assert.deepEqual(resolveExistingWhatsAppPhoneForWaba(accounts, '106540352242999'), {
    ok: true,
    accountId: '106540352242999',
    socialAccountId: 'sa-2',
    source: 'claimed',
  })
  // Claimed phone with no matching row is still honored (new line on the WABA).
  const fresh = resolveExistingWhatsAppPhoneForWaba(accounts, '555')
  assert.equal(fresh.ok && fresh.socialAccountId, null)
  assert.equal(fresh.ok && fresh.accountId, '555')
})

test('no existing account (or rows without accountId) falls through to the failure path', () => {
  assert.deepEqual(resolveExistingWhatsAppPhoneForWaba([]), {
    ok: false,
    reason: 'no_existing_account',
    candidateCount: 0,
  })
  const blank = resolveExistingWhatsAppPhoneForWaba([{ id: 'sa-1', accountId: '  ' }])
  assert.equal(blank.ok, false)
})

test('WABA account lookup is tenant-scoped and matches column or exact refreshToken', () => {
  const where = whatsappAccountsForWabaWhere('t-1', '102290129340398')
  assert.deepEqual(where, {
    tenantId: 't-1',
    platform: 'whatsapp',
    OR: [
      { wabaId: '102290129340398' },
      { refreshToken: { in: ['waba:102290129340398', '102290129340398'] } },
    ],
  })
  assert.equal(whatsappAccountsForWabaWhere('t-1', ''), null)
  assert.equal(whatsappAccountsForWabaWhere('t-1', null), null)
})

test('exchange route never findFirst-resolves a WhatsApp line by WABA alone', () => {
  const source = readFileSync('src/app/api/auth/whatsapp/exchange/route.ts', 'utf8')
  assert.doesNotMatch(source, /existingByWaba/)
  assert.doesNotMatch(source, /findFirst\(\{\s*where:\s*\{[^}]*wabaId/)
  assert.match(source, /resolveExistingWhatsAppPhoneForWaba/)
  assert.match(source, /whatsappAccountsForWabaWhere/)
  assert.match(source, /ambiguous_waba_accounts/)
  assert.match(source, /status:\s*422/)
})

test('WhatsApp connect/inbound paths resolve lines by phone accountId, not WABA', () => {
  for (const file of [
    'src/lib/chat-webhook-account.ts',
    'src/app/api/social/link/route.ts',
    'src/app/api/chat/send/route.ts',
  ]) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /socialAccount\.findFirst\(\{\s*where:\s*\{[^}]*(wabaId|whatsappBusinessAccountId)/, file)
  }
})
