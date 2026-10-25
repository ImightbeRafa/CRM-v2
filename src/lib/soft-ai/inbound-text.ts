/**
 * What the customer really said in a stored inbound message (2026-10-25, WhatsApp edits / deletes).
 *
 * WhatsApp sends an edit as its own message (type 'edit', stored content "[edit]", the new text in
 * `metadata.rawMessage.edit.message`) and a delete as type 'revoke' (content "[revoke]"). The stored `content` of
 * those rows is never rewritten: everything that reads the customer's words for the agent or the order prefill reads
 * them through here. An edit counts as the customer's corrected text ("Calle 5, casa 20" → "Calle 7, casa 20"); a
 * delete says nothing. Decided by the TYPE (SecureDog): a typed "[edit]" is a real message. Pure.
 */

/** Longest edited text taken from a stored message (WhatsApp's own text limit is 4 096). */
const EDIT_TEXT_MAX = 4_096

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** A WhatsApp delete ("Se eliminó este mensaje"): stored messageType 'revoke'. */
export function isRevokeMessage(messageType: string | null | undefined): boolean {
  return messageType === 'revoke'
}

/** A WhatsApp edit: stored messageType 'edit'. */
export function isEditMessage(messageType: string | null | undefined): boolean {
  return messageType === 'edit'
}

/** The new text of an edit (its text body, or the new caption of an edited photo / video), '' when there is none. */
export function editedTextOf(metadata: unknown): string {
  const edited = asRecord(asRecord(asRecord(asRecord(metadata)?.rawMessage)?.edit)?.message)
  if (!edited) return ''
  const body = asRecord(edited.text)?.body
  const type = typeof edited.type === 'string' ? edited.type : ''
  const caption = type && type !== 'text' ? asRecord(edited[type])?.caption : undefined
  const text = typeof body === 'string' && body.trim() ? body : typeof caption === 'string' ? caption : ''
  return text.trim().slice(0, EDIT_TEXT_MAX)
}

/** The customer's words in this message: an edit's new text, nothing for a delete, else the stored content. */
export function customerTextOf(message: { content?: string | null; messageType?: string | null; metadata?: unknown }): string {
  if (isRevokeMessage(message.messageType)) return ''
  if (isEditMessage(message.messageType)) return editedTextOf(message.metadata)
  return message.content ?? ''
}

/** An edit is read as a text message (burst planning, the safety router); every other type stays as stored. */
export function customerMessageTypeOf(messageType: string | null | undefined): string | null {
  return isEditMessage(messageType) ? 'text' : (messageType ?? null)
}
