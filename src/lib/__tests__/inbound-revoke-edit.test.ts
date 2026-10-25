/**
 * 2026-10-25 — WhatsApp deletes ("[revoke]") get no agent turn; WhatsApp edits ("[edit]") reach the agent and the
 * order prefill as the customer's corrected text. Stored `content` of those rows is never rewritten (inbound-text.ts).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  customerMessageTypeOf,
  customerTextOf,
  editedTextOf,
  isEditMessage,
  isRevokeMessage,
} from '@/lib/soft-ai/inbound-text'
import { customerTextsForPrefill } from '@/lib/chat-order-prefill-core'
import { isOptOutText } from '@/lib/soft-ai/llm/safety-router'
import { planBurstInbound } from '@/lib/soft-ai/inbound-burst'
import { sweepShouldAnswer } from '@/lib/soft-ai/resume-reply'
import { formatHistoryForPrompt } from '@/lib/soft-ai/llm/prompt'

const read = (p: string) => readFileSync(p, 'utf8')

/** Metadata as the live WhatsApp webhook stores it (meta-chat.ts rawMessageForStorage). */
function editMeta(message: Record<string, unknown>) {
  return {
    messageType: 'edit',
    rawMessage: { from: '50688887777', id: 'wamid.EDIT', type: 'edit', edit: { original_message_id: 'wamid.ORIG', message } },
  }
}
const textEdit = { content: '[edit]', messageType: 'edit', metadata: editMeta({ type: 'text', text: { body: '  Calle 7, casa 20, Heredia  ' } }) }
const captionEdit = {
  content: '[edit]',
  messageType: 'edit',
  metadata: editMeta({ type: 'image', image: { id: 'MEDIA1', caption: '¿Lo tienen en azul?' } }),
}
const revoke = {
  content: '[revoke]',
  messageType: 'revoke',
  metadata: { rawMessage: { type: 'revoke', revoke: { original_message_id: 'wamid.ORIG' } } },
}

describe('inbound-text · what the customer really said', () => {
  it('decides by the stored TYPE, never by the text', () => {
    assert.equal(isRevokeMessage('revoke'), true)
    assert.equal(isEditMessage('edit'), true)
    assert.equal(isRevokeMessage('text'), false, 'a typed "[revoke]" is a real message')
    assert.equal(isEditMessage(null), false)
    assert.equal(customerTextOf({ content: '[revoke]', messageType: 'text' }), '[revoke]')
    assert.equal(customerTextOf({ content: '[edit]', messageType: 'text' }), '[edit]')
  })

  it('an edit is its new text (body or new caption), trimmed', () => {
    assert.equal(customerTextOf(textEdit), 'Calle 7, casa 20, Heredia')
    assert.equal(customerTextOf(captionEdit), '¿Lo tienen en azul?')
    assert.equal(customerMessageTypeOf('edit'), 'text')
    assert.equal(customerMessageTypeOf('image'), 'image')
    assert.equal(customerMessageTypeOf(null), null)
  })

  it('a delete says nothing; other messages keep their stored content', () => {
    assert.equal(customerTextOf(revoke), '')
    assert.equal(customerTextOf({ content: 'Hola', messageType: 'text', metadata: null }), 'Hola')
    assert.equal(customerTextOf({ content: null, messageType: 'text' }), '')
  })

  it('never throws on odd metadata and returns "" when there is no new text', () => {
    for (const metadata of [null, undefined, 'string', 42, [], {}, { rawMessage: 'x' }, { rawMessage: { edit: null } }, { rawMessage: { edit: { message: [] } } }]) {
      assert.equal(editedTextOf(metadata), '')
      assert.equal(customerTextOf({ content: '[edit]', messageType: 'edit', metadata }), '')
    }
    assert.equal(editedTextOf(editMeta({ type: 'text', text: { body: '   ' } })), '')
    assert.equal(editedTextOf(editMeta({ type: 'image', image: { caption: 7 } })), '')
    // A history row (webhookField 'history') keeps the raw message as is: same shape, same answer.
    assert.equal(editedTextOf({ webhookField: 'history', rawMessage: textEdit.metadata.rawMessage }), 'Calle 7, casa 20, Heredia')
  })

  it('bounds the edited text', () => {
    assert.equal(editedTextOf(editMeta({ type: 'text', text: { body: 'a'.repeat(10_000) } })).length, 4_096)
  })
})

describe('revoke gets no turn — webhook hook and waiting sweep', () => {
  it('enqueue skips a revoke by type, and an edit with no new text, before any job is written', () => {
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    const enqueue = hook.slice(hook.indexOf('export async function enqueueSoftAiAfterInbound'))
    const revokeSkip = enqueue.indexOf("if (isRevokeMessage(args.messageType)) return { skippedReason: 'revoke' }")
    const editSkip = enqueue.indexOf("return { skippedReason: 'edit_empty' }")
    assert.ok(revokeSkip > 0 && revokeSkip < enqueue.indexOf('persistJob('))
    assert.ok(editSkip > 0 && editSkip < enqueue.indexOf('persistJob('))
    // The reaction skip stays where it was (v53).
    assert.ok(enqueue.indexOf("if (isReactionMessage(args.messageType)) return { skippedReason: 'reaction' }") > 0)
  })

  it('the webhook passes an edit\'s new text as the job content (stored path and the 503-retry path)', () => {
    const route = read('src/app/api/chat/webhook/route.ts')
    assert.match(route, /content: customerTextOf\(\{ content: result\.content, messageType: event\.messageType, metadata: event\.metadata \}\),/)
    assert.match(route, /content: customerTextOf\(\{ content: event\.content, messageType: event\.messageType, metadata: event\.metadata \}\),/)
  })

  it('the sweep never treats a delete (or an empty edit) as the customer\'s waiting message', () => {
    const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
    // Only the customer's own deletes: a message the store deleted on its phone still counts as its reply.
    assert.match(sweep, /const saysNothing = r\.direction === 'inbound' && \(isRevokeMessage\(r\.messageType\) \|\| isEditMessage\(r\.messageType\)\) && !customerTextOf\(r\)/)
    assert.match(sweep, /r\.messageType !== 'reaction' && !saysNothing/)
    // A waiting edit is re-queued with its new text.
    assert.match(sweep, /content: latestRow\.direction === 'inbound' \? customerTextOf\(latestRow\) : latestRow\.content,/)
    assert.deepEqual(sweepShouldAnswer({ content: customerTextOf(textEdit), messageType: customerMessageTypeOf('edit') }), {
      answer: true,
      reason: 'needs_reply',
    })
  })
})

