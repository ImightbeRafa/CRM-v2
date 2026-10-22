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
  /** agents2-format: a contra-entrega order is complete — the customer got the confirmation, a person takes it. */
  orderReady: 'order_ready',
  /** N6: the same order review, the customer pays in cash (efectivo). */
  orderReadyCash: 'order_ready_cash',
  /** Rafael 2026-10-16: the agent did not have the answer ("no lo tengo acá, lo confirmo") — a person answers. */
  unknownAnswer: 'unknown_answer',
  /** The business's AI allowance for the period is used up (ai-allowance.ts): a person answers. */
  aiAllowance: 'ai_allowance',
} as const

/**
 * The agent's reply admits it does not have the answer / promises to check ("El detalle exacto no lo tengo acá. Lo
 * confirmo y te lo paso."). Model text only (code's own safe lines are not model text).
 */
// W / WE = word start / end that also work with accents ("bueno lo tengo" is not "no lo tengo").
const W = String.raw`(?<!\p{L})`
const WE = String.raw`(?!\p{L})`
const CHECK_VERB = String.raw`(?:confirmo|consulto|averiguo|verifico|reviso|pregunto|chequeo)`
/** "No tengo ese dato" forms: judged on the whole sentence ("…, ¿me lo pasás?" = the customer's data). */
const MISSING_SOURCE = [
  // "El detalle exacto de esa mezcla no lo tengo acá" — a store fact named before "no lo tengo".
  // A qualifier is required ("no la tengo, pero la de menta sí" is stock, not a missing fact).
  String.raw`${W}(?:detalles?|datos?|informaci[oó]n|info|composici[oó]n|f[oó]rmula|cantidad(?:es)?|mezcla|ingredientes?|componentes?)${WE}[^.?!\n]{0,50}${W}no\s+(?:lo|la|los|las)\s+tengo\s+(?:ac[aá]|aqu[ií]|a\s+mano|detallad\p{L}*|confirmad\p{L}*|exact\p{L}*|publicad\p{L}*)`,
  String.raw`${W}no\s+tengo\s+(?:ese|esa|el|la|esos|esas)\s+(?:dato|detalle|informaci[oó]n|info)s?${WE}(?!\s+de\s+(?:tu|su)${WE})`,
  String.raw`${W}no\s+(?:cuento\s+con|manejo)\s+(?:ese|esa|el|la|los|las)\s+(?:dato|detalle|informaci[oó]n|info)s?${WE}(?!\s+de\s+(?:tu|su)${WE})`,
]
/** Promise-to-check forms: judged on their own words (a "¿Hacemos el pedido?" after an emoji does not cancel them). */
const PROMISE_SOURCE = [
  // "Lo confirmo y te lo paso", "Lo reviso y te confirmo", "Lo confirmo con el equipo y te aviso".
  String.raw`${W}(?:lo|la|los|las|eso)\s+${CHECK_VERB}(?:\s+[\p{L}]+){0,3}?\s+y\s+te\s+(?:l[oa]s?\s+)?(?:paso|pasos|aviso|confirmo|cuento|escribo|digo)${WE}`,
  String.raw`${W}(?:eso\s+)?te\s+l[oa]s?\s+confirmo\s+(?:en\s+un\s+rat(?:o|ito)|ahorita|en\s+breve|m[aá]s\s+tarde|luego|pronto|en\s+un\s+momento)`,
  // Without a pronoun only when the sentence ends there ("Te confirmo en un ratito 😊"), not "Te confirmo en un momento cuál…".
  String.raw`${W}te\s+confirmo\s+(?:en\s+un\s+rat(?:o|ito)|ahorita|en\s+breve|m[aá]s\s+tarde|luego|pronto|en\s+un\s+momento)(?=\s*(?:[.!…]|\p{Extended_Pictographic}|$))`,
  // Only the "…lo" forms: "Dejame preguntar: ¿es para vos?" is a sales question.
  String.raw`${W}(?:d[eé]jame|perm[ií]teme)\s+(?:consultarl[oa]s?|averiguarl[oa]s?|preguntarl[oa]s?|confirmarl[oa]s?)${WE}`,
  String.raw`${W}(?:voy\s+a|tengo\s+que)\s+(?:consultar|confirmar|averiguar|preguntar)lo${WE}`,
  String.raw`${W}(?:ese\s+dato|ese\s+detalle|eso)\s+l[oa]s?\s+tengo\s+que\s+(?:confirmar|consultar|averiguar|preguntar)${WE}`,
]
/** Both families (the test chat's "must know" check uses this). */
export const CANNOT_ANSWER_SOURCE = [...MISSING_SOURCE, ...PROMISE_SOURCE].join('|')
const CANNOT_ANSWER_RE = new RegExp(CANNOT_ANSWER_SOURCE, 'iu')
const MISSING_RE = new RegExp(MISSING_SOURCE.join('|'), 'iu')
const PROMISE_RE = new RegExp(PROMISE_SOURCE.join('|'), 'iu')

