import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildConversationSeed,
  buildMessageBackfillPatch,
  chooseCanonicalProviderMessage,
  compareConversationAggregate,
  compareMessageOrder,
  computeConversationAggregate,
  deriveConversationPeer,
  extractProviderMessageId,
  mergeBackfillAuditMetadata,
  parseChatBackfillOptions,
  planBackfillBatch,
  planDuplicatePatches,
  truncatePreview,
  type ChatInboxBackfillMessage,
} from '../chat-conversation-foundation'

function msg(
  partial: Partial<ChatInboxBackfillMessage> & Pick<ChatInboxBackfillMessage, 'id' | 'direction' | 'content' | 'sentAt'>,
): ChatInboxBackfillMessage {
  return {
    tenantId: 't1',
    socialAccountId: 'sa1',
    metadata: null,
    ...partial,
  }
}

describe('chat-conversation-foundation peer derivation', () => {
  it('uses from then waId for inbound', () => {
    assert.deepEqual(
      deriveConversationPeer({ direction: 'inbound', metadata: { from: '5071', waId: 'x' } }),
      { ok: true, peerId: '5071', peerName: null },
    )
    assert.deepEqual(
      deriveConversationPeer({ direction: 'inbound', metadata: { waId: '5072' } }),
      { ok: true, peerId: '5072', peerName: null },
    )
  })

  it('uses to then from for outbound (SMB/history echoes)', () => {
    assert.deepEqual(
      deriveConversationPeer({ direction: 'outbound', metadata: { to: '5073' } }),
      { ok: true, peerId: '5073', peerName: null },
    )
    assert.deepEqual(
      deriveConversationPeer({ direction: 'outbound', metadata: { from: '5074' } }),
      { ok: true, peerId: '5074', peerName: null },
    )
  })

  it('quarantines missing peer and literal unknown', () => {
    assert.deepEqual(deriveConversationPeer({ direction: 'inbound', metadata: {} }), {
      ok: false,
      reason: 'missing_peer',
      peerId: null,
    })
    assert.deepEqual(
      deriveConversationPeer({ direction: 'inbound', metadata: { from: 'unknown' } }),
      { ok: false, reason: 'literal_unknown', peerId: null },
    )
    assert.deepEqual(
      deriveConversationPeer({ direction: 'inbound', peerId: 'unknown', metadata: {} }),
      { ok: false, reason: 'literal_unknown', peerId: null },
    )
  })

  it('prefers promoted peerId column when present', () => {
    assert.deepEqual(
      deriveConversationPeer({
        direction: 'inbound',
        peerId: 'promoted',
        metadata: { from: 'other', name: 'Ana' },
      }),
      { ok: true, peerId: 'promoted', peerName: 'Ana' },
    )
  })
})

describe('provider id + duplicates', () => {
  it('extracts providerMessageId from column then metadata', () => {
    assert.equal(extractProviderMessageId({ providerMessageId: 'wamid.A' }), 'wamid.A')
    assert.equal(
      extractProviderMessageId({ metadata: { providerMessageId: 'wamid.B' } }),
      'wamid.B',
    )
    assert.equal(extractProviderMessageId({ metadata: {} }), null)
  })

  it('keeps earliest (sentAt, id) as canonical and nulls later provider ids', () => {
    const rows = [
      msg({
        id: 'b',
        direction: 'inbound',
        content: 'second',
        sentAt: '2026-09-20T10:00:01.000Z',
        providerMessageId: 'wamid.X',
      }),
      msg({
        id: 'a',
        direction: 'inbound',
        content: 'first',
        sentAt: '2026-09-20T10:00:00.000Z',
        providerMessageId: 'wamid.X',
      }),
      msg({
        id: 'c',
        direction: 'inbound',
        content: 'third',
        sentAt: '2026-09-20T10:00:01.000Z',
        providerMessageId: 'wamid.X',
      }),
    ]
    const canonical = chooseCanonicalProviderMessage(rows)
    assert.equal(canonical.id, 'a')
    const patches = planDuplicatePatches(
      rows.map((row) => ({ ...row, providerMessageId: 'wamid.X' })),
    )
    assert.equal(patches.length, 2)
    assert.ok(patches.every((p) => p.duplicateOfMessageId === 'a'))
    assert.ok(patches.every((p) => p.providerMessageId === null))
    assert.equal(
      (patches[0].metadata.audit as { chatInboxBackfill: { originalProviderMessageId: string } })
        .chatInboxBackfill.originalProviderMessageId,
      'wamid.X',
    )
  })

  it('does not fingerprint-dedup by content+time; null provider ids stay independent', () => {
    const patches = planDuplicatePatches([])
    assert.equal(patches.length, 0)
    assert.equal(compareMessageOrder(
      { id: 'a', sentAt: '2026-09-20T10:00:00.000Z' },
      { id: 'b', sentAt: '2026-09-20T10:00:00.000Z' },
    ), -1)
  })
})

