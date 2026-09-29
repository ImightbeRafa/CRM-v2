/**
 * Snooze ("Posponer") for a chat (Phase 2b, migration 036 table ChatConversationWorkState).
 *
 * A chat is snoozed while `snoozedUntil` is in the future AND the customer has not written since it
 * was snoozed. It wakes up by itself: when the time passes (the inbox re-checks every second) or
 * when a new inbound message arrives (the conversation revision bumps, the list refreshes, and the
 * rule below no longer holds). No cron, no webhook change.
 *
 * Kept off ChatConversation on purpose: the hot table and every existing query stay untouched, and
 * before 036 is applied everything here is a no-op (memoized "table missing").
 */
export const SNOOZE_MAX_DAYS = 90

export type SnoozeDto = { until: string; at: string } | null

/** Pure: is the chat snoozed right now? */
export function isSnoozedNow(
  ws: { snoozedUntil: Date | null; snoozedAt: Date | null } | null | undefined,
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!ws?.snoozedUntil || !ws.snoozedAt) return false
  if (ws.snoozedUntil.getTime() <= now.getTime()) return false
  // The customer wrote after it was snoozed: wake up.
  if (lastInboundAt && lastInboundAt.getTime() > ws.snoozedAt.getTime()) return false
  return true
}

/** Pure: validates the requested "until" (future, at most 90 days out). */
export function parseSnoozeUntil(value: unknown, now: Date = new Date()): Date | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  if (d.getTime() <= now.getTime() + 30_000) return null
  if (d.getTime() > now.getTime() + SNOOZE_MAX_DAYS * 24 * 60 * 60 * 1000) return null
  return d
}

/** Menu presets in the viewer's local time: 1 h, 3 h, tomorrow 8:00, next Monday 8:00. */
export function snoozePresets(now: Date = new Date()): Array<{ key: string; label: string; until: Date }> {
  const at8 = (d: Date) => {
    const x = new Date(d)
    x.setHours(8, 0, 0, 0)
    return x
  }
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const monday = new Date(now)
  // Next Monday (a week later if today is Monday).
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7))
  return [
    { key: '1h', label: 'En 1 hora', until: new Date(now.getTime() + 60 * 60_000) },
    { key: '3h', label: 'En 3 horas', until: new Date(now.getTime() + 3 * 60 * 60_000) },
    { key: 'tomorrow', label: 'Mañana 8:00', until: at8(tomorrow) },
    { key: 'monday', label: 'Lunes 8:00', until: at8(monday) },
  ]
}

/** Client-side twin of `isSnoozedNow` for list DTOs (time can pass while the list is open). */
export function dtoIsSnoozed(snooze: SnoozeDto | undefined, nowMs: number = Date.now()): boolean {
  return Boolean(snooze && new Date(snooze.until).getTime() > nowMs)
}
