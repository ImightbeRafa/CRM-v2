/** Only http(s) URLs may be used as an avatar `src` (no data:, javascript:, blob:, relative paths). */
export function safeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null
  } catch {
    return null
  }
}

/** Up to two uppercase initials; `·` when the name is empty. */
export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}
