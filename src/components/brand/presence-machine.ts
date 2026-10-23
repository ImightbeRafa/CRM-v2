/**
 * Betsy presence state machine (pure, no timers): the live mark's state from signals and the clock.
 * Two layers, so short reactions never cancel a reply in progress:
 *   - reply: think / typing until `done` or the watchdog deadline;
 *   - flash: listen (1.2 s) or yes (2 s) shown on top, then the mark returns to the reply layer.
 * A read / Respondido plays the double blink for 700 ms on top of whatever is showing.
 * The hook (`useBetsyPresence`) only stores this state and re-renders at `nextDeadline`.
 */
import type { BetsyState } from './BetsyMark'
import type { BetsySignal } from './betsy-signals'

export const PRESENCE_TIMING = {
  /** A think/typing that never gets its "done" falls back to idle. Re-sending typing re-arms it. */
  replyWatchdogMs: 20_000,
  listenMs: 1_200,
  yesMs: 2_000,
  /** The double blink lasts 640 ms; then the slow idle blink comes back. */
  readBlinkMs: 700,
} as const

export type PresenceState = {
  reply: 'think' | 'typing' | null
  replyUntil: number
  flash: 'listen' | 'yes' | null
  flashUntil: number
  /** Bumped on each read: the mark replays the double blink when it changes. */
  readSeq: number
  blinkUntil: number
}

export const PRESENCE_IDLE: PresenceState = { reply: null, replyUntil: 0, flash: null, flashUntil: 0, readSeq: 0, blinkUntil: 0 }

export function presenceReduce(s: PresenceState, signal: BetsySignal, now: number): PresenceState {
  switch (signal) {
    case 'think':
    case 'typing':
      return { ...s, reply: signal, replyUntil: now + PRESENCE_TIMING.replyWatchdogMs }
    case 'done':
      return { ...s, reply: null, replyUntil: 0 }
    case 'listen':
      // A "yes" in progress is not cut short by a new customer message.
      if (s.flash === 'yes' && now < s.flashUntil) return s
      return { ...s, flash: 'listen', flashUntil: now + PRESENCE_TIMING.listenMs }
    case 'yes':
      return { ...s, flash: 'yes', flashUntil: now + PRESENCE_TIMING.yesMs }
    case 'read':
    case 'replied':
      return { ...s, readSeq: s.readSeq + 1, blinkUntil: now + PRESENCE_TIMING.readBlinkMs }
  }
}

/** What the mark shows at `now`. */
export function presenceView(s: PresenceState, now: number): { state: BetsyState; readSignal: number | undefined } {
  const replying = s.reply !== null && now < s.replyUntil
  const flashing = s.flash !== null && now < s.flashUntil
  const state: BetsyState = flashing ? (s.flash as BetsyState) : replying ? (s.reply as BetsyState) : 'idle'
  return { state, readSignal: now < s.blinkUntil ? s.readSeq : undefined }
}

/** The next moment the view changes on its own (to schedule one re-render), or null. */
export function nextDeadline(s: PresenceState, now: number): number | null {
  const times = [s.reply !== null ? s.replyUntil : 0, s.flash !== null ? s.flashUntil : 0, s.blinkUntil].filter((t) => t > now)
  return times.length ? Math.min(...times) : null
}
