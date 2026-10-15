/**
 * Shared send / suggest / skip decision for live delivery and Probar.
 * Probar `wouldSend` is `outcome === 'send'` after the model, never before.
 */

import type { EffectiveAgentBehavior } from '@/lib/soft-ai/agent-types'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { reservedShortcutBody } from '@/lib/soft-ai/shortcuts'

export type AgentTurnOutcomeName = 'send' | 'suggest' | 'skip'

export type AgentTurnOutcome = {
  outcome: AgentTurnOutcomeName
  reason: string | null
}

export type OutcomeMarkers = {
  needsHuman: boolean
  fallbackUsed: boolean
  escalate: boolean
  /** Agentes IA 2.0: the text was planned by code (answer, safe line or hand-off text) and may be sent. */
  planned?: boolean
  handoffKind?: 'handoff' | 'review' | null
  handoffReason?: string | null
}

/**
 * Agentes IA 2.0 (B1). 'handoff' = a TRUE hand-off (payment proof / claim, refund or complaint, "quiero hablar con una
 * persona", escalate_to_human called by the model, the owner's own hand-off reply): the customer gets the text, then the
 * chat goes to the team (aiMode 'human'). 'review' = the customer gets a safe line, the chat STAYS on IA and a person is
 * asked to look (notifyHandoff kind 'review'). reason = a short code (HANDOFF_REASON), never model or customer text.
 */
export type TurnHandoff = { kind: 'handoff' | 'review'; reason: string }

/** Reason CODES for notifyHandoff (stream C maps them to plain Spanish for the team). */
export const HANDOFF_REASON = {
  payment: 'payment',
  refund: 'complaint',
  optOut: 'human_request',
  ownerReply: 'owner_reply',
  modelAsked: 'escalate',
  paymentData: 'payment_details',
  review: 'review',
} as const

/** Customer texts code sends instead of a reply that cannot go out as written (reserved, tuteo, seller voice). */
export const SAFE_LINE = {
  /** Validator / technical failure: "Dame un momento y te confirmo 😊" (chat stays on IA). */
  review: reservedShortcutBody('sys_handoff_unavailable'),
  /** Payment proof / claim: "¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊". */
  payment: reservedShortcutBody('sys_handoff_payment'),
  /** Close with payment data not shared by chat: "Enseguida te paso cómo pagar 😊". */
  paymentSoon: reservedShortcutBody('sys_payment_soon'),
} as const

export type TurnDeliveryPlan = { text: string; handoff: TurnHandoff | null }

const SAYS_HOW_TO_PAY_RE = /c[oó]mo\s+pagar|datos\s+(de|para)\s+(pago|pagar)|te\s+paso\s+c[oó]mo/i

/**
 * What a model turn sends (pure; live turn and test chat). A reply that failed a fixed rule is NEVER sent as written:
 * the customer gets a fixed safe line. Payment claims always get the fixed payment line, never model wording.
 */
export function planModelTurnDelivery(input: {
  text: string
  /** The model reply passed every output check (runtime validation + final policy). */
  textOk: boolean
  llmHandoff: TurnHandoff | null
  /** Raw escalate_to_human reason the model used (payment_or_sinpe, opt_out, …), if any. */
  llmEscalateReason?: string | null
  /** Code saw a receipt / "ya pagué" cue in the customer message (sales-state). */
  receiptCue?: boolean
  /** Close with payment data not shared by chat (sales-state salesCloseWithoutPaymentData). */
  paymentDataByTeam?: boolean
}): TurnDeliveryPlan {
  const text = (input.text || '').trim()
  const usable = input.textOk && text.length > 0
  if (input.receiptCue) return { text: SAFE_LINE.payment, handoff: { kind: 'handoff', reason: HANDOFF_REASON.payment } }
  const modelPaymentEscalate = input.llmEscalateReason === 'payment_or_sinpe'
  if (input.llmHandoff?.kind === 'handoff' && !(input.paymentDataByTeam && modelPaymentEscalate)) {
    return {
      text: modelPaymentEscalate || !usable ? SAFE_LINE.payment : text,
      handoff: input.llmHandoff,
    }
  }
  if (input.paymentDataByTeam) {
    return {
      text: usable ? (SAYS_HOW_TO_PAY_RE.test(text) ? text : `${text}\n${SAFE_LINE.paymentSoon}`) : SAFE_LINE.paymentSoon,
      handoff: { kind: 'review', reason: HANDOFF_REASON.paymentData },
    }
  }
  if (input.llmHandoff || !usable) {
    return { text: SAFE_LINE.review, handoff: { kind: 'review', reason: input.llmHandoff?.reason || HANDOFF_REASON.review } }
  }
  return { text, handoff: null }
}

/** What a code-decided turn (payment / opt-out / media / saved reply) sends: its own text when it passed the checks. */
export function planDecisionDelivery(input: { text: string; textOk: boolean; handoff: TurnHandoff | null }): TurnDeliveryPlan {
  const text = (input.text || '').trim()
  if (input.textOk && text) return { text, handoff: input.handoff }
  return { text: SAFE_LINE.review, handoff: input.handoff ?? { kind: 'review', reason: HANDOFF_REASON.review } }
}

/**
 * Live checks Probar does not run. Informational only — never report them as passed.
 */
export const PROBAR_NOT_SIMULATED_GATES = [
  'token_health',
  'stale_version',
  'human_replied',
  'live_daily_cap',
] as const

/**
 * Stable skip priority. F1 (Rafael 2026-10-08): there is no suggestion MODE anymore — an agent either answers
 * (activated: ai_full + Activar record) or stays silent ('not_activated'). A turn the model could not answer
 * safely (needs_human / fallback / escalate) is still kept as a draft ('suggest') for the team, never sent.
 */
