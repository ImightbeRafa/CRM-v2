/**
 * luna-10 #4 (2026-10-17, live PatchHouse): after the agent handed a chat to a person, the customer wrote "???" and
 * "¿Me podría atender un asesor?" — both turns were skipped (human_before_send) and the customer got silence for
 * 3 h 20 min. Now, when the customer writes again while a hand-off is still waiting on a person:
 *  - the customer gets ONE code-written line per hand-off ("Ya le avisé al equipo…", after hours: when they write);
 *  - the team is alerted again ('customer_waiting'), once per customer message.
 * Never when a person already wrote after the hand-off, never when a person took the chat by hand (no agent
 * hand-off turn), never when the line is off (kill switch / platform pause / AI terms included), never after an opt-out.
 * Never changes aiMode. Pure (decision + texts); the send lives in
 * agent-turn.ts.
 */
import type { AfterHoursState } from '@/lib/soft-ai/business-hours'

export const WAITING_ACK_KEY_PREFIX = 'waiting_ack:'
/** A hand-off older than this is no longer "waiting" (the 24 h reply window has closed anyway). */
export const WAITING_ACK_MAX_AGE_MS = 24 * 3_600_000
/** SecureDog: one "sigue esperando" team alert per chat per this window. */
export const WAITING_ALERT_THROTTLE_MS = 15 * 60_000

export const WAITING_ACK_TEXT = 'Ya le avisé al equipo 🙌 En un momento te escriben por aquí 😊'

export function waitingAckKey(handoffTurnId: string): string {
  return `${WAITING_ACK_KEY_PREFIX}${handoffTurnId}`
}

export function waitingAckText(hours: Pick<AfterHoursState, 'afterHours' | 'label'>): string {
  if (!hours.afterHours) return WAITING_ACK_TEXT
  return `Ya le avisé al equipo 🙌 Te escriben ${hours.label} 😊`
}

export type WaitingAckDecision = { ack: boolean; realert: boolean; reason: string }

/**
 * "STOP", "no quiero bot", "no me escriban más": the customer asked for no automatic messages. Deliberately not the
 * safety router's opt-out (llm/safety-router.ts): that one also covers "quiero hablar con una persona", and THAT
 * customer should get the ack.
 */
const STOP_CONTACT_RE =
  /^\s*stop\b|\bunsubscribe\b|darme\s+de\s+baja|d[eé]jen?me\s+en\s+paz|\bdejen\s+de\s+(escribir|mandar|contactar|molestar)|\b(ya\s+)?no\s+me\s+(escriban|escribas|escriba|manden|mandes|mande|contacten|contactes|contacte|molesten|molestes|vuelvan\s+a\s+(escribir|contactar))(\s+(m[aá]s|nada|nunca|ya))*(\s+por\s+favor)?[\s.!]*$|\bno\s+me\s+(escriban|escribas|manden|mandes|contacten|molesten)\s+(m[aá]s|nada|nunca)\b|\b(ya\s+)?no\s+(m[aá]s\s+mensajes|quiero\s+(recibir\s+)?(m[aá]s\s+)?mensajes|quiero\s+que\s+me\s+(escriban|contacten))\b/iu
const BASTA_RE = /\bbasta\b/iu
const PLEASE = String.raw`(?:por\s*favor|porfa|x\s*favor|plis|pls)`
/** The whole message is just "basta" (+ "ya" / "por favor" / punctuation / emoji): "¡Basta!", "ya basta porfa", "basta 😡". */
const BASTA_ALONE_RE = new RegExp(String.raw`^(${PLEASE}\s+)?(ya\s+)?basta(\s+ya)?(\s+${PLEASE})?(\s+ya)?$`, 'iu')
/**
 * "basta" that asks to stop the messages: "basta de mensajes / de escribirme / de llamarme", "basta con el spam". After
 * "con" only a noun: "¿Basta con escribir mi dirección?" is a checkout question.
 */
const BASTA_MESSAGES_RE = new RegExp(
  String.raw`\bbasta\s+(ya\s+)?(de\s+((estar|seguir)\s+)?(mensaj\w*|escrib\w*|mand\w*|envi\w*|llam\w*|contact\w*|molest\w*|insist\w*|spam|promociones|publicidad|notificaciones)|con\s+((los|las|el|la|sus|tus|su|tu|tant[oa]s?)\s+)?(mensaj\w*|spam|promociones|publicidad|notificaciones))\b`,
  'iu',
)
/**
 * With a "basta", these ask to stop the messages too: "Basta, ¿pueden dejar de escribirme?", "…que no me escriban?".
 * Not "no me manden": "Basta con uno, no me manden el kit" is an order detail.
 */
