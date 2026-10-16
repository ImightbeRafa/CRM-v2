/**
 * agents2-hours · SecureDog INT-120 / Verifier F5: the owner's after-hours note goes to the customer AS-IS (code text,
 * no token filling, no model check). Same checks on save (settings route) and again at send (agent-turn): any
 * marker, any digit (any script), confirmation / deal / amount-in-words wording, or any reply-validator reason
 * (payment-status claims, write claims, links, tokens…) refuses it. Pure.
 */
import { afterHoursNoteHasMarker } from '@/lib/soft-ai/business-hours'
import { dealProblem, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import { headlineHasNumberWords } from '@/lib/soft-ai/promo'

/** NFKC + spaces collapsed (full-width / compatibility forms cannot dodge the checks). */
export function normalizeAfterHoursNote(note: string): string {
  return note.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** true = the note must not be saved / sent. */
export function afterHoursNoteRejected(note: string | null | undefined): boolean {
  const text = normalizeAfterHoursNote(String(note || ''))
  if (!text) return false
  if (afterHoursNoteHasMarker(text) || /\p{Nd}/u.test(text)) return true
  if (hasConfirmationWording(text) || dealProblem(text, []) || headlineHasNumberWords(text)) return true
  const v = validateAgentOutput({
    text,
    citedToolNames: [],
    customerText: 'ya pagué',
    paymentContext: true,
    orderClosing: true,
    linkAllowlist: { hosts: [], prefixes: [] },
  })
  return v.reasons.length > 0
}
