import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { verifyMetaWebhookSignature } from '../meta-api'
import { parseMetaChatPayload } from '../meta-chat'
import {
  buildSignedWhatsAppFixture,
  CHAT_WEBHOOK_FIXTURE_SECRET,
  signMetaWebhookBody,
} from '../../../tests/fixtures/chat-webhook/signed-payload'
import { createBurstStore, runWebhookBurst } from '../../../scripts/chat-webhook-burst'

describe('chat-webhook fixture + burst (acceptance 4.5 unit)', () => {
  it('signs payloads that verifyMetaWebhookSignature accepts', () => {
    const fixture = buildSignedWhatsAppFixture({ accountIndex: 0, eventIndex: 1 })
    const result = verifyMetaWebhookSignature(fixture.rawBody, fixture.signatureHeader, {
      META_APP_SECRET: CHAT_WEBHOOK_FIXTURE_SECRET,
    })
    assert.equal(result.valid, true)
    assert.equal(fixture.signatureHeader, signMetaWebhookBody(fixture.rawBody))
  })

  it('parses fixture into inbound whatsapp messages', () => {
    const fixture = buildSignedWhatsAppFixture({ accountIndex: 2, eventIndex: 9 })
    const parsed = parseMetaChatPayload(JSON.parse(fixture.rawBody))
    assert.equal(parsed.messages.length, 1)
    assert.equal(parsed.messages[0]?.platform, 'whatsapp')
    assert.equal(parsed.messages[0]?.accountId, fixture.accountId)
    assert.equal(parsed.messages[0]?.providerMessageId, fixture.providerMessageId)
  })

  it('in-memory store dedupes providerMessageId per account', async () => {
    const store = createBurstStore()
    const first = await store.persist({
      socialAccountKey: 'a1',
      providerMessageId: 'mid.1',
      peerId: 'p',
      content: 'hi',
    })
    const second = await store.persist({
      socialAccountKey: 'a1',
      providerMessageId: 'mid.1',
      peerId: 'p',
      content: 'hi',
    })
    assert.equal(first.ok && !first.duplicate, true)
    assert.equal(second.ok && second.duplicate, true)
  })

  it('runWebhookBurst processes 500 events across 5 accounts under budget', async () => {
    const result = await runWebhookBurst({ events: 500, accounts: 5 })
    assert.equal(result.signatureFailures, 0)
    assert.equal(result.parseFailures, 0)
    assert.equal(result.storeFailures, 0)
    assert.equal(result.withinBudget, true)
    assert.equal(result.p95UnderTarget, true)
    assert.ok(result.duplicates >= 1, 'replay should produce ≥1 duplicate')
  })
})