const STOP_MESSAGES_CUE_RE =
  /\bdej(ar|en)\s+de\s+(escribir|mandar|contactar|molestar)|\bno\s+me\s+(escriban|escribas|contacten|molesten)\s*([¿?.!,;]|$|m[aá]s\b|nunca\b|nada\b)/iu

/**
 * Router "basta" (Rafael 2026-10-17: Sofi sells; a false hand-off on a product or courtesy line loses the sale): only a
 * bare "basta" or a "basta" about the messages. "Basta un parche al día", "¿Basta con uno?", "Basta, gracias", "me basta
 * con uno" stay with the model. "basta, no me escriban" hands off through STOP_CONTACT_RE.
 */
function isRouterBastaStop(text: string): boolean {
  const bare = text
    .replace(/[\s¡!¿?.,…;:]+|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    BASTA_ALONE_RE.test(bare) ||
    BASTA_MESSAGES_RE.test(text) ||
    (BASTA_RE.test(text) && STOP_MESSAGES_CUE_RE.test(text))
  )
}
// Router only: a quantity or another channel is an order detail, not a stop ("no me manden más de 3", "nada al correo").
const STOP_DETAIL_RE = /\b(m[aá]s\s+de\s+(\d+|un[oa]?|dos|tres|cuatro|cinco)|nada\s+al\s+(correo|mail|email))\b/giu
const BOT_REFUSAL_RE =
  /\bno\s+quiero\s+(hablar\s+con\s+|que\s+me\s+(atienda|responda)\s+)?(un\s+|una\s+)?(bot|robot|ia|inteligencia\s+artificial|asistente\s+virtual|m[aá]quina)\b/iu

/**
 * "Stop writing to me" (STOP, basta, no me escriban más, darme de baja…) without the bot refusals. Shared with the
 * safety router's opt-out (llm/safety-router.ts) so the hand-off is at least as wide as this list (SecureDog, PR #100).
 * The router ends the AI sale on a match, so there "basta" counts only bare or about the messages (isRouterBastaStop)
 * and an order detail (STOP_DETAIL_RE) is no stop. The waiting ack keeps the base list (a false match there only skips one ack).
 */
export function isStopContactText(text: string | null | undefined): boolean {
  const t = text || ''
  return (
    // A stand-in word, not a space: "no me manden ⟨detail⟩" must not end the message for the anchored form.
    STOP_CONTACT_RE.test(t.replace(STOP_DETAIL_RE, ' detalle ')) ||
    isRouterBastaStop(t)
  )
}

export function isOptOutText(text: string | null | undefined): boolean {
  const t = text || ''
  return STOP_CONTACT_RE.test(t) || BASTA_RE.test(t) || BOT_REFUSAL_RE.test(t)
}

export function decideWaitingAck(input: {
  /** The latest delivered agent turn of the chat (waiting acks excluded). */
  lastTurn: { id: string; handoffKind: string | null; completedAt: Date | null } | null
  /** A person (not the AI) wrote in the chat after that turn. */
  humanWroteSince: boolean
  /** The line is on: ai_full + activated + kill switch off. */
  lineOn: boolean
  /** This hand-off already got its one ack. */
  alreadyAcked: boolean
  /** The hand-off came from an opt-out ("STOP", "no quiero bot"): alert the team, never write to the customer. */
  optOut?: boolean
  now: Date
}): WaitingAckDecision {
  const no = (reason: string): WaitingAckDecision => ({ ack: false, realert: false, reason })
  if (!input.lastTurn) return no('no_agent_turn')
  if (input.lastTurn.handoffKind !== 'handoff') return no('not_an_agent_handoff')
  const at = input.lastTurn.completedAt?.getTime() ?? 0
  if (!at || input.now.getTime() - at > WAITING_ACK_MAX_AGE_MS) return no('handoff_too_old')
  if (input.humanWroteSince) return no('person_already_answered')
  // Verifier round 2 #6: line off / kill switch → the team still hears the customer is waiting; nothing automatic.
  if (!input.lineOn) return { ack: false, realert: true, reason: 'line_off' }
  if (input.alreadyAcked) return { ack: false, realert: true, reason: 'already_acked' }
  if (input.optOut) return { ack: false, realert: true, reason: 'opt_out' }
  return { ack: true, realert: true, reason: 'customer_waiting' }
}
