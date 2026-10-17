/**
 * Agentes IA 2.0 · C — "Never left waiting": waiting sweep, handoff notifications, Devolver a IA.
 * Pure functions + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  clampSweepLimit,
  decideWaitingAction,
  turnAllowsRearm,
  PERIODIC_MAX_ATTEMPTS,
  EXPLICIT_MAX_ATTEMPTS,
  PERIODIC_MIN_WAIT_MS,
  WAITING_SWEEP_MAX,
  type WaitingCandidate,
} from '@/lib/soft-ai/waiting-sweep'
import {
  handoffAnchor,
  handoffDedupeKey,
  normalizeHandoffReason,
  orderAssigneeCandidates,
  pickFirstEligible,
} from '@/lib/soft-ai/handoff-notify'
import { handoffNotificationText, HANDOFF_REASON_LABELS } from '@/lib/workspace-notifications'
import { softAiInboundDeliveryKey } from '@/lib/soft-ai/automation-queue'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const NOW = Date.UTC(2026, 9, 15, 20, 0, 0)
const MIN = 60_000

function candidate(over: Partial<WaitingCandidate> = {}, latestOver: Partial<NonNullable<WaitingCandidate['latest']>> = {}): WaitingCandidate {
  return {
    aiMode: null,
    platform: 'whatsapp',
    latest: {
      id: 'msg_latest_0001',
      direction: 'inbound',
      sentAt: new Date(NOW - 10 * MIN),
      content: 'Hola, ¿cuánto cuesta?',
      historical: false,
      duplicate: false,
      ...latestOver,
    },
    job: null,
    turn: null,
    otherInflight: false,
    ...over,
  }
}

const explicit = { mode: 'explicit' as const, nowMs: NOW }
const periodic = { mode: 'periodic' as const, nowMs: NOW, minWaitMs: PERIODIC_MIN_WAIT_MS }

describe('C · contracts exported exactly as the spec says', () => {
  it('sweepWaitingChats / notifyHandoff signatures', () => {
    const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
    assert.match(
      sweep,
      /export async function sweepWaitingChats\(\s*tenantId: string,\s*socialAccountId: string,\s*opts\?: \{ limit\?: number \},?\s*\): Promise<\{ queued: number; skipped: number \}>/,
    )
    const notify = read('src/lib/soft-ai/handoff-notify.ts')
    assert.match(
      notify,
      /export async function notifyHandoff\(input: \{\s*tenantId: string\s*conversationId: string\s*socialAccountId\?: string \| null\s*kind: 'handoff' \| 'review'\s*reason: string\s*(?:\/\*\*[\s\S]*?\*\/\s*quietUntil\?: Date \| null\s*)?\}\): Promise<void>/,
    )
  })
})

describe('C · which waiting chats get answered (pure)', () => {
  it('a waiting chat with no job is queued; chats with a person or paused never are', () => {
    assert.deepEqual(decideWaitingAction(candidate(), explicit), { action: 'enqueue', reason: 'no_job' })
    assert.equal(decideWaitingAction(candidate({ aiMode: 'ai_active' }), explicit).action, 'enqueue')
    assert.equal(decideWaitingAction(candidate({ aiMode: 'human' }), explicit).reason, 'with_person')
    assert.equal(decideWaitingAction(candidate({ aiMode: 'paused' }), explicit).reason, 'with_person')
  })

  it('NULL-mode chat where a person wrote in the last 24 h stays with the person; explicit ai_active does not', () => {
    assert.equal(decideWaitingAction(candidate({ humanWroteRecently: true }), explicit).reason, 'with_person')
    assert.equal(decideWaitingAction(candidate({ humanWroteRecently: true }), periodic).reason, 'with_person')
    assert.equal(decideWaitingAction(candidate({ aiMode: 'ai_active', humanWroteRecently: true }), explicit).action, 'enqueue')
    const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
    assert.match(sweep, /if \(!conv\.aiMode\) humanWroteRecently = await personWroteRecently\(conv\.tenantId, conv\.id, opts\.nowMs\)/)
    assert.match(sweep, /return meta\.softAi !== true/)
  })

  it('anything after the customer message (person or AI) means answered', () => {
    assert.equal(decideWaitingAction(candidate({}, { direction: 'outbound' }), explicit).reason, 'answered')
    assert.equal(decideWaitingAction(candidate({ latest: null }), explicit).reason, 'no_messages')
  })

  it('history imports, duplicates and empty messages are never answered', () => {
    assert.equal(decideWaitingAction(candidate({}, { historical: true }), explicit).reason, 'history_import')
    assert.equal(decideWaitingAction(candidate({}, { duplicate: true }), explicit).reason, 'duplicate')
    assert.equal(decideWaitingAction(candidate({}, { content: '   ' }), explicit).reason, 'empty')
  })

  it('24 h window: closed (or about to close) → skip; Messenger/other platforms never', () => {
    assert.equal(decideWaitingAction(candidate({}, { sentAt: new Date(NOW - 25 * 60 * MIN) }), explicit).reason, 'window_closed')
    assert.equal(decideWaitingAction(candidate({}, { sentAt: new Date(NOW - (24 * 60 - 1) * MIN) }), explicit).reason, 'window_closed')
    assert.equal(decideWaitingAction(candidate({}, { sentAt: new Date(NOW - 23 * 60 * MIN) }), explicit).action, 'enqueue')
    assert.equal(decideWaitingAction(candidate({ platform: 'instagram' }), explicit).action, 'enqueue')
    assert.equal(decideWaitingAction(candidate({ platform: 'messenger' }), explicit).reason, 'window_closed')
  })

  it('periodic: only after 90 s and only when nothing is in flight in the chat', () => {
    assert.equal(decideWaitingAction(candidate({}, { sentAt: new Date(NOW - 30_000) }), periodic).reason, 'too_recent')
    assert.equal(decideWaitingAction(candidate({}, { sentAt: new Date(NOW - 30_000) }), explicit).action, 'enqueue')
    assert.equal(decideWaitingAction(candidate({ otherInflight: true }), periodic).reason, 'in_flight')
    assert.equal(decideWaitingAction(candidate({ otherInflight: true }), explicit).action, 'enqueue')
  })

  it('never twice: queued / processing / ambiguous / already-sent jobs are left alone', () => {
    for (const status of ['pending', 'retry', 'processing']) {
      assert.equal(decideWaitingAction(candidate({ job: { status, attempts: 1, deliveries: 0 } }), explicit).reason, 'already_queued')
    }
    assert.equal(decideWaitingAction(candidate({ job: { status: 'ambiguous', attempts: 1, deliveries: 1 } }), explicit).action, 'skip')
    assert.equal(decideWaitingAction(candidate({ job: { status: 'completed', attempts: 1, deliveries: 1 } }), explicit).reason, 'already_sent')
  })

  it('a finished job that never sent anything is re-queued (same delivery key) when its turn allows it', () => {
    const skippedLineOff = candidate({
      job: { status: 'completed', attempts: 1, deliveries: 0 },
      turn: { status: 'skipped', skipReason: 'not_activated' },
    })
    assert.deepEqual(decideWaitingAction(skippedLineOff, explicit), { action: 'rearm', reason: 'rearm' })
    assert.equal(decideWaitingAction(skippedLineOff, periodic).action, 'rearm')
    // Devolver a IA after a hand-off: the turn was skipped because the chat was with a person.
    const withPerson = candidate({
      job: { status: 'completed', attempts: 1, deliveries: 0 },
      turn: { status: 'skipped', skipReason: 'human_before_send' },
    })
    assert.equal(decideWaitingAction(withPerson, explicit).action, 'rearm')
    assert.equal(decideWaitingAction(withPerson, periodic).reason, 'turn_done')
    // No turn row at all (legacy path / skipped before the turn existed)
    assert.equal(decideWaitingAction(candidate({ job: { status: 'completed', attempts: 1, deliveries: 0 } }), explicit).action, 'rearm')
  })

  it('turns that produced an answer, or where a person replied, are final', () => {
    for (const status of ['generated', 'delivered', 'partially_delivered', 'suggested', 'fallback', 'window_closed', 'test']) {
      assert.equal(turnAllowsRearm({ status, skipReason: null }, 'explicit'), false, status)
      assert.equal(turnAllowsRearm({ status, skipReason: null }, 'periodic'), false, status)
    }
    assert.equal(turnAllowsRearm({ status: 'skipped', skipReason: 'human_replied' }, 'explicit'), false)
    assert.equal(turnAllowsRearm({ status: 'skipped', skipReason: 'superseded' }, 'periodic'), false)
    assert.equal(turnAllowsRearm({ status: 'budget_blocked', skipReason: null }, 'explicit'), true)
    assert.equal(turnAllowsRearm({ status: 'budget_blocked', skipReason: null }, 'periodic'), false)
  })

  it('attempt caps stop loops (periodic re-queues once; explicit has a hard cap)', () => {
    const at = (attempts: number) =>
      candidate({ job: { status: 'completed', attempts, deliveries: 0 }, turn: { status: 'skipped', skipReason: 'not_activated' } })
    assert.equal(decideWaitingAction(at(PERIODIC_MAX_ATTEMPTS), periodic).reason, 'attempts_exhausted')
    assert.equal(decideWaitingAction(at(PERIODIC_MAX_ATTEMPTS), explicit).action, 'rearm')
    assert.equal(decideWaitingAction(at(EXPLICIT_MAX_ATTEMPTS), explicit).reason, 'attempts_exhausted')
  })

  it('limits: 50 max per line call', () => {
    assert.equal(WAITING_SWEEP_MAX, 50)
    assert.equal(clampSweepLimit(undefined), 50)
    assert.equal(clampSweepLimit(500), 50)
    assert.equal(clampSweepLimit(0), 1)
    assert.equal(clampSweepLimit(7.9), 7)
    assert.equal(clampSweepLimit(Number.NaN), 50)
  })

  it('the sweep reuses the webhook delivery key for the message', () => {
    assert.equal(softAiInboundDeliveryKey('m1'), 'soft_ai_inbound:m1')
    const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
    assert.match(sweep, /softAiInboundDeliveryKey\(latest\.id\)/)
    assert.match(sweep, /persistJob\(\{/)
    assert.match(sweep, /if \(row\.duplicate\) return \{ decision: \{ action: 'skip', reason: 'already_queued' \} \}/)
  })
})

describe('C · sweep queries are tenant-scoped, bounded, newest first', () => {
  const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
  it('line + chats + messages + jobs always carry the tenant', () => {
    assert.match(sweep, /socialAccount\.findFirst\(\{\s*where: \{ id: socialAccountId, tenantId \}/)
    assert.match(sweep, /chatConversation\.findMany\(\{\s*where: \{\s*tenantId: input\.tenantId,\s*socialAccountId: input\.socialAccountId,/)
    // luna-10 (Verifier F6): the latest few messages, so the waiting ack can be skipped — still tenant-scoped.
    assert.match(sweep, /chatMessage\.findMany\(\{\s*where: \{ tenantId: conv\.tenantId, conversationId: conv\.id \}/)
    assert.match(sweep, /if \(jobRow && jobRow\.tenantId !== conv\.tenantId\)/)
    assert.match(sweep, /where: \{ tenantId: input\.tenantId, socialAccountId: input\.socialAccountId, peerId: input\.peerId \}/)
    assert.match(sweep, /socialAccount\.findMany\(\{\s*where: \{ tenantId, id: \{ in: allowlist \} \}/)
  })
  it('newest first, take-bounded, human/paused excluded at the query (NULL aiMode kept)', () => {
    assert.match(sweep, /orderBy: \[\{ lastInboundAt: 'desc' \}, \{ id: 'desc' \}\],\s*take: input\.limit/)
    assert.match(sweep, /OR: \[\{ aiMode: null \}, \{ aiMode: \{ notIn: \['human', 'paused'\] \} \}\]/)
    assert.match(sweep, /lastMessageDirection: 'inbound'/)
  })
  it('only lines that answer by themselves are swept (kill switch, ai_full, valid activation)', () => {
    assert.match(sweep, /if \(!\(await lineAnswersNow\(tenantId, socialAccountId\)\)\) return \{ queued: 0, skipped: 0 \}/)
    assert.match(sweep, /resolved\.agent\.operationMode === 'ai_full' &&\s*resolved\.unlockedForSend/)
    assert.match(sweep, /readAgentKillState\(tenantId\)\)\.armed\) return false/)
  })
  it('periodic: per-run cap and deadline', () => {
    assert.match(sweep, /if \(out\.queued >= cap \|\| Date\.now\(\) > deadline\) break/)
    assert.match(sweep, /minWaitMs: PERIODIC_MIN_WAIT_MS/)
  })
  it('never imports the staff bot', () => {
    for (const f of ['src/lib/soft-ai/waiting-sweep.ts', 'src/lib/soft-ai/handoff-notify.ts']) {
      assert.doesNotMatch(read(f), /@\/lib\/bot\/|api\/bot\//, f)
    }
  })
})

describe('C · re-queue is conditional and never resends', () => {
  const queue = read('src/lib/soft-ai/automation-queue.ts')
  it('rearmFinishedJob only touches finished jobs of this tenant with zero deliveries (the waiting ack is not an answer)', () => {
    const fn = queue.slice(queue.indexOf('export async function rearmFinishedJob'), queue.indexOf('async function supersedeOlderJobs'))
    assert.match(fn, /tenantId: input\.tenantId,/)
    assert.match(fn, /status: \{ in: \['completed', 'failed'\] \}/)
    // luna-10 (verifier round 2): only the ":waiting_ack" delivery is ignored; any real reply still blocks a re-arm.
    assert.match(fn, /deliveries: \{ none: \{ NOT: \{ deliveryKey: \{ endsWith: ':waiting_ack' \} \} \} \}/)
    assert.match(fn, /status: 'pending'/)
    assert.doesNotMatch(fn, /ambiguous|processing/)
  })
})

describe('C · periodic sweep runs inside the existing chat-automation cron', () => {
  it('cron route calls the bounded sweep; no new Worker schedule', () => {
    const cron = read('src/app/api/cron/chat-automation/route.ts')
    assert.match(cron, /sweepWaitingChatsPeriodic\(\{ deadlineMs: 8_000 \}\)\.catch\(\(\) => null\)/)
    assert.match(cron, /Date\.now\(\) - startedAt < 20_000/)
    assert.match(read('src/cf-container-worker.ts'), /"\*\/1 \* \* \* \*": \["\/api\/cron\/chat-automation", "\/api\/cron\/chat-workspace"\]/)
  })
})

describe('C · Devolver a IA answers the waiting message', () => {
  it('resume (only resume) sweeps that one chat after the mode is saved', () => {
    const route = read('src/app/api/chat/soft-ai/control/route.ts')
    assert.match(route, /if \(action === 'resume' && keyParts\) \{\s*const sweep = await sweepWaitingConversation\(\{\s*tenantId,/)
    assert.ok(route.indexOf('sweepWaitingConversation({') > route.indexOf('data: { aiMode: mode }'))
    assert.ok(route.indexOf('sweepWaitingConversation({') > route.indexOf('tenantFeatureFlag.update'))
    assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  })
})

describe('C · notifyHandoff (pure parts)', () => {
  it('reasons become plain-word codes (codes, Spanish labels or internal reasons)', () => {
    assert.equal(normalizeHandoffReason('payment', 'handoff'), 'payment')
    assert.equal(normalizeHandoffReason('Comprobante de pago', 'handoff'), 'payment')
    assert.equal(normalizeHandoffReason('payment_receipt', 'handoff'), 'payment')
    assert.equal(normalizeHandoffReason('Pidió hablar con una persona', 'handoff'), 'human_request')
    assert.equal(normalizeHandoffReason('opt_out', 'handoff'), 'human_request')
    assert.equal(normalizeHandoffReason('Reclamo o devolución', 'handoff'), 'complaint')
    assert.equal(normalizeHandoffReason('refund', 'handoff'), 'complaint')
    assert.equal(normalizeHandoffReason('payment_details_not_shareable', 'review'), 'payment_details')
    assert.equal(normalizeHandoffReason('Revisar respuesta de la IA', 'review'), 'review')
    assert.equal(normalizeHandoffReason('validator_failed', 'review'), 'review')
    assert.equal(normalizeHandoffReason('', 'handoff'), 'escalate')
    for (const code of ['payment', 'human_request', 'complaint', 'review']) assert.ok(HANDOFF_REASON_LABELS[code])
  })

  it('one alert per customer message per reason (no 30-minute bucket); identical events dedupe', () => {
    const a = handoffDedupeKey('handoff', 'conv_12345678', handoffAnchor('msg_aaaa1111'), 'payment')
    assert.equal(a, 'ai_handoff:conv_12345678:msg_aaaa1111:payment')
    assert.notEqual(a, handoffDedupeKey('handoff', 'conv_12345678', handoffAnchor('msg_bbbb2222'), 'payment'))
    assert.equal(handoffDedupeKey('review', 'c', 'm', 'review'), 'ai_review:c:m:review')
    // No customer message: short (2 min) bucket for identical events only.
    assert.equal(handoffAnchor(null, 0), 't0')
    assert.equal(handoffAnchor(null, 119_999), 't0')
    assert.equal(handoffAnchor(null, 120_000), 't1')
    assert.doesNotMatch(read('src/lib/soft-ai/handoff-notify.ts'), /30 \* 60_000/)
  })

  it('bell text in Spanish, from the code (no customer text in the key)', () => {
    assert.deepEqual(handoffNotificationText('ai_handoff:c:m:payment', ' · Ana'), {
      title: 'La IA te pasó un chat · Ana',
      snippet: 'Comprobante de pago',
    })
    assert.deepEqual(handoffNotificationText('ai_review:c:m:review', ''), {
      title: 'Revisá un chat de la IA',
      snippet: 'Revisar respuesta de la IA',
    })
    assert.equal(handoffNotificationText('ai_no_reply:c:1:needs_human', ''), null)
    const notes = read('src/lib/workspace-notifications.ts')
    assert.match(notes, /title: `La IA no respondió\$\{where\}`/)
  })

  it('assignee order: viewing now → replied in this chat → recent replier → owner/admin; first eligible member', () => {
    const order = orderAssigneeCandidates([['u_view'], [null, 'u_chat', 'u_view'], ['u_recent'], ['u_owner', 'u_admin']])
    assert.deepEqual(order, ['u_view', 'u_chat', 'u_recent', 'u_owner', 'u_admin'])
    assert.equal(pickFirstEligible(order, new Set(['u_recent', 'u_owner'])), 'u_recent')
    assert.equal(pickFirstEligible(order, new Set()), null)
  })

  it('handoff assigns only an unassigned chat (conditional), review never assigns or flips aiMode', () => {
    const src = read('src/lib/soft-ai/handoff-notify.ts')
    assert.match(src, /if \(!assignee && !conv\.assignedUserId && input\.kind === 'handoff'\)/)
    assert.match(src, /where: \{ id: conv\.id, tenantId: input\.tenantId, assignedUserId: null \}/)
    assert.doesNotMatch(src, /aiMode:/)
    assert.match(src, /filterChatMembers\(tenantId, candidates\)/)
    assert.match(src, /kind: 'ai_no_reply'/)
    assert.match(src, /where: \{\s*id: input\.conversationId,\s*tenantId: input\.tenantId,/)
  })
})
