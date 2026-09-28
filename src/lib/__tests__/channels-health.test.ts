import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyChannelHealth,
  filterByTab,
  formatRelativeEs,
  isOwnerChannel,
  summarizeChannels,
} from '../../app/config/social/channel-health'
import type { SocialAccount } from '../../app/config/social/types'

function acc(over: Partial<SocialAccount>): SocialAccount {
  return {
    id: over.id ?? 'a1',
    platform: 'whatsapp',
    accountId: '123',
    linkedAt: '2026-01-01T00:00:00Z',
    isActive: true,
    tokenStatus: 'valid',
    ...over,
  }
}

test('one SocialAccount = one row; staff/other platforms are hidden', () => {
  assert.equal(isOwnerChannel({ platform: 'whatsapp' }), true)
  assert.equal(isOwnerChannel({ platform: 'instagram' }), true)
  assert.equal(isOwnerChannel({ platform: 'telegram' }), false)
  assert.equal(isOwnerChannel({ platform: 'staff_bot' }), false)
})

test('health classification maps token / webhook state to actions', () => {
  assert.deepEqual(
    [classifyChannelHealth(acc({})).label, classifyChannelHealth(acc({})).action],
    ['Saludable', 'diagnose'],
  )
  assert.equal(classifyChannelHealth(acc({ isActive: false })).action, 'repair')
  assert.equal(classifyChannelHealth(acc({ tokenStatus: 'expired' })).action, 'reconnect')
  assert.equal(classifyChannelHealth(acc({ tokenStatus: 'expiring' })).needsAction, true)
  assert.equal(
    classifyChannelHealth(acc({ isActive: false, disconnectedAt: '2026-02-01T00:00:00Z' })).action,
    'reconnect',
  )
  const unknown = classifyChannelHealth(acc({ tokenStatus: 'unknown' }))
  assert.equal(unknown.healthy, false)
  assert.equal(unknown.needsAction, false)
})

test('summary counts come only from real accounts', () => {
  const s = summarizeChannels([
    acc({ id: '1' }),
    acc({ id: '2', tokenStatus: 'unknown' }),
    acc({ id: '3', isActive: false }),
    acc({ id: '4', platform: 'instagram', tokenStatus: 'revoked' }),
  ])
  assert.deepEqual(s, {
    connected: 3,
    connectedWhatsApp: 2,
    connectedInstagram: 1,
    healthy: 1,
    needsAction: 2,
    webhookDown: 1,
    tokenIssues: 1,
  })
  assert.equal(summarizeChannels([]).connected, 0)
})

test('tabs filter client-side by platform', () => {
  const list = [acc({ id: '1' }), acc({ id: '2', platform: 'instagram' })]
  assert.equal(filterByTab(list, 'all').length, 2)
  assert.deepEqual(filterByTab(list, 'instagram').map((a) => a.id), ['2'])
})

test('formatRelativeEs', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  assert.equal(formatRelativeEs(null, now), null)
  assert.equal(formatRelativeEs('2026-09-26T11:58:00Z', now), 'hace 2 min')
  assert.equal(formatRelativeEs('2026-09-26T09:00:00Z', now), 'hace 3 h')
  assert.equal(formatRelativeEs('2026-09-24T12:00:00Z', now), 'hace 2 días')
})
