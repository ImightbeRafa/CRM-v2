/**
 * Team quick replies ("respuestas rápidas") for the chat composer. Stored per business in
 * `Tenant.settings.chatQuickReplies`. Pure helpers: safe for client and server.
 *
 * Composer UX (WhatsApp Business / Instagram style): type `/` + shortcut to filter, ↑↓ to move,
 * Enter or Tab to insert. `{nombre}` is replaced with the customer's first name.
 */

/** A photo / PDF saved with a quick reply (private Blob, `chat-quick-replies/<tenantId>/…`). */
export type QuickReplyMedia = {
  path: string
  mime: string
  filename: string
  size: number
}

export type ChatQuickReply = {
  id: string
  /** Lower-case, no spaces, e.g. `precio`, `sinpe`, `envio-gam`. */
  shortcut: string
  /** May be empty when the reply is only images. */
  text: string
  /** Sent before the text (the text rides as the first file's caption when it fits). */
  media?: QuickReplyMedia[]
}

export const QUICK_REPLY_MEDIA_PREFIX = 'chat-quick-replies'
export const QUICK_REPLY_MAX_MEDIA = 3
/** WhatsApp caption limit: longer texts go as their own message after the files. */
export const WA_CAPTION_MAX = 1024

export function quickReplyMediaPrefix(tenantId: string): string {
  return `${QUICK_REPLY_MEDIA_PREFIX}/${tenantId}/`
}

/** Exactly the shape the upload route generates: <prefix>/<tenant>/<random>.<jpg|png|pdf|mp4>. */
const QUICK_REPLY_PATH_RE = /^chat-quick-replies\/[A-Za-z0-9_-]{1,64}\/[a-z0-9]{8,40}\.(jpg|png|pdf|mp4)$/

/** Shape-only check (reading stored settings). Never use it to authorize access. */
export function isQuickReplyMediaPathShape(path: unknown): path is string {
  return typeof path === 'string' && QUICK_REPLY_PATH_RE.test(path)
}

/** Only files this business uploaded for quick replies. Fails closed without a tenant. */
export function isQuickReplyMediaPath(path: unknown, tenantId: string): path is string {
  if (!tenantId || !isQuickReplyMediaPathShape(path)) return false
  return path.startsWith(quickReplyMediaPrefix(tenantId))
}

/** Every file path referenced by a quick-reply list. */
export function quickReplyMediaPaths(items: ChatQuickReply[]): Set<string> {
  const out = new Set<string>()
  for (const item of items) for (const m of item.media ?? []) out.add(m.path)
  return out
}

