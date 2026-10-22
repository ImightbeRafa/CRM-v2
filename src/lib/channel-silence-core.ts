/**
 * Dead-line alarm — pure helpers (no DB, no network). See `channel-silence.ts`.
 */

/**
 * Marker in SocialAccount.lastErrorCode: the line normally gets traffic and has been quiet far longer
 * than usual, while its token AND its webhook subscription check out. A quiet note only — never an
 * email, a bell or a red banner (Rafael 2026-10-22: "Sin mensajes recientes" emails for a fine line).
 */
export const SILENT_LINE_CODE = 'silent_line'
/** Marker in SocialAccount.lastErrorCode: Meta no longer sends this line's messages to Betsy (real evidence). */
export const WEBHOOK_GONE_CODE = 'webhook_unsubscribed'

/** The fix for the usual cause (Facebook Login page picker dropped the page). */
export const LINE_DOWN_FIX_TEXT = 'Reconectá y marcá TODAS tus páginas'

/** Lines with fewer inbound messages in the last 7 days are never flagged as silent. */
export const MIN_WEEKLY_INBOUND = 30
/**
 * Shortest / longest silence (business minutes) before a busy line is flagged.
 * The floor is 4 business hours: a bursty line's 4× gap can be ~2 h, and that
 * was flagging healthy lines (Patch House) while webhooks were still 200.
 */
export const SILENCE_FLOOR_MINUTES = 240
export const SILENCE_CAP_MINUTES = 360
/** Silence of this many "usual gaps" (~2% chance on a healthy line). */
const GAP_MULTIPLIER = 4
/**
 * The quiet note needs much more: this many times the suspect threshold, and at least a full
 * business day. Below that a silent line with a good token and subscription is just a calm day.
 */
const QUIET_NOTE_MULTIPLIER = 3
export const QUIET_NOTE_FLOOR_MINUTES = 14 * 60

