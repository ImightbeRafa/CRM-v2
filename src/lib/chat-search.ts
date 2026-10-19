/**
 * /chats search. Pure and client-safe (no Prisma): order number, phone, name,
 * @handle, email. The server turns the plan into a tenant-scoped query.
 */

export type ChatSearchPlan = {
  raw: string
  /** Text used for names and previews (accent-folded by the client matcher). */
  customerText: string | null
  /** Order number fragment. Null when the query is a phone or an email. */
  orderText: string | null
  /** Digits to look for on a phone (Costa Rica 8-digit tail when the query is +506…). */
  phoneDigits: string | null
  /** Full digit run, when it differs from the tail (506XXXXXXXX). */
  phoneFull: string | null
  email: string | null
  /** @handle without the @. */
  handle: string | null
  phoneMostly: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function foldSearchText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** "+506 8888-7777" / "88887777" → the 8-digit Costa Rica tail when it is one. */
export function searchPhoneDigits(raw: string): { tail: string | null; full: string | null } {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return { tail: null, full: null }
  if (digits.length === 11 && digits.startsWith('506')) return { tail: digits.slice(3), full: digits }
  if (digits.length === 12 && digits.startsWith('506')) return { tail: digits.slice(3, 11), full: digits }
  if (digits.startsWith('506') && digits.length > 8) return { tail: digits.slice(3), full: digits }
  return { tail: digits, full: digits }
}

export function planChatSearch(raw: string | null | undefined): ChatSearchPlan | null {
  const text = String(raw ?? '').trim().slice(0, 80)
  if (text.length < 2) return null
  const email = EMAIL_RE.test(text) ? text.toLowerCase() : null
  const handle = text.startsWith('@') ? text.slice(1).trim() : null
  const digits = text.replace(/\D/g, '')
  const crPhone = digits.length === 8 || ((digits.length === 11 || digits.length === 12) && digits.startsWith('506'))
  const punctuationPhone = /[+\-().]/.test(text) && digits.length >= 8 && digits.length <= 12
  const phoneMostly = !email && (crPhone || punctuationPhone) && text.replace(/[\d\s+\-().]/g, '').length <= 1
  const phone = phoneMostly ? searchPhoneDigits(text) : { tail: null, full: null }
  const stripped = text.replace(/^#+/, '').trim()
  const orderText = !email && !phoneMostly && stripped.length >= 2 ? stripped.slice(0, 60) : null
  const customerText = email || phoneMostly ? null : stripped
  return {
    raw: text,
    customerText,
    orderText,
    phoneDigits: phone.tail,
    phoneFull: phone.full && phone.full !== phone.tail ? phone.full : null,
    email,
    handle,
    phoneMostly,
  }
}

export type ChatSearchFields = {
  name?: string | null
  username?: string | null
  preview?: string | null
  peerId?: string | null
  accountLabel?: string | null
  orderNumber?: string | null
  email?: string | null
  phone?: string | null
}

/** Local inbox filter. A server hit should be passed in separately so email-only rows are not dropped. */
export function matchesChatSearch(query: string, fields: ChatSearchFields): boolean {
  const q = query.trim()
  if (q.length < 2) {
    if (!q) return true
    const needle = foldSearchText(q)
    const hay = foldSearchText(
      [fields.name, fields.username, fields.preview, fields.peerId, fields.accountLabel, fields.orderNumber].join(' '),
    )
    return hay.includes(needle)
  }
  const plan = planChatSearch(q)
  if (!plan) return true
  if (plan.email && foldSearchText(fields.email) === plan.email) return true
  if (plan.handle) {
    const user = foldSearchText(fields.username).replace(/^@/, '')
    if (user && user.includes(foldSearchText(plan.handle))) return true
  }
  if (plan.orderText) {
    const num = foldSearchText(fields.orderNumber).replace(/^#+/, '')
    const needle = foldSearchText(plan.orderText).replace(/^#+/, '')
    if (num && needle && (num.includes(needle) || needle.includes(num))) return true
  }
  if (plan.phoneDigits) {
    const peer = `${fields.phone ?? ''} ${fields.peerId ?? ''}`.replace(/\D/g, '')
    if (peer && (peer.includes(plan.phoneDigits) || (plan.phoneFull && peer.includes(plan.phoneFull)))) return true
  }
  const hay = foldSearchText(
    [
      fields.name,
      fields.username ? `@${fields.username.replace(/^@/, '')}` : '',
      fields.preview,
      fields.peerId,
      fields.accountLabel,
      fields.orderNumber,
      fields.email,
      fields.phone,
    ].join(' '),
  )
  const needle = foldSearchText(q).replace(/^[@#]+/, '')
  return Boolean(needle) && hay.includes(needle)
}
