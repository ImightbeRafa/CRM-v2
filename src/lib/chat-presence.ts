/**
 * Chat presence (Phase 2b, 2026-09-29): "Ana está respondiendo" / "Ana también está viendo".
 *
 * In-memory, per tenant + conversation, 20 s TTL. Correct in production because the Worker routes
 * every request to one primary container (src/cf-container-worker.ts); after a failover presence
 * simply resets for ~20 s. Nothing is persisted. Keys always include the session tenant, so one
 * business can never see another's presence.
 */
export type PresenceState = 'viewing' | 'typing'
export type PresenceEntry = { userId: string; name: string; state: PresenceState; at: number }

export const PRESENCE_TTL_MS = 20_000
/** Typing decays faster than viewing: a pause of 6 s means "just viewing" again. */
export const TYPING_TTL_MS = 6_000
const MAX_KEYS = 5_000

export function parsePresenceState(value: unknown): PresenceState | null {
  return value === 'viewing' || value === 'typing' ? value : null
}

export class PresenceStore {
  private rooms = new Map<string, Map<string, PresenceEntry>>()

  private key(tenantId: string, conversationId: string) {
    return `${tenantId}:${conversationId}`
  }

  touch(tenantId: string, conversationId: string, entry: Omit<PresenceEntry, 'at'>, now = Date.now()): void {
    const k = this.key(tenantId, conversationId)
    let room = this.rooms.get(k)
    if (!room) {
      if (this.rooms.size >= MAX_KEYS) this.prune(now)
      if (this.rooms.size >= MAX_KEYS) {
        // Still full: drop the oldest room (Map keeps insertion order).
        const oldest = this.rooms.keys().next().value
        if (oldest !== undefined) this.rooms.delete(oldest)
      }
      room = new Map()
      this.rooms.set(k, room)
    }
    room.set(entry.userId, { ...entry, at: now })
  }

  leave(tenantId: string, conversationId: string, userId: string): void {
    this.rooms.get(this.key(tenantId, conversationId))?.delete(userId)
  }

  /** Other people in the chat right now; typing first, then most recent. */
  list(tenantId: string, conversationId: string, exceptUserId: string, now = Date.now()): Array<{ userId: string; name: string; state: PresenceState }> {
    const room = this.rooms.get(this.key(tenantId, conversationId))
    if (!room) return []
    const out: PresenceEntry[] = []
    for (const [userId, e] of room) {
      if (now - e.at > PRESENCE_TTL_MS) {
        room.delete(userId)
        continue
      }
      if (userId === exceptUserId) continue
      const state: PresenceState = e.state === 'typing' && now - e.at > TYPING_TTL_MS ? 'viewing' : e.state
      out.push({ ...e, state })
    }
    if (room.size === 0) this.rooms.delete(this.key(tenantId, conversationId))
    return out
      .sort((a, b) => (a.state === b.state ? b.at - a.at : a.state === 'typing' ? -1 : 1))
      .slice(0, 10)
      .map(({ userId, name, state }) => ({ userId, name, state }))
  }

  prune(now = Date.now()): void {
    for (const [k, room] of this.rooms) {
      for (const [u, e] of room) if (now - e.at > PRESENCE_TTL_MS) room.delete(u)
      if (room.size === 0) this.rooms.delete(k)
    }
  }

  size(): number {
    return this.rooms.size
  }
}

/** One store per server process (survives hot reload in dev). */
const g = globalThis as unknown as { __betsyPresence?: PresenceStore }
export const presenceStore: PresenceStore = g.__betsyPresence ?? (g.__betsyPresence = new PresenceStore())

/** "Ana está respondiendo…" / "Ana y Luis están viendo este chat". Empty when nobody else. */
export function presenceLabel(people: Array<{ name: string; state: PresenceState }>): string {
  if (!people.length) return ''
  const typing = people.filter((p) => p.state === 'typing')
  const names = (list: typeof people) =>
    list.length === 1 ? list[0].name : list.length === 2 ? `${list[0].name} y ${list[1].name}` : `${list[0].name} y ${list.length - 1} más`
  if (typing.length) return `${names(typing)} ${typing.length === 1 ? 'está' : 'están'} respondiendo…`
  return `${names(people)} ${people.length === 1 ? 'también está viendo' : 'también están viendo'} este chat`
}
