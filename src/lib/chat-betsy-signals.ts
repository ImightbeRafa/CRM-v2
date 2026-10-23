/**
 * Which Betsy mark signals an inbox change means for the OPEN chat (Lane I's sidebar mark reacts; never sent to
 * customers). Pure: the inbox calls it from the /changes merge with the row it had and the row that arrived.
 *  - a new customer message → 'listen', and 'think' when the agent will answer it (IA handles the chat)
 *  - the agent's reply / a suggestion arrives after a customer message → 'done'
 * think auto-resets in the mark after 20 s, so a missed 'done' is harmless.
 */
import type { BetsySignal } from '@/components/brand/betsy-signals'

export type BetsySignalRow = {
  lastMessageAt: string
  lastMessageDirection: string | null
  pendingSuggestionText?: string | null
}

export function betsySignalsForChange(
  prev: BetsySignalRow | undefined,
  next: BetsySignalRow,
  aiHandles: boolean,
): BetsySignal[] {
  if (!prev) return []
  const newMessage = next.lastMessageAt !== prev.lastMessageAt
  if (newMessage && next.lastMessageDirection === 'inbound') return aiHandles ? ['listen', 'think'] : ['listen']
  const answered = prev.lastMessageDirection === 'inbound' && newMessage && next.lastMessageDirection === 'outbound'
  const suggested = !prev.pendingSuggestionText && Boolean(next.pendingSuggestionText)
  return answered || suggested ? ['done'] : []
}
