/**
 * Team quick replies ("respuestas rápidas") for the chat composer. Stored per business in
 * `Tenant.settings.chatQuickReplies`. Pure helpers: safe for client and server.
 *
 * Composer UX (WhatsApp Business / Instagram style): type `/` + shortcut to filter, ↑↓ to move,
 * Enter or Tab to insert. `{nombre}` is replaced with the customer's first name.
 */

export type ChatQuickReply = {
  id: string
  /** Lower-case, no spaces, e.g. `precio`, `sinpe`, `envio-gam`. */
  shortcut: string
  text: string
}

export const QUICK_REPLIES_SETTINGS_KEY = 'chatQuickReplies'
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
export function sanitizeQuickReplies(input: unknown): { items: ChatQuickReply[]; error?: string } {
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
    const text = String(r.text ?? '').replace(/\r\n/g, '\n').trim()
    if (!shortcut || !text) continue
    if (text.length > QUICK_REPLY_MAX_TEXT) {
      return { items: [], error: `La respuesta /${shortcut} supera ${QUICK_REPLY_MAX_TEXT} caracteres.` }
    }
    if (seen.has(shortcut)) {
      return { items: [], error: `El atajo /${shortcut} está repetido.` }
    }
    seen.add(shortcut)
    const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : newId()
    items.push({ id, shortcut, text })
  }
  return { items }
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
): { text: string; caret: number } {
  const body = fillQuickReply(reply.text, customerName)
  const end = slash.start + 1 + slash.query.length
  const next = text.slice(0, slash.start) + body + text.slice(end)
  return { text: next, caret: slash.start + body.length }
}