/**
 * A sentence about the order / payment / the customer's own data is not a missing store fact ("El total lo confirmo
 * al preparar el pedido", "No tengo tu provincia, ¿me la pasás?"): those keep their own flow.
 */
// ("su / sus" stay out: "su composición" is the product; the customer's own data is "tu".)
const NOT_A_STORE_FACT_RE =
  /(?<!\p{L})(?:total|pedido|orden|comprobante|pago|sinpe|transferencia|tu|tus|me\s+l[oa]s?\s+pas[aá]s|pas[aá]me|stock|talla|disponib\p{L}*|en\s+bodega|quedan|me\s+queda|direcci[oó]n|datos\s+de\s+env[ií]o|provincia|cant[oó]n|distrito|nombre|tel[eé]fono|correo|se[nñ]as)(?!\p{L})/iu

/** Whole sentences of one line (a "¿…?" stays inside its sentence): what detection judges. */
const sentencesOf = (line: string) => line.match(/[^.!?…]+[.!?…]*|[.!?…]+/gu) ?? [line]
/** Finer pieces for the cut: a "¿…?" question is its own piece even after an emoji. */
const piecesOf = (line: string) => line.match(/¿[^¿]*?(?:\?+|$)|[^.!?…¿]+[.!?…]*|[.!?…]+/gu) ?? [line]
const isQuestion = (s: string) => /^\s*¿/.test(s) || /\?\s*\p{Extended_Pictographic}*\s*$/u.test(s.trim())

/** A sentence of the line admits not having a store fact (Betsy's own fixed lines never count). */
function cannotAnswerLine(line: string, own: Set<string>): boolean {
  if (own.has(line.trim())) return false
  return sentencesOf(line).some(
    (s) =>
      (MISSING_RE.test(s) && !NOT_A_STORE_FACT_RE.test(s)) ||
      // The promise piece alone (without the "¿…?" after it) decides: "lo confirmo y te lo paso 😊 ¿Hacemos el pedido?".
      piecesOf(s).some((p) => !isQuestion(p) && PROMISE_RE.test(p) && !NOT_A_STORE_FACT_RE.test(p)),
  )
}

const ownLines = () => new Set(Object.values(SAFE_LINE).map((s) => s.trim()))

export function admitsCannotAnswer(text: string): boolean {
  // Betsy's own fixed lines ("¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊") are never a missing answer.
  const own = ownLines()
  return (text || '').split('\n').some((line) => cannotAnswerLine(line, own))
}

/** Pieces minus the questions (and a "Mientras tanto," lead-in left dangling before one), tidied. */
function dropQuestions(pieces: string[], keepUpTo: number): string {
  const kept: string[] = []
  let removed = false
  pieces.forEach((p, i) => {
    if (i <= keepUpTo || !isQuestion(p)) {
      kept.push(p)
      return
    }
    removed = true
    if (kept.length - 1 > keepUpTo && /,\s*$/.test(kept[kept.length - 1])) kept.pop()
  })
  const joined = kept.join('')
  // Only a line that lost a question is tidied ("…te lo paso, ¿te parece?" → "…te lo paso."); a list lead-in keeps its ":".
  return removed ? joined.replace(/[ \t]{2,}/g, ' ').trimEnd().replace(/\s*[,:;]$/, '.') : joined.trimEnd()
}

/**
 * What goes out with a "no lo sé" hand-off: the whole reply (what the agent DID know, lists, payment blocks) minus the
 * questions AFTER the "no lo tengo / lo confirmo" sentence — the sales push ("¿Con eso te alcanza para decidir, o te lo
 * llevás?") never follows a promise to check. Nothing before it is touched.
 */
