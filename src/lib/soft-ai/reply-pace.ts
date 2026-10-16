/**
 * agents2-pace (Rafael 2026-10-16): "Velocidad de respuesta" — how fast an agent's reply goes out in a real chat.
 * 'instant' = the old behaviour (first message at once, 700 ms between messages); 'natural' / 'calm' wait a typing
 * time per message from its length. Time already spent since the customer wrote (the model thinking, the debounce)
 * counts as typing. Never past the parts deadline; at most MAX_TURN_PACING_MS added per turn. Pure and client-safe
 * (live send loop, settings route, Probar note).
 */
import { z } from 'zod'
import { REPLY_PART_GAP_MS } from '@/lib/soft-ai/reply-parts'

export const REPLY_PACES = ['instant', 'natural', 'calm'] as const
export type ReplyPace = (typeof REPLY_PACES)[number]
export const DEFAULT_REPLY_PACE: ReplyPace = 'natural'

/** Strict (settings PUT): an unknown value is refused. */
export const replyPaceSchema = z.enum(REPLY_PACES)
/** Stored value (salesRules jsonb): missing / unknown → the default. */
export const storedReplyPaceSchema = replyPaceSchema.catch(DEFAULT_REPLY_PACE)

export function parseReplyPace(raw: unknown): ReplyPace {
  return storedReplyPaceSchema.parse(raw)
}

export const REPLY_PACE_OPTIONS: Array<{ key: ReplyPace; label: string; hint: string }> = [
  { key: 'instant', label: 'Al instante', hint: 'Responde apenas llega el mensaje.' },
  { key: 'natural', label: 'Natural', hint: 'Espera unos segundos como si escribiera (recomendado).' },
  { key: 'calm', label: 'Pausado', hint: 'Deja más tiempo entre mensajes.' },
]

/** Typing time per message: base + per character, clamped. */
export const PACE_PROFILES: Record<Exclude<ReplyPace, 'instant'>, { baseMs: number; perCharMs: number; minMs: number; maxMs: number }> = {
  natural: { baseMs: 1_200, perCharMs: 35, minMs: 1_500, maxMs: 6_000 },
  calm: { baseMs: 2_000, perCharMs: 55, minMs: 3_000, maxMs: 9_000 },
}

/** Most pacing one turn may add (all waits together). */
export const MAX_TURN_PACING_MS = 15_000
/** Pacing never waits into the last stretch before the parts deadline (room to send what is left). */
export const PACE_DEADLINE_RESERVE_MS = 3_000
/** The WhatsApp "escribiendo…" call never holds the reply longer than this. */
export const TYPING_INDICATOR_TIMEOUT_MS = 2_000

/** Typing time for one message of `chars` characters (0 for 'instant'). */
export function typingDelayMs(pace: ReplyPace, chars: number): number {
  if (pace === 'instant') return 0
  const p = PACE_PROFILES[pace]
  const raw = p.baseMs + p.perCharMs * Math.max(0, Math.floor(chars))
  return Math.min(p.maxMs, Math.max(p.minMs, raw))
}

export type PartWait = {
  /** How long to wait before sending this message. */
  waitMs: number
  /** Late turn: send everything left now as one message (remainderPart). Only for messages after the first. */
  late: boolean
}

/**
 * Wait before message `index` of a reply.
 * - `spentMs`: time already spent that counts as typing — for the first message, since the customer's message
 *   arrived (model latency included); for later ones, since the previous message went out.
 * - `pacedSoFarMs`: waits already added in this turn (the 15 s cap).
 * - `deadlineAt`: the parts deadline (turn start + AGENT_PARTS_DEADLINE_MS).
 */
export function planPartWait(input: {
  pace: ReplyPace
  index: number
  chars: number
  now: number
  spentMs: number
  pacedSoFarMs: number
  deadlineAt: number
}): PartWait {
  const { pace, index, now, deadlineAt } = input
  if (pace === 'instant') {
    if (index === 0) return { waitMs: 0, late: false }
    if (now + REPLY_PART_GAP_MS > deadlineAt) return { waitMs: 0, late: true }
    return { waitMs: REPLY_PART_GAP_MS, late: false }
  }
  // Same late rule as 'instant' for later messages: past it, no more pacing, the rest goes out as one message.
  if (index > 0 && now + REPLY_PART_GAP_MS > deadlineAt) return { waitMs: 0, late: true }
  let waitMs = Math.max(0, typingDelayMs(pace, input.chars) - Math.max(0, input.spentMs))
  waitMs = Math.min(waitMs, Math.max(0, MAX_TURN_PACING_MS - Math.max(0, input.pacedSoFarMs)))
  // Short budget left: no wait at all (never pushes a send toward the processing timeout).
  if (now + waitMs > deadlineAt - PACE_DEADLINE_RESERVE_MS) waitMs = 0
  return { waitMs: Math.round(waitMs), late: false }
}

/** Browser event the pace toggle fires after a save (Probar's note listens). */
export const REPLY_PACE_EVENT = 'betsy:agent-reply-pace'

/** Probar note: rough seconds between messages for this pace (a typical ~100-character message). */
export function paceNoteText(pace: ReplyPace): string {
  if (pace === 'instant') return 'En WhatsApp se envía Al instante (sin espera entre mensajes).'
  const label = pace === 'calm' ? 'Pausado' : 'Natural'
  const secs = Math.round(typingDelayMs(pace, 100) / 1000)
  return `En WhatsApp se envía con ritmo ${label} (~${secs} s entre mensajes). Aquí la respuesta llega al instante.`
}
