/**
 * Human display name for staff: never shows an email address.
 * "Ana <ana@x.com>" → "Ana", "ana@x.com" → "ana", falls back to the username (same rules).
 */
export function staffDisplayName(name?: string | null, username?: string | null): string | null {
  const clean = (value?: string | null) => {
    if (!value) return ''
    const raw = value.trim()
    // A bare email: keep the local part so the person is still recognisable.
    if (/^[^\s@<>]+@[^\s@<>]+$/.test(raw)) return raw.split('@')[0]
    return raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/\S+@\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return clean(name) || clean(username) || null
}
