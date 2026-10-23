/**
 * Betsy presence signals: a tiny window-event bus so any screen (inbox, composer, payments) can make
 * the one visible Betsy mark react without importing it. Fire-and-forget; safe on the server (no-op).
 *
 *   emitBetsySignal('read')      a chat was marked read            → double blink ("leído")
 *   emitBetsySignal('replied')   a chat was marked Respondido      → double blink
 *   emitBetsySignal('think')     an AI reply / suggestion started  → think (light orbits)
 *   emitBetsySignal('typing')    the AI draft is streaming         → typing (three dots)
 *   emitBetsySignal('done')      the AI reply finished or failed   → idle
 *   emitBetsySignal('listen')    a customer message landed         → listen (~1.2 s)
 *   emitBetsySignal('yes')       "Pago verificado" / order ready   → hop + double blink
 *
 * Never sent to customers; it only animates the owner UI.
 */
export const BETSY_SIGNAL_EVENT = 'betsy:signal'

export const BETSY_SIGNALS = ['read', 'replied', 'think', 'typing', 'done', 'listen', 'yes'] as const
export type BetsySignal = (typeof BETSY_SIGNALS)[number]

export function isBetsySignal(value: unknown): value is BetsySignal {
  return typeof value === 'string' && (BETSY_SIGNALS as readonly string[]).includes(value)
}

export function emitBetsySignal(type: BetsySignal): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(BETSY_SIGNAL_EVENT, { detail: { type } }))
}

/** `useBetsyState` event for each signal (HANDOFF.md state table). */
export type BetsyStateEvent = 'read' | 'reply_started' | 'reply_streaming' | 'reply_done' | 'message_received' | 'payment_verified'

export function signalToStateEvent(type: BetsySignal): BetsyStateEvent {
  switch (type) {
    case 'read':
    case 'replied':
      return 'read'
    case 'think':
      return 'reply_started'
    case 'typing':
      return 'reply_streaming'
    case 'done':
      return 'reply_done'
    case 'listen':
      return 'message_received'
    case 'yes':
      return 'payment_verified'
  }
}
