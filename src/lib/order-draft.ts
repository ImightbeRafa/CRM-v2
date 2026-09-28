/**
 * Unfinished "Crear pedido" drafts in localStorage. One slot for /ventas and one per chat
 * (`chat:<conversationId>`), so a half-filled order survives closing the drawer or switching chats.
 */

const AUTOSAVE_KEY = 'betsy_autosave'
/** Drafts older than this are ignored (and cleaned up) when the form opens. */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export function orderDraftStorageKey(draftKey?: string | null): string {
  return draftKey ? `${AUTOSAVE_KEY}:${draftKey}` : AUTOSAVE_KEY
}

/** True when an unfinished order is saved for this slot (drives the "Borrador" badge). */
export function hasOrderDraft(draftKey: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(orderDraftStorageKey(draftKey))
    if (!raw) return false
    const parsed = JSON.parse(raw) as { timestamp?: string; products?: unknown[]; customerInfo?: Record<string, unknown> }
    const age = Date.now() - new Date(parsed.timestamp || 0).getTime()
    if (!(age >= 0 && age < DRAFT_MAX_AGE_MS)) return false
    return Boolean(parsed.products?.length) || Boolean(parsed.customerInfo?.address || parsed.customerInfo?.province)
  } catch {
    return false
  }
}
