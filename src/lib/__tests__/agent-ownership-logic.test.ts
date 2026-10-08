/**
 * F1 ownership / gate logic, exercised for real (not by reading source text).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedOrderLink, phoneOwnsOrder } from '@/lib/soft-ai/order-ownership'
import { orderMatchesOwnership, parseOrderOwnership, hasOwnershipStamp } from '@/lib/soft-ai/agent-settings'
import { agentWindowOpen } from '@/lib/soft-ai/agent-claim-gates'
import { aiNoReplyDedupeKey, AI_NO_REPLY_ALERT_REASONS } from '@/lib/soft-ai/ai-no-reply'

describe('only a PERSON’s order link counts as ownership', () => {
  it('AI-written links (legacy v1 replies) are never trusted', () => {
    assert.equal(isTrustedOrderLink({ direction: 'outbound', senderUserId: null, metadata: { softAi: true } }), false)
    assert.equal(isTrustedOrderLink({ direction: 'outbound', senderUserId: 'u1', metadata: { softAi: true } }), false)
    assert.equal(isTrustedOrderLink({ direction: 'outbound', senderUserId: null, metadata: {} }), false)
  })
  it('Vincular pedido (inbound row) and a person’s own outbound message are trusted', () => {
    assert.equal(isTrustedOrderLink({ direction: 'inbound', senderUserId: null, metadata: null }), true)
    assert.equal(isTrustedOrderLink({ direction: 'outbound', senderUserId: 'u1', metadata: { guiaId: 'g' } }), true)
  })
})

describe('business stamp (one tenant, several stores)', () => {
  const forge = parseOrderOwnership({ sources: ['Forge Costa Rica Website'], salesChannels: ['WhatsApp Forge'], funnels: [] })
  it('matches its own stamps case-insensitively, never another store’s', () => {
    assert.equal(orderMatchesOwnership(forge, { customFields: { source: 'forge costa rica website' } }), true)
    assert.equal(orderMatchesOwnership(forge, { salesChannel: ' WhatsApp Forge ' }), true)
    assert.equal(orderMatchesOwnership(forge, { customFields: { source: 'Prototipo CR Website' } }), false)
    assert.equal(orderMatchesOwnership(forge, { salesChannel: null, funnel: null, customFields: null }), false)
  })
  it('an empty stamp never matches anything (only chat links count)', () => {
    const empty = parseOrderOwnership({})
    assert.equal(hasOwnershipStamp(empty), false)
    assert.equal(orderMatchesOwnership(empty, { salesChannel: '', funnel: '', customFields: { source: '' } }), false)
  })
  it('junk input is cleaned (non-strings dropped, deduped, capped)', () => {
    const o = parseOrderOwnership({ sources: ['A', 'a', 3, '', ' B '], salesChannels: 'x' })
    assert.deepEqual(o.sources, ['A', 'B'])
    assert.deepEqual(o.salesChannels, [])
  })
})

describe('phone ownership by platform', () => {
  it('a WhatsApp peer id is a phone (last 8 digits)', async () => {
    assert.equal(await phoneOwnsOrder({ tenantId: 't', peerId: '50688881111', platform: 'whatsapp' }, { phone: '8888-1111' }), true)
    assert.equal(await phoneOwnsOrder({ tenantId: 't', peerId: '50688881111', platform: 'whatsapp' }, { phone: '8888-2222' }), false)
  })
  it('an Instagram id is never treated as a phone', async () => {
    assert.equal(await phoneOwnsOrder({ tenantId: 't', peerId: '17841488881111', platform: 'instagram' }, { phone: '88881111' }), false)
  })
  it('placeholder phones never match anyone', async () => {
    assert.equal(await phoneOwnsOrder({ tenantId: 't', peerId: '50688881111', platform: 'whatsapp' }, { phone: '0' }), false)
  })
})

describe('agent reply window (WhatsApp + Instagram: 24h, no templates / HUMAN_AGENT for the AI)', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  it('open within 24h, closed after, closed without an inbound', () => {
    assert.equal(agentWindowOpen('whatsapp', new Date(now - 23 * 3600_000), now), true)
    assert.equal(agentWindowOpen('instagram', new Date(now - 23 * 3600_000), now), true)
    assert.equal(agentWindowOpen('instagram', new Date(now - 25 * 3600_000), now), false)
    assert.equal(agentWindowOpen('whatsapp', null, now), false)
    assert.equal(agentWindowOpen('messenger', new Date(now), now), false)
  })
})

describe('"La IA no respondió" alerts', () => {
  it('one key per chat per 30 min; expected silences never alert', () => {
    const t = Date.parse('2026-10-08T12:00:00Z')
    assert.equal(aiNoReplyDedupeKey('c1', 'needs_human', t), aiNoReplyDedupeKey('c1', 'needs_human', t + 10 * 60_000))
    assert.notEqual(aiNoReplyDedupeKey('c1', 'needs_human', t), aiNoReplyDedupeKey('c1', 'needs_human', t + 31 * 60_000))
    for (const quiet of ['human_replied', 'paused_before_send', 'human_before_send', 'superseded', 'kill_switch', 'missing_mode']) {
      assert.equal(AI_NO_REPLY_ALERT_REASONS.has(quiet), false, quiet)
    }
    for (const loud of ['needs_human', 'escalate', 'not_activated', 'window_closed', 'budget_blocked']) {
      assert.equal(AI_NO_REPLY_ALERT_REASONS.has(loud), true, loud)
    }
  })
})