describe('edit reaches the agent as the customer\'s text', () => {
  it('a burst reads the edit as a text bubble with its new words', () => {
    const plan = planBurstInbound({
      trigger: { content: customerTextOf(textEdit), messageType: customerMessageTypeOf(textEdit.messageType), sentAt: new Date() },
      earlier: [],
      awaitingReceipt: () => false,
    })
    assert.equal(plan.inboundText, 'Calle 7, casa 20, Heredia')
    assert.equal(plan.messageType, 'text')
  })

  it('agent-turn history, burst loader, trigger, opt-out and repeat guard all read through customerTextOf', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(turn, /content: r\.direction === 'inbound' \? customerTextOf\(r\) : r\.content,/)
    assert.match(turn, /messageTypeOf: new Map\(kept\.map\(\(r\) => \[r\.id, customerMessageTypeOf\(r\.messageType\)\]\)\)/)
    assert.match(turn, /content: customerTextOf\(r\),\r?\n\s+messageType: customerMessageTypeOf\(r\.messageType\),/)
    assert.match(turn, /return \{ \.\.\.rest, content: customerTextOf\(trigger\), messageType: customerMessageTypeOf\(trigger\.messageType\) \}/)
    assert.match(turn, /inboundSince\.some\(\(m\) => isOptOutText\(customerTextOf\(m\)\)\)/)
    assert.match(turn, /if \(m\.direction === 'inbound' && customerTextOf\(m\)\) sinceLastAnswer\.push\(customerTextOf\(m\)\)/)
    // The legacy Soft thread and the follow-up opt-out read the same way.
    assert.match(read('src/lib/soft-ai/inbound-hook.ts'), /content: m\.direction === 'outbound' \? m\.content : customerTextOf\(m\),/)
    assert.match(read('src/lib/soft-ai/follow-up.ts'), /isOptOutText\(customerTextOf\(m\)\)/)
  })

  it('a deleted bubble is no line in the model prompt; store lines and real text stay', () => {
    const lines = formatHistoryForPrompt([
      { id: 'm1', direction: 'inbound', content: 'Hola', sentAt: '2026-10-25T10:00:00.000Z' },
      { id: 'm2', direction: 'inbound', content: customerTextOf(revoke), sentAt: '2026-10-25T10:00:05.000Z' },
      { id: 'm3', direction: 'outbound', content: '¡Hola! ¿En qué te ayudo?', sentAt: '2026-10-25T10:00:10.000Z' },
      { id: 'm4', direction: 'inbound', content: customerTextOf(textEdit), sentAt: '2026-10-25T10:00:20.000Z' },
    ]).split('\n')
    assert.equal(lines.length, 3)
    assert.ok(!lines.some((l) => /\[revoke\]|\[edit\]/.test(l)))
    assert.match(lines[2], /Calle 7, casa 20, Heredia$/)
  })

  it('Corregir and the knowledge gaps read an edit\'s new text', () => {
    assert.match(read('src/lib/soft-ai/agent-tuning.ts'), /customerText: customerTextOf\(customer\),/)
    assert.match(read('src/lib/soft-ai/knowledge-map-server.ts'), /const textById = new Map\(messages\.map\(\(m\) => \[m\.id, customerTextOf\(m\)\]\)\)/)
  })

  it('a "STOP" typed into an edit is an opt-out', () => {
    const stop = { content: '[edit]', messageType: 'edit', metadata: editMeta({ type: 'text', text: { body: 'no me escriban más' } }) }
    assert.equal(isOptOutText('[edit]'), false)
    assert.equal(isOptOutText(customerTextOf(stop)), true)
  })
})

describe('edit reaches the order prefill', () => {
  it('the corrected address is read, the original stays before it (newest wins), a delete adds nothing', () => {
    const texts = customerTextsForPrefill([
      { direction: 'inbound', content: 'Calle 5, casa 20, Heredia', messageType: 'text' },
      { direction: 'outbound', content: 'Perfecto, ¿algo más?' },
      { direction: 'inbound', ...textEdit },
      { direction: 'inbound', ...revoke },
      { direction: 'inbound', content: '[edit]', messageType: 'edit', metadata: null },
    ])
    assert.deepEqual(texts, ['Calle 5, casa 20, Heredia', 'Calle 7, casa 20, Heredia'])
  })

  it('the prefill route loads the type and metadata it needs', () => {
    assert.match(read('src/app/api/chat/conversations/[id]/order-prefill/route.ts'), /select: \{ direction: true, content: true, messageType: true, metadata: true \},/)
  })
})