describe('aggregates + seeds', () => {
  it('excludes duplicates and caps preview at 120', () => {
    const long = 'x'.repeat(200)
    assert.equal(truncatePreview(long).length, 120)
    const rows = [
      msg({
        id: '1',
        direction: 'inbound',
        content: 'hi',
        sentAt: '2026-09-20T10:00:00.000Z',
      }),
      msg({
        id: '2',
        direction: 'outbound',
        content: long,
        sentAt: '2026-09-20T10:01:00.000Z',
      }),
      msg({
        id: '3',
        direction: 'inbound',
        content: 'dup',
        sentAt: '2026-09-20T10:02:00.000Z',
        duplicateOfMessageId: '1',
      }),
    ]
    const agg = computeConversationAggregate(rows)
    assert.equal(agg.messageCount, 2)
    assert.equal(agg.inboundCount, 1)
    assert.equal(agg.lastMessageId, '2')
    assert.equal(agg.lastMessagePreview?.length, 120)
    assert.ok(agg.lastInboundAt)
    assert.ok(agg.lastOutboundAt)

    const peer = deriveConversationPeer({
      direction: 'inbound',
      metadata: { from: '507', name: 'Ana' },
    })
    assert.equal(peer.ok, true)
    if (!peer.ok) return
    const seed = buildConversationSeed(rows[0], peer)
    assert.equal(seed.peerId, '507')
    assert.equal(seed.inboundCount, 1)
    assert.equal(seed.messageCount, 1)

    const patch = buildMessageBackfillPatch(rows[0], peer, 'conv1')
    assert.equal(patch.conversationId, 'conv1')
    assert.equal(patch.peerId, '507')
  })

  it('compareConversationAggregate reports diffs', () => {
    const expected = computeConversationAggregate([
      msg({ id: '1', direction: 'inbound', content: 'a', sentAt: '2026-09-20T10:00:00.000Z' }),
    ])
    const bad = { ...expected, inboundCount: 99 }
    assert.ok(compareConversationAggregate(bad, expected).some((e) => e.startsWith('inboundCount')))
  })
})

describe('backfill planner resumability', () => {
  it('quarantines peer-less rows and advances cursor past them', () => {
    const batch = [
      msg({ id: 'q1', direction: 'inbound', content: 'x', sentAt: '2026-09-20T09:00:00.000Z', metadata: {} }),
      msg({
        id: 'ok1',
        direction: 'inbound',
        content: 'hola',
        sentAt: '2026-09-20T09:01:00.000Z',
        metadata: { from: '507' },
      }),
    ]
    const map = new Map<string, string>()
    const plan = planBackfillBatch(batch, map, () => 'conv-new')
    assert.equal(plan.quarantined.length, 1)
    assert.equal(plan.quarantined[0].reason, 'missing_peer')
    assert.equal(plan.linked.length, 1)
    assert.equal(plan.linked[0].createdConversation, true)
    assert.deepEqual(plan.nextCursor, {
      sentAt: '2026-09-20T09:01:00.000Z',
      id: 'ok1',
    })

    const again = planBackfillBatch(
      [
        msg({
          id: 'ok1',
          direction: 'inbound',
          content: 'hola',
          sentAt: '2026-09-20T09:01:00.000Z',
          metadata: { from: '507' },
          conversationId: 'conv-new',
        }),
      ],
      map,
      () => 'should-not-create',
    )
    assert.equal(again.linked.length, 0)
  })

  it('parses CLI options with dry-run default and batch cap', () => {
    const dry = parseChatBackfillOptions([])
    assert.equal(dry.apply, false)
    assert.equal(dry.dryRun, true)
    assert.equal(dry.batchSize, 1000)

    const apply = parseChatBackfillOptions(
      ['--apply', '--tenant=t1', '--batch-size=5000'],
      { CHAT_INBOX_BACKFILL_CONFIRM_HOST: 'db.example.supabase.co' },
    )
    assert.equal(apply.apply, true)
    assert.equal(apply.tenantId, 't1')
    assert.equal(apply.batchSize, 1000)
    assert.equal(apply.confirmHost, 'db.example.supabase.co')
  })

  it('mergeBackfillAuditMetadata nests under audit.chatInboxBackfill', () => {
    const merged = mergeBackfillAuditMetadata({ from: '1', audit: { keep: true } }, {
      quarantineReason: 'missing_peer',
    })
    assert.equal(merged.from, '1')
    assert.equal((merged.audit as { keep: boolean }).keep, true)
    assert.equal(
      (merged.audit as { chatInboxBackfill: { quarantineReason: string } }).chatInboxBackfill
        .quarantineReason,
      'missing_peer',
    )
  })
})
