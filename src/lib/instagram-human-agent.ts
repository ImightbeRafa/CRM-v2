/**
 * Instagram reply window for a PERSON replying from /chats (client-safe, no I/O).
 *
 * Meta: a free-form reply (messaging_type RESPONSE) is allowed within 24 h of the customer's last message. With the
 * Human Agent permission (App Review), a human agent may still reply up to 7 days after it, sending
 * messaging_type MESSAGE_TAG + tag HUMAN_AGENT. Only human replies: never the AI agent, follow-ups or automations
 * (those keep RESPONSE inside 24 h: agent-claim-gates / agent-turn).
 *
 * Inert until the permission is approved: the tag is used only when the server env META_IG_HUMAN_AGENT is "1".
 */

export const IG_STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000
export const IG_HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type IgReplyWindowState = 'open' | 'human_agent' | 'closed' | 'unknown'

export type IgReplyWindow = {
  state: IgReplyWindowState
  /** Until when a free-form reply is allowed (24 h) — null when unknown. */
  openUntil: string | null
  /** Until when a human may reply with HUMAN_AGENT (7 days) — only when the tag is enabled. */
  humanAgentUntil: string | null
}

export function instagramHumanAgentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.META_IG_HUMAN_AGENT || '').trim() === '1'
}

function toMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function igReplyWindow(
  lastInboundAt: Date | string | number | null | undefined,
  nowMs: number,
  humanAgentEnabled: boolean,
): IgReplyWindow {
  const last = toMs(lastInboundAt)
  if (last === null) return { state: 'unknown', openUntil: null, humanAgentUntil: null }
  const openUntil = new Date(last + IG_STANDARD_WINDOW_MS).toISOString()
  const humanAgentUntil = humanAgentEnabled ? new Date(last + IG_HUMAN_AGENT_WINDOW_MS).toISOString() : null
  const age = nowMs - last
  if (age < IG_STANDARD_WINDOW_MS) return { state: 'open', openUntil, humanAgentUntil }
  if (humanAgentEnabled && age < IG_HUMAN_AGENT_WINDOW_MS) return { state: 'human_agent', openUntil, humanAgentUntil }
  return { state: 'closed', openUntil, humanAgentUntil }
}

/** Graph fields for a human reply. `unknown` (no inbound recorded) keeps today's RESPONSE. */
export function igHumanSendFields(
  state: IgReplyWindowState,
): { messaging_type: 'RESPONSE' } | { messaging_type: 'MESSAGE_TAG'; tag: 'HUMAN_AGENT' } {
  return state === 'human_agent' ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : { messaging_type: 'RESPONSE' }
}

const dateFmt = new Intl.DateTimeFormat('es-CR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Costa_Rica',
})

export function formatIgDeadline(iso: string | null): string {
  const ms = toMs(iso)
  return ms === null ? '' : dateFmt.format(new Date(ms))
}

/** Composer hint for Instagram (null = nothing to say). */
export function igComposerHint(w: IgReplyWindow | null | undefined): { tone: 'info' | 'warn'; text: string } | null {
  if (!w) return null
  if (w.state === 'human_agent' && w.humanAgentUntil) {
    return {
      tone: 'info',
      text: `Ventana de 24 h cerrada · podés responder como agente humano hasta ${formatIgDeadline(w.humanAgentUntil)}`,
    }
  }
  if (w.state === 'closed') {
    return {
      tone: 'warn',
      text: w.humanAgentUntil
        ? 'Pasaron más de 7 días desde el último mensaje del cliente: Instagram no permite responder hasta que vuelva a escribir.'
        : 'Ventana de 24 h cerrada: Instagram no permite responder hasta que el cliente vuelva a escribir.',
    }
  }
  return null
}

export const IG_WINDOW_CLOSED_MESSAGE =
  'Instagram no permite responder: pasó la ventana desde el último mensaje del cliente. Podés responder cuando vuelva a escribir.'
export const IG_HUMAN_AGENT_NOT_APPROVED_MESSAGE =
  'Meta todavía no aprobó el permiso "Human Agent" para Betsy: por ahora solo se puede responder dentro de las 24 h del último mensaje del cliente.'

/**
 * Meta's answer to a failed Instagram send → a clean Spanish message, or null to keep the generic handling.
 * Codes: 10 / 200 are permission errors; with the HUMAN_AGENT tag they mean the permission is not approved.
 * Subcodes 2018278 / 2534022 (and "outside of allowed window") mean the messaging window has passed.
 */
export function mapInstagramSendError(
  providerResponse: unknown,
  usedHumanAgentTag: boolean,
): { message: string; reason: 'window_closed' | 'human_agent_not_approved' } | null {
  const err = (providerResponse as { error?: { code?: unknown; error_subcode?: unknown; message?: unknown } } | null)?.error
  if (!err) return null
  const code = Number(err.code)
  const subcode = Number(err.error_subcode)
  const text = String(err.message || '').toLowerCase()
  if (subcode === 2018278 || subcode === 2534022 || /outside of (the )?allowed window/.test(text)) {
    return { message: IG_WINDOW_CLOSED_MESSAGE, reason: 'window_closed' }
  }
  if (usedHumanAgentTag && (code === 10 || code === 200 || /human.?agent|tag/.test(text))) {
    return { message: IG_HUMAN_AGENT_NOT_APPROVED_MESSAGE, reason: 'human_agent_not_approved' }
  }
  return null
}
