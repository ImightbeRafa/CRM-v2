/**
 * Customer label + photo for chats (pure: used by the server DTO, the inbox UI and instagram-peer-profile.ts).
 * Instagram: "Ana Pérez (@ana.p)" instead of "Instagram User 076336" (Rafael 2026-10-18).
 */
const PLACEHOLDER_NAME = /^Instagram User \d{0,12}$/
const USERNAME = /^[A-Za-z0-9._]{1,30}$/

/** "Instagram User 076336" (webhook fallback) or nothing at all: safe to replace with the real name. */
export function isPlaceholderPeerName(name: string | null | undefined): boolean {
  const v = String(name ?? '').trim()
  return !v || PLACEHOLDER_NAME.test(v)
}

export function cleanProfileUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().replace(/^@/, '')
  return USERNAME.test(v) ? v : null
}

/** Private chat-storage path of the customer's photo (never a URL). */
export function peerAvatarStoragePath(tenantId: string, conversationId: string): string {
  return `chat-media/${tenantId}/avatars/${conversationId}`
}

/** Only our own private avatar path for THIS tenant + conversation counts. */
export function hasStoredPeerAvatar(row: { tenantId: string; id: string; peerAvatarUrl?: string | null }): boolean {
  return Boolean(row.tenantId && row.id) && row.peerAvatarUrl === peerAvatarStoragePath(row.tenantId, row.id)
}

/** Same-origin route the browser loads the photo from; `v` busts the cache after a refresh. */
export function peerAvatarRoute(conversationId: string, version?: Date | string | null): string {
  const ms = version ? new Date(version).getTime() : NaN
  const v = Number.isFinite(ms) ? `?v=${ms}` : ''
  return `/api/chat/conversations/${encodeURIComponent(conversationId)}/avatar${v}`
}

/** "Ana Pérez (@ana.p)", "@ana.p", "Ana Pérez" or null. */
export function formatPeerDisplayName(name: string | null | undefined, username: string | null | undefined): string | null {
  const n = isPlaceholderPeerName(name) ? null : String(name).trim()
  const u = cleanProfileUsername(username)
  if (n && u) return n.toLowerCase() === u.toLowerCase() || n === `@${u}` ? `@${u}` : `${n} (@${u})`
  if (u) return `@${u}`
  return n
}

/** Inbox / thread header label: "Name (@username)", else the stored name, else the peer id. */
export function conversationDisplayName(conv: {
  recipientName?: string | null
  recipientUsername?: string | null
  recipientId: string
}): string {
  return formatPeerDisplayName(conv.recipientName, conv.recipientUsername) || conv.recipientName || conv.recipientId
}