export function cutAfterCannotAnswer(text: string): string {
  if (!admitsCannotAnswer(text)) return text
  const own = ownLines()
  let seen = false
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (seen) {
      // A data list / payment block line has no question mark and stays; a question goes.
      const kept = dropQuestions(piecesOf(line), -1)
      if (line.trim() && !kept.trim()) continue
      out.push(kept)
      continue
    }
    if (!cannotAnswerLine(line, own)) {
      out.push(line)
      continue
    }
    seen = true
    const pieces = piecesOf(line)
    const at = pieces.findIndex((p) => CANNOT_ANSWER_RE.test(p))
    // (A cue split across pieces cannot happen in practice; then keep the line whole.)
    out.push(at < 0 ? line : dropQuestions(pieces, at))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

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

/** A hand-off about money (payment / receipt, refund or charge complaint): the customer gets the payment line. */
export function isPaymentHandoffReason(reason: string | null | undefined): boolean {
  return reason === HANDOFF_REASON.payment || reason === HANDOFF_REASON.refund
}

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
  /**
   * agents2-format: the checked reply carries the filled contra-entrega block ([[PAGO_CONTRA_ENTREGA]]): the order is
   * ready — the reply goes out first, then a TRUE hand-off with reason 'order_ready' (settleHandoff after the send).
   */
  codOrderReady?: boolean
  /** N6: the order is paid in cash (a filled [[PAGO_EFECTIVO]] the customer chose) → reason 'order_ready_cash'. */
  orderReadyCash?: boolean
}): TurnDeliveryPlan {
  const text = (input.text || '').trim()
  const usable = input.textOk && text.length > 0
  if (input.receiptCue) return { text: SAFE_LINE.payment, handoff: { kind: 'handoff', reason: HANDOFF_REASON.payment } }
  // INT-93: the reply sounded like a payment confirmation (or the model asked for a person about a payment): fixed text,
  // the chat goes to a person — whatever else is configured.
  if (input.llmEscalateReason === 'payment_claim') {
    return { text: SAFE_LINE.payment, handoff: input.llmHandoff ?? { kind: 'handoff', reason: HANDOFF_REASON.payment } }
  }
  const modelPaymentEscalate = input.llmEscalateReason === 'payment_or_sinpe'
  if (input.codOrderReady && !modelPaymentEscalate && input.llmHandoff?.kind !== 'review') {
    // SecureDog INT-117: a reply that failed a check (e.g. "tu pedido quedó registrado") never goes out as written —
    // the safe line does — but the order still reaches a person (the hand-off is never lost).
    return {
      text: usable ? text : SAFE_LINE.review,
      handoff: { kind: 'handoff', reason: input.orderReadyCash ? HANDOFF_REASON.orderReadyCash : HANDOFF_REASON.orderReady },
    }
  }
  const cannotAnswer = usable && admitsCannotAnswer(text)
  if (input.llmHandoff?.kind === 'handoff' && !(input.paymentDataByTeam && modelPaymentEscalate)) {
    // v53 tests 2026-10-18: "¡Gracias! … ya lo reviso" is the PAYMENT line. A hand-off for anything else whose own text
    // cannot go out ("¿de verdad funciona?", "¿dónde retiro?", "¿cuándo vuelve el NAD+?") gets the neutral safe line.
    const paymentHandoff = modelPaymentEscalate || isPaymentHandoffReason(input.llmHandoff.reason)
    return {
      text: modelPaymentEscalate ? SAFE_LINE.payment : !usable ? (paymentHandoff ? SAFE_LINE.payment : SAFE_LINE.review) : cannotAnswer ? cutAfterCannotAnswer(text) : text,
      handoff: input.llmHandoff,
    }
  }
  // Rafael 2026-10-16: "no lo tengo acá, lo confirmo" without escalate_to_human left nobody answering while the agent
  // kept selling. The answer the agent did have goes out, then the chat goes to a person (alert), whatever it called.
  // (Payment data sent by the team keeps its own review + "Enseguida te paso cómo pagar" below: a person looks anyway.)
  if (cannotAnswer && !modelPaymentEscalate && !input.paymentDataByTeam) {
    return { text: cutAfterCannotAnswer(text), handoff: { kind: 'handoff', reason: HANDOFF_REASON.unknownAnswer } }
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
