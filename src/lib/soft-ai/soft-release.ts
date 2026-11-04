import 'server-only'
/**
 * Answer after a hand-off (Rafael 2026-11-04): "if it's a silly bad hand-off, after 5 minutes the agent should respond;
 * if it's urgent the agent waits for a human. I don't want the bot to escalate and then 5 minutes later give a very
 * dumb answer."
 *
 * Only a hand-off for a STORE FACT the model was unsure about qualifies: reason `unknown_answer`, or `escalate` with the
 * model's own reason exactly `other` (stored on the marker as handoffSubReason since this change; older turns have none
 * and never qualify). Payments, receipts, complaints, safety / health, "quiero una persona", owner-only replies, orders
 * to confirm, limits and every unknown reason keep waiting for a person (fail closed). The customer's words since the
 * hand-off must also be clean: no payment claim, no media, no complaint / alarm / crisis / person ask, no opt-out.
 *
 * The 1-minute chat-automation cron queues ONE job per hand-off (delivery key soft_release:<turnId>, one per chat per
 * 24 h). The job runs the normal pipeline with every gate (kill switch, person replied, allowance, hours…); the chat goes
 * back to the agent only when the new reply is a real answer — no new hand-off, no "dame un momento / te confirmo", no
 * "no lo tengo". Otherwise nothing is sent and the chat keeps waiting for the team (agent-turn.ts softReleaseGate).
 * A person who wrote after the hand-off always wins. Off unless the tenant flag agent_soft_release_v1 is on.
 */