function sanitizeMedia(raw: unknown, tenantId?: string): QuickReplyMedia[] {
  if (!Array.isArray(raw)) return []
  const out: QuickReplyMedia[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const r = m as Record<string, unknown>
    const path = r.path
    if (typeof path !== 'string') continue
    if (tenantId ? !isQuickReplyMediaPath(path, tenantId) : !isQuickReplyMediaPathShape(path)) continue
    const mime = String(r.mime || '').toLowerCase()
    if (!/^(image\/(jpeg|png)|application\/pdf|video\/mp4)$/.test(mime)) continue
    out.push({
      path,
      mime,
      filename: String(r.filename || 'archivo').replace(/[\u0000-\u001f\u007f"\\/]/g, '').slice(0, 120) || 'archivo',
      size: Math.max(0, Math.min(Number(r.size) || 0, 50 * 1024 * 1024)),
    })
    if (out.length >= QUICK_REPLY_MAX_MEDIA) break
  }
  return out
}

export const QUICK_REPLIES_SETTINGS_KEY = 'chatQuickReplies'
/** Optimistic-concurrency counter next to the list (a stale tab gets 409 instead of overwriting). */
export const QUICK_REPLIES_VERSION_KEY = 'chatQuickRepliesVersion'
export const QUICK_REPLY_MAX_COUNT = 100
export const QUICK_REPLY_MAX_TEXT = 1000
export const QUICK_REPLY_MAX_SHORTCUT = 32

export function normalizeShortcut(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, QUICK_REPLY_MAX_SHORTCUT)
}

function newId(): string {
  return `qr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Validates and cleans a list coming from the browser or from stored settings. Drops empty or
 * duplicate shortcuts (first wins) and caps sizes. Returns `error` only for input the user must fix.
 */
export function sanitizeQuickReplies(input: unknown, opts: { tenantId?: string } = {}): { items: ChatQuickReply[]; error?: string } {
  if (!Array.isArray(input)) return { items: [] }
  if (input.length > QUICK_REPLY_MAX_COUNT) {
    return { items: [], error: `Máximo ${QUICK_REPLY_MAX_COUNT} respuestas rápidas.` }
  }
  const seen = new Set<string>()
  const items: ChatQuickReply[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const shortcut = normalizeShortcut(r.shortcut)
    // No control characters (NUL breaks jsonb) except new lines / tabs.
    const text = String(r.text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[\ud800-\udfff]/g, (c, i: number, all: string) => {
        const code = all.charCodeAt(i)
        const pair = code < 0xdc00 ? all.charCodeAt(i + 1) : all.charCodeAt(i - 1)
        const ok = code < 0xdc00 ? pair >= 0xdc00 && pair <= 0xdfff : pair >= 0xd800 && pair < 0xdc00
        return ok ? c : ''
      })
      .trim()
    const media = sanitizeMedia(r.media, opts.tenantId)
    if (!shortcut || (!text && media.length === 0)) continue
    if (text.length > QUICK_REPLY_MAX_TEXT) {
      return { items: [], error: `La respuesta /${shortcut} supera ${QUICK_REPLY_MAX_TEXT} caracteres.` }
    }
    if (seen.has(shortcut)) {
      return { items: [], error: `El atajo /${shortcut} está repetido.` }
    }
    seen.add(shortcut)
    const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : newId()
    items.push(media.length ? { id, shortcut, text, media } : { id, shortcut, text })
  }
  return { items }
}

export function quickRepliesVersionFromSettings(settings: unknown): number {
  const bag = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const v = Number(bag[QUICK_REPLIES_VERSION_KEY])
  return Number.isInteger(v) && v >= 0 ? v : 0
}

export function quickRepliesFromSettings(settings: unknown): ChatQuickReply[] {
  const bag = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return sanitizeQuickReplies(bag[QUICK_REPLIES_SETTINGS_KEY]).items
}

/**
 * The `/query` the caret is in, when the composer text is a slash command at the start of a
 * line (so URLs and "1/2" never open the menu). Returns null otherwise.
 */
export function slashQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, Math.max(0, caret))
  const match = /(^|\n)\/([^\s/]{0,32})$/.exec(before)
  if (!match) return null
  return { query: match[2], start: before.length - match[2].length - 1 }
}

export function filterQuickReplies(items: ChatQuickReply[], query: string, limit = 8): ChatQuickReply[] {
  const q = normalizeShortcut(query)
  if (!q) return items.slice(0, limit)
  const starts = items.filter((i) => i.shortcut.startsWith(q))
  const contains = items.filter(
    (i) => !i.shortcut.startsWith(q) && (i.shortcut.includes(q) || i.text.toLowerCase().includes(query.toLowerCase())),
  )
  return [...starts, ...contains].slice(0, limit)
}

/** `{nombre}` → customer's first name (or removed cleanly when unknown). */
export function fillQuickReply(text: string, customerName?: string | null): string {
  const first = String(customerName || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}'-]/gu, '')
  if (first) return text.replace(/\{nombre\}/gi, first)
  return text.replace(/\s*\{nombre\}/gi, '').replace(/^\s*,\s*/, '')
}

/** Replace the `/query` at `start` with the reply text. */
export function applyQuickReply(
  text: string,
  slash: { query: string; start: number },
  reply: ChatQuickReply,
  customerName?: string | null,
): { text: string; caret: number; media: QuickReplyMedia[] } {
  const body = fillQuickReply(reply.text, customerName)
  const end = slash.start + 1 + slash.query.length
  const next = text.slice(0, slash.start) + body + text.slice(end)
  return { text: next, caret: slash.start + body.length, media: reply.media ?? [] }
}