const HARD_SKIP_REASONS = [
  'not_bound_to_channel',
  'flag_off',
  'account_not_allowlisted',
  'no_binding',
  'binding_inactive',
  'agent_not_live',
  'draft_agent',
  'model_not_allowed',
  'human_only',
  'schema_not_ready',
  'test_budget_blocked',
  'human_replied',
  'stale_version',
  'token_unhealthy',
  'window_closed',
  'budget_blocked',
  'superseded',
] as const

const SUGGEST_ONLY_BLOCKER = 'ai_full_not_unlocked'

export function behaviorForOperationMode(operationMode: string): EffectiveAgentBehavior {
  if (operationMode === 'ai_full') return 'send'
  if (operationMode === 'ai_suggest') return 'suggest'
  if (operationMode === 'human_only') return 'human_only'
  return 'human_only'
}

export function decideTurnOutcome(input: {
  effectiveBehavior: EffectiveAgentBehavior
  unlockedForSend: boolean
  needsHuman: boolean
  fallbackUsed: boolean
  escalate: boolean
  conversationAiMode: SoftAiAgentMode | null | undefined
  gateBlockers: readonly string[]
  /**
   * Agentes IA 2.0 (B1): the text was planned by code (planModelTurnDelivery / planDecisionDelivery) — a safe line or
   * a vetted hand-off text — so needsHuman / fallback / escalate no longer turn it into a silent draft.
   */
  plannedReply?: boolean
}): AgentTurnOutcome {
  const mode = input.conversationAiMode
  if (mode === 'paused') return { outcome: 'skip', reason: 'paused_before_send' }
  if (mode === 'human') return { outcome: 'skip', reason: 'human_before_send' }
  if (mode !== 'ai_active') return { outcome: 'skip', reason: 'missing_mode' }

  for (const reason of HARD_SKIP_REASONS) {
    if (input.gateBlockers.includes(reason)) return { outcome: 'skip', reason }
  }
  const other = input.gateBlockers.find((reason) => reason !== SUGGEST_ONLY_BLOCKER)
  if (other) return { outcome: 'skip', reason: other }

  if (!input.plannedReply) {
    if (input.fallbackUsed) return { outcome: 'suggest', reason: 'fallback_used' }
    if (input.needsHuman) return { outcome: 'suggest', reason: 'needs_human' }
    if (input.escalate) return { outcome: 'suggest', reason: 'escalate' }
  }

  switch (input.effectiveBehavior) {
    case 'suggest':
      // Legacy 'ai_suggest' agents are simply not activated (no suggestion mode).
      return { outcome: 'skip', reason: 'not_activated' }
    case 'human_only':
      return { outcome: 'skip', reason: 'human_only' }
    case 'skip':
      return { outcome: 'skip', reason: 'human_only' }
    case 'send':
      if (!input.unlockedForSend || input.gateBlockers.includes(SUGGEST_ONLY_BLOCKER)) {
        return { outcome: 'skip', reason: 'not_activated' }
      }
      return { outcome: 'send', reason: null }
    default: {
      const _exhaustive: never = input.effectiveBehavior
      return { outcome: 'skip', reason: String(_exhaustive) }
    }
  }
}

export function readOutcomeMarkers(trace: unknown): OutcomeMarkers | null {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return null
  const raw = (trace as { outcomeMarkers?: unknown }).outcomeMarkers
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (typeof row.needsHuman !== 'boolean') return null
  if (typeof row.fallbackUsed !== 'boolean') return null
  if (typeof row.escalate !== 'boolean') return null
  const kind = row.handoffKind === 'handoff' || row.handoffKind === 'review' ? row.handoffKind : null
  return {
    needsHuman: row.needsHuman,
    fallbackUsed: row.fallbackUsed,
    escalate: row.escalate,
    ...(row.planned === true ? { planned: true } : {}),
    ...(kind ? { handoffKind: kind, handoffReason: typeof row.handoffReason === 'string' ? row.handoffReason.slice(0, 120) : null } : {}),
  }
}

export function withOutcomeMarkers(trace: unknown, markers: OutcomeMarkers): unknown {
  if (trace && typeof trace === 'object' && !Array.isArray(trace)) {
    return { ...(trace as Record<string, unknown>), outcomeMarkers: markers }
  }
  return { outcomeMarkers: markers }
}

/**
 * Loop cap (B1): at most ONE safe line per chat per 30 min. A second technical failure in that window sends nothing
 * more and becomes a TRUE hand-off (a person takes the chat) instead of repeating "Dame un momento…".
 */
export function applySafeLineCap(
  plan: TurnDeliveryPlan,
  safeLineSentRecently: boolean,
): TurnDeliveryPlan & { suppressSend: boolean } {
  if (safeLineSentRecently && plan.handoff?.kind === 'review' && plan.text === SAFE_LINE.review) {
    return { text: plan.text, handoff: { kind: 'handoff', reason: plan.handoff.reason }, suppressSend: true }
  }
  return { ...plan, suppressSend: false }
}

export const DELAY_APOLOGY = '¡Perdón la demora!'
export const DELAY_APOLOGY_AFTER_MS = 30 * 60_000

/** B9: a customer message answered late by the waiting sweep (> 30 min) opens with "¡Perdón la demora!". */
export function withDelayApology(text: string, input: { sweep: boolean; messageAgeMs: number }): string {
  if (!input.sweep || input.messageAgeMs < DELAY_APOLOGY_AFTER_MS || !text.trim() || text.startsWith(DELAY_APOLOGY)) return text
  return `${DELAY_APOLOGY} ${text}`
}
