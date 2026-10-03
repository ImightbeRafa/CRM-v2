/**
 * Phone-based ownership: the order's phone and one of the chat's phone hints must share their last 8 digits.
 * Numbers shorter than 8 digits never match (a placeholder "0" must not belong to everyone).
 */
export function phoneOwnershipMatch(hints: readonly string[], orderPhone: string): boolean {
  const phone = orderPhone.replace(/\D/g, '')
  if (phone.length < 8) return false
  return hints
    .map((h) => h.replace(/\D/g, ''))
    .filter((h) => h.length >= 8)
    .some((h) => h === phone || h.endsWith(phone.slice(-8)) || phone.endsWith(h.slice(-8)))
}