import { prisma } from '@/lib/db'
import { classifyPaymentText, hasHardPaymentClaim } from '@/lib/soft-ai/payment-classifier'
import { customerNightNeed, hasCheckPromise, afterHoursState } from '@/lib/soft-ai/business-hours'
import { admitsCannotAnswer, isComplaintText, readOutcomeMarkers, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { isOptOutText } from '@/lib/soft-ai/waiting-ack'
import { hasHumanRepliedAfter } from '@/lib/soft-ai/agent-claim-gates'
import { persistJob } from '@/lib/soft-ai/automation-queue'

export const SOFT_RELEASE_FLAG = 'agent_soft_release_v1'
export const SOFT_RELEASE_DELAY_MS = 5 * 60_000
/** Hand-offs older than this are left to the team (the customer already waited; a late bot answer reads odd). */
export const SOFT_RELEASE_MAX_AGE_MS = 45 * 60_000
const META_WINDOW_MS = 23 * 60 * 60_000
const PER_RUN_MAX = 6
export const SOFT_RELEASE_KEY_PREFIX = 'soft_release:'

/**
 * Runtime context for the release turn (code text, never customer text). If the model truly lacks the fact it answers
 * with the stall line, which softReleaseReplyOk rejects — nothing is sent and the chat keeps waiting on the team.
 */
export const SOFT_RELEASE_PROMPT_LINE =
  'Contexto interno: hace unos minutos pasaste este chat al equipo y nadie ha respondido todavía. Si lo que pregunta el cliente se responde con la información de la tienda, respondelo bien y cerrá con el siguiente paso de la compra. Si de verdad no tenés ese dato, respondé solo: Dame un momento y te confirmo 😊'

export function softReleaseDeliveryKey(handoffTurnId: string): string {
  return `${SOFT_RELEASE_KEY_PREFIX}${handoffTurnId}`
}

/** Model escalate reasons stored on the marker (allowlist; anything else is dropped → never released). */
const SUB_REASON_RE = /^[a-z_]{1,32}$/
export function safeHandoffSubReason(reason: string | null | undefined): string | null {
  return reason && SUB_REASON_RE.test(reason) ? reason : null
}

const MEDIA_TYPES = new Set(['image', 'audio', 'voice', 'video', 'document', 'file', 'sticker', 'ptt'])

export type SoftReleaseInput = {
  handoffKind: 'handoff' | 'review' | null | undefined
  handoffReason: string | null | undefined
  handoffSubReason: string | null | undefined
  /** The hand-off turn itself came from a soft-release job: its hand-off is final. */
  handoffWasRelease: boolean
  handoffAtMs: number
  nowMs: number
  aiMode: string | null
  humanRepliedSince: boolean
  releasedRecently: boolean
  afterHours: boolean
  lastInboundAtMs: number | null
  /** Every customer message of the hand-off burst and since. */
  customerMessages: Array<{ content: string; messageType: string | null }>
}

export type SoftReleaseDecision = { release: true } | { release: false; reason: string }

/** Pure: may the agent answer this chat again? Fail closed on anything unknown. */
export function decideSoftRelease(i: SoftReleaseInput): SoftReleaseDecision {
  const no = (reason: string): SoftReleaseDecision => ({ release: false, reason })
  if (i.aiMode !== 'human') return no('not_waiting_on_person')
  if (i.handoffKind !== 'handoff') return no('not_a_handoff')
  if (i.handoffWasRelease) return no('second_handoff')
  const factOnly = i.handoffReason === 'unknown_answer' || (i.handoffReason === 'escalate' && i.handoffSubReason === 'other')
  if (!factOnly) return no('needs_person')
  const age = i.nowMs - i.handoffAtMs
  if (!(age >= SOFT_RELEASE_DELAY_MS)) return no('too_soon')
  if (age > SOFT_RELEASE_MAX_AGE_MS) return no('too_old')
  if (i.humanRepliedSince) return no('person_replied')
  if (i.releasedRecently) return no('released_recently')
  if (i.afterHours) return no('after_hours')
  if (!i.lastInboundAtMs || i.nowMs - i.lastInboundAtMs > META_WINDOW_MS) return no('outside_window')
  const texts = i.customerMessages.map((m) => m.content || '')
  if (!texts.some((t) => t.trim())) return no('no_customer_text')
  if (i.customerMessages.some((m) => MEDIA_TYPES.has((m.messageType || '').toLowerCase()))) return no('media')
  const all = texts.join('\n')
  if (customerNightNeed(all, isComplaintText) !== null) return no('urgent_or_person')
  if (texts.some((t) => isOptOutText(t))) return no('opt_out')
  if (texts.some((t) => classifyPaymentText(t) === 'payment_proof_or_risk' || hasHardPaymentClaim(t))) return no('payment')
  return { release: true }
}

const STALL_RE =
  /dame\s+un\s+momento|te\s+confirmo|lo\s+(?:reviso|confirmo|verifico|consulto)|ya\s+lo\s+reviso|te\s+paso\s+con|(?:alguien\s+del|el)\s+equipo\s+te|el\s+equipo\s+(?:te\s+)?(?:escribe|contacta|responde)|no\s+(?:lo\s+)?tengo\s+(?:ese|el|esa|la)\s+(?:dato|informaci[oó]n|detalle)|no\s+tengo\s+indicad|voy\s+a\s+confirmar/iu

/** Pure: the release reply is a real answer (never a second "lo confirmo", a safe line or "no lo tengo"). */
export function softReleaseReplyOk(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  if (Object.values(SAFE_LINE).some((line) => line && t === String(line).trim())) return false
  if (STALL_RE.test(t)) return false
  if (admitsCannotAnswer(t) || hasCheckPromise(t)) return false
  return true
}

/** One release per chat per 24 h: any earlier soft-release turn counts (delivered or declined). */
async function releasedRecently(tenantId: string, conversationId: string, nowMs: number): Promise<boolean> {
  const row = await prisma.chatAgentTurn.findFirst({
    where: {
      tenantId,
      conversationId,
      automationDeliveryKey: { startsWith: SOFT_RELEASE_KEY_PREFIX },
      createdAt: { gte: new Date(nowMs - 24 * 60 * 60_000) },
    },
    select: { id: true },
  })
  return Boolean(row)
}

type SweepResult = { looked: number; queued: number; skipped: Record<string, number> }

/** Cron step: queue a soft-release job for each eligible hand-off. Bounded, tenant-scoped, never throws. */
export async function runSoftReleaseSweep(opts: { nowMs?: number } = {}): Promise<SweepResult> {
  const nowMs = opts.nowMs ?? Date.now()
  const out: SweepResult = { looked: 0, queued: 0, skipped: {} }
  const skip = (r: string) => {
    out.skipped[r] = (out.skipped[r] || 0) + 1
  }
  try {
    const flags = await prisma.tenantFeatureFlag.findMany({
      where: { key: SOFT_RELEASE_FLAG, enabled: true, tenantId: { not: null } },
      select: { tenantId: true },
    })
    const { loadHoursSetup } = await import('@/lib/soft-ai/agent-turn')
    for (const f of flags) {
      const tenantId = f.tenantId as string
      const turns = await prisma.chatAgentTurn.findMany({
        where: {
          tenantId,
          testSessionId: null,
          status: { in: ['delivered', 'partially_delivered'] },
          createdAt: { gte: new Date(nowMs - SOFT_RELEASE_MAX_AGE_MS), lte: new Date(nowMs - SOFT_RELEASE_DELAY_MS) },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { id: true, agentId: true, conversationId: true, createdAt: true, decisionTrace: true, automationDeliveryKey: true, triggerMessageId: true },
      })
      const seen = new Set<string>()
      for (const t of turns) {
        if (out.queued >= PER_RUN_MAX) return out
        if (!t.conversationId || seen.has(t.conversationId)) continue
        seen.add(t.conversationId)
        const markers = readOutcomeMarkers(t.decisionTrace)
        if (markers?.handoffKind !== 'handoff') continue
        out.looked += 1
        // Only the chat's LATEST delivered turn counts (a later answer means nothing is pending).
        const later = await prisma.chatAgentTurn.findFirst({
          where: { tenantId, conversationId: t.conversationId, testSessionId: null, createdAt: { gt: t.createdAt }, status: { in: ['delivered', 'partially_delivered'] } },
          select: { id: true },
        })
        if (later) {
          skip('answered_later')
          continue
        }
        const conv = await prisma.chatConversation.findFirst({
          where: { id: t.conversationId, tenantId },
          select: { id: true, aiMode: true, lastInboundAt: true, socialAccountId: true, peerId: true, peerName: true, socialAccount: { select: { platform: true } } },
        })
        if (!conv) continue
        const trigger = t.triggerMessageId
          ? await prisma.chatMessage.findFirst({ where: { id: t.triggerMessageId, tenantId, conversationId: conv.id }, select: { sentAt: true } })
          : null
        // The hand-off burst: customer messages after the last store message before the trigger, and everything since.
        const lastOutBefore = trigger
          ? await prisma.chatMessage.findFirst({
              where: { tenantId, conversationId: conv.id, direction: 'outbound', sentAt: { lt: trigger.sentAt } },
              orderBy: { sentAt: 'desc' },
              select: { sentAt: true },
            })
          : null
        const from = lastOutBefore?.sentAt ?? trigger?.sentAt ?? t.createdAt
        const inbound = await prisma.chatMessage.findMany({
          where: { tenantId, conversationId: conv.id, direction: 'inbound', sentAt: { gt: from } },
          orderBy: { sentAt: 'asc' },
          take: 20,
          select: { id: true, content: true, messageType: true, sentAt: true },
        })
        const hoursSetup = await loadHoursSetup(tenantId, t.agentId).catch(() => null)
        const hours = hoursSetup ? afterHoursState(hoursSetup.hours, new Date(nowMs), { aiDisclosure: hoursSetup.aiDisclosure }) : null
        const decision = decideSoftRelease({
          handoffKind: markers.handoffKind,
          handoffReason: markers.handoffReason,
          handoffSubReason: markers.handoffSubReason,
          handoffWasRelease: Boolean(t.automationDeliveryKey?.startsWith(SOFT_RELEASE_KEY_PREFIX)),
          handoffAtMs: t.createdAt.getTime(),
          nowMs,
          aiMode: conv.aiMode,
          humanRepliedSince: await hasHumanRepliedAfter({ conversationId: conv.id, triggerSentAt: t.createdAt }),
          releasedRecently: await releasedRecently(tenantId, conv.id, nowMs),
          afterHours: hours ? hours.afterHours : true,
          lastInboundAtMs: conv.lastInboundAt?.getTime() ?? null,
          customerMessages: inbound.map((m) => ({ content: m.content || '', messageType: m.messageType })),
        })
        if (!decision.release) {
          skip(decision.reason)
          continue
        }
        const latest = inbound[inbound.length - 1]
        const platform = conv.socialAccount?.platform || 'whatsapp'
        const row = await persistJob({
          tenantId,
          conversationId: conv.id,
          messageId: latest.id,
          socialAccountId: conv.socialAccountId,
          peerId: conv.peerId,
          platform,
          content: latest.content || '',
          senderName: conv.peerName,
          deliveryKey: softReleaseDeliveryKey(t.id),
          payload: { softRelease: t.id },
        })
        if (row.duplicate) skip('already_queued')
        else out.queued += 1
      }
    }
  } catch (error) {
    console.error('[soft-release] sweep failed', error instanceof Error ? error.name : 'unknown')
  }
  return out
}