/** Costa Rica (UTC-6, no DST) business window, local hours [start, end). */
const TZ_OFFSET_MS = -6 * 60 * 60_000
const BUSINESS_START_HOUR = 7
const BUSINESS_END_HOUR = 21
const BUSINESS_MINUTES_PER_WEEK = 7 * (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 60
const DAY_MS = 24 * 60 * 60_000

export function inBusinessHours(at: Date): boolean {
  const hour = new Date(at.getTime() + TZ_OFFSET_MS).getUTCHours()
  return hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR
}

/** Minutes of the business window between two instants (night hours do not count). */
export function businessMinutesBetween(from: Date, to: Date): number {
  const a = from.getTime() + TZ_OFFSET_MS
  const b = to.getTime() + TZ_OFFSET_MS
  if (!(b > a)) return 0
  let total = 0
  // Older than 30 days: plenty for every threshold.
  const startDay = Math.max(Math.floor(a / DAY_MS), Math.floor(b / DAY_MS) - 30)
  for (let day = startDay; day <= Math.floor(b / DAY_MS); day += 1) {
    const open = day * DAY_MS + BUSINESS_START_HOUR * 60 * 60_000
    const close = day * DAY_MS + BUSINESS_END_HOUR * 60 * 60_000
    const overlap = Math.min(close, b) - Math.max(open, a)
    if (overlap > 0) total += overlap
  }
  return Math.floor(total / 60_000)
}

/**
 * Business minutes of silence before a line with `inbound7d` messages last week is flagged,
 * or null when the line is too quiet to judge.
 */
export function silenceThresholdMinutes(inbound7d: number): number | null {
  if (!Number.isFinite(inbound7d) || inbound7d < MIN_WEEKLY_INBOUND) return null
  const usualGap = BUSINESS_MINUTES_PER_WEEK / inbound7d
  return Math.min(SILENCE_CAP_MINUTES, Math.max(SILENCE_FLOOR_MINUTES, Math.round(GAP_MULTIPLIER * usualGap)))
}

/** True when this much business-hour silence should flag the line. Quiet lines (under 30 msgs) never alert. */
export function silenceShouldAlert(inbound7d: number, quietBusinessMinutes: number): boolean {
  if (!Number.isFinite(quietBusinessMinutes) || quietBusinessMinutes < SILENCE_FLOOR_MINUTES) return false
  const threshold = silenceThresholdMinutes(inbound7d)
  return threshold != null && quietBusinessMinutes >= threshold
}

/**
 * Silence far beyond this line's own pattern (after the token and the webhook subscription checked
 * out): the only silence that shows anything, and then only a quiet note.
 */
export function silenceIsFarBeyondPattern(inbound7d: number, quietBusinessMinutes: number): boolean {
  const threshold = silenceThresholdMinutes(inbound7d)
  if (threshold == null || !Number.isFinite(quietBusinessMinutes)) return false
  return quietBusinessMinutes >= Math.max(QUIET_NOTE_FLOOR_MINUTES, threshold * QUIET_NOTE_MULTIPLIER)
}

export type LineDownReason = 'token' | 'webhook' | 'silent'

/** Why a connected line is down / quiet right now (null = fine). Only 'token' and 'webhook' alert. */
export function lineDownReason(row: { tokenStatus?: string | null; lastErrorCode?: string | null }): LineDownReason | null {
  const status = (row.tokenStatus || '').toLowerCase()
  if (status === 'revoked' || status === 'expired' || status === 'error') return 'token'
  if (row.lastErrorCode === WEBHOOK_GONE_CODE) return 'webhook'
  if (row.lastErrorCode === SILENT_LINE_CODE) return 'silent'
  return null
}

/** Email + bell only on real evidence (token dead, webhook subscription gone). Silence alone never. */
export function lineDownAlerts(reason: LineDownReason | null): boolean {
  return reason === 'token' || reason === 'webhook'
}

/**
 * GET /{target}/subscribed_apps answer → is this app still subscribed? 'unknown' when the answer
 * proves nothing (error, odd shape): never an alert on 'unknown'.
 */
export function webhookSubscriptionState(
  data: unknown,
  opts: { appId?: string | null; platform: string },
): 'subscribed' | 'missing' | 'unknown' {
  const list = (data as { data?: unknown } | null)?.data
  if (!Array.isArray(list)) return 'unknown'
  if (list.length === 0) return 'missing'
  const appId = opts.appId?.trim()
  const entries = list.map((raw) => {
    const e = (raw ?? {}) as { id?: unknown; whatsapp_business_api_data?: { id?: unknown }; subscribed_fields?: unknown }
    return {
      id: String(e.whatsapp_business_api_data?.id ?? e.id ?? ''),
      fields: Array.isArray(e.subscribed_fields) ? e.subscribed_fields.map(String) : null,
    }
  })
  const ours = appId ? entries.filter((e) => e.id === appId) : entries
  // Other apps only: could be a stale app id in env — proves nothing, so never an alert.
  if (ours.length === 0) return 'unknown'
  // Instagram: the Page must still send 'messages' to the app.
  if (opts.platform === 'instagram' && ours.every((e) => e.fields && !e.fields.includes('messages'))) return 'missing'
  return 'subscribed'
}

/** "@patchhouse.cr" / "Forge" / phone / id — the owner's own line name, never customer data. */
export function lineDownLabel(row: {
  platform: string
  accountId: string
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
}): string {
  if (row.platform === 'instagram' && row.providerUsername) return `@${row.providerUsername.replace(/^@/, '')}`
  return row.displayName || row.providerDisplayName || row.displayPhoneNumber || row.accountId
}

/** Result-page sentence after a connect dropped other Instagram lines. */
export function lostSiblingsSentence(connected: string, lost: string[]): string | null {
  if (lost.length === 0) return null
  const names = lost.length === 1 ? lost[0] : `${lost.slice(0, -1).join(', ')} y ${lost[lost.length - 1]}`
  return `Al conectar ${connected} se ${lost.length === 1 ? 'desconectó' : 'desconectaron'} ${names}: volvé a conectar marcando todas las páginas.`
}

export type LineDownKey = { socialAccountId: string; reason: LineDownReason; since: Date }

/** Bell dedupe key `line_down:<socialAccountId>:<reason>:<epochMinute>` → parts (null otherwise). */
export function parseLineDownKey(dedupeKey: string | null | undefined): LineDownKey | null {
  const parts = String(dedupeKey || '').split(':')
  if (parts[0] !== 'line_down' || parts.length !== 4) return null
  const minute = Number(parts[3])
  const reason = parts[2]
  if (!parts[1] || (reason !== 'token' && reason !== 'silent' && reason !== 'webhook') || !Number.isFinite(minute)) return null
  return { socialAccountId: parts[1], reason, since: new Date(minute * 60_000) }
}

/** "18/10 09:03" in Costa Rica time. */
export function formatSinceCr(at: Date): string {
  const d = new Date(at.getTime() + TZ_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export const WEBHOOK_GONE_FIX_TEXT = 'Tocá Reparar en Configuración › Canales'

/** The fix in plain words: the page-picker advice is Facebook / Instagram only. */
export function lineDownFixText(platform: string): string {
  return platform === 'instagram' ? LINE_DOWN_FIX_TEXT : 'Reconectá la línea en Configuración › Canales'
}

/** Latest of several optional instants (epoch 0 when all are missing). */
export function latestOf(...dates: Array<Date | null | undefined>): Date {
  return new Date(Math.max(0, ...dates.map((d) => (d ? d.getTime() : 0))))
}

export function lineDownNotificationText(
  label: string,
  key: Pick<LineDownKey, 'reason' | 'since'>,
  platform = 'instagram',
): { title: string; snippet: string } {
  const since = formatSinceCr(key.since)
  const fix = lineDownFixText(platform)
  if (key.reason === 'webhook') {
    return {
      title: `Dejó de recibir mensajes · ${label}`,
      snippet: `Meta dejó de mandar a Betsy los mensajes de esta línea (${since}). ${WEBHOOK_GONE_FIX_TEXT}.`,
    }
  }
  return {
    title: key.reason === 'silent' ? `Sin mensajes recientes · ${label}` : `Perdió el acceso · ${label}`,
    snippet:
      key.reason === 'silent'
        ? `No llegan mensajes desde ${since}. Puede ser un período tranquilo, no necesariamente una desconexión.`
        : `Perdió el acceso a Meta (${since}). ${fix}.`,
  }
}

const TOKEN_DOWN = new Set(['revoked', 'expired', 'error'])

/**
 * lastErrorCode / lastErrorAt for the daily token probe. An incident that is already open keeps its
 * start time (so it is not announced again every night), and a silence marker survives a probe that
 * says nothing new about it. Keys left out = unchanged.
 */
export function tokenCheckErrorFields(
  account: { tokenStatus?: string | null; lastErrorCode?: string | null },
  probe: { tokenStatus: string; lastErrorCode: string | null; transient?: boolean },
  now: Date,
): { lastErrorCode?: string | null; lastErrorAt?: Date | null } {
  const wasDown = TOKEN_DOWN.has((account.tokenStatus || '').toLowerCase())
  const nowDown = !probe.transient && TOKEN_DOWN.has(probe.tokenStatus)
  // The silence / webhook markers are owned by the silence cron (cleared when a webhook arrives).
  const silent = account.lastErrorCode === SILENT_LINE_CODE || account.lastErrorCode === WEBHOOK_GONE_CODE
  if (probe.lastErrorCode) {
    if (silent && !nowDown) return {}
    return wasDown ? { lastErrorCode: probe.lastErrorCode } : { lastErrorCode: probe.lastErrorCode, lastErrorAt: now }
  }
  return silent ? {} : { lastErrorCode: null, lastErrorAt: null }
}

/** A busy line also needs this many distinct chats last week. */
export const MIN_WEEKLY_CHATS = 5

/** Tenant-chosen text for the operator email: URLs out, plain characters only, capped. */
export function emailSafeText(value: string | null | undefined, max: number): string {
  const clean = (value ?? '').replace(/https?:\/\/\S+|www\.\S+/gi, '[url]').replace(/[^\p{L}\p{N} @._()[\]-]/gu, ' ').replace(/\s+/g, ' ').trim()
  return clean.slice(0, max) || '-'
}
