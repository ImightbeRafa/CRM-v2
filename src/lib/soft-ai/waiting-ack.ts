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

/** "STOP", "no quiero bot", "no me escriban más": the customer asked for no automatic messages. */
const OPT_OUT_RE =
  /^\s*stop\b|\bbasta\b|\bunsubscribe\b|darme\s+de\s+baja|\bdejen\s+de\s+(escribir|mandar|contactar|molestar)|\b(ya\s+)?no\s+me\s+(escriban|escriba|manden|mande|contacten|contacte|molesten|contesten)\b|\bno\s+m[aá]s\s+mensajes\b|\bno\s+quiero\s+(m[aá]s\s+mensajes|que\s+me\s+(escriban|contacten))|\bno\s+quiero\s+(hablar\s+con\s+|que\s+me\s+(atienda|responda)\s+)?(un\s+|una\s+)?(bot|robot|ia|inteligencia\s+artificial|asistente\s+virtual|m[aá]quina)\b/iu

export function isOptOutText(text: string | null | undefined): boolean {
  return OPT_OUT_RE.test(text || '')
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
