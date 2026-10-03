/**
 * Soft Agent Layer PII redaction for toolTrace persistence.
 */

const PHONE_RE = /(?:\+?506[\s-]?)?(\d{4})[\s-]?(\d{4})\b/g
const EMAIL_RE = /([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@)([A-Za-z0-9.-]+)(\.[A-Za-z]{2,})/g
const SINPE_RE = /\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g
const IBAN_RE = /\b([A-Z]{2}\d{2})([A-Z0-9]{4,})([A-Z0-9]{4})\b/g
const COMPROBANTE_RE = /\b(comp(?:robante)?|ref(?:erencia)?)[:\s#-]*([A-Z0-9-]{6,})\b/gi

export function redactPhone(text: string): string {
  return text.replace(PHONE_RE, (_m, a: string, b: string) => {
    if (String(_m).includes('506') || String(_m).startsWith('+')) {
      return `+506 **** ${b}`
    }
    return `${a.slice(0, 0)}**** ${b}`
  })
}

export function redactEmail(text: string): string {
  return text.replace(EMAIL_RE, (_m, first, _rest, _at, _domain, tld) => {
    return `${first}***@***.${String(tld).replace(/^\./, '')}`
  })
}

export function redactSinpe(text: string): string {
  return text.replace(SINPE_RE, (_m, _a, _b, _c, d: string) => `SINPE ****${d}`)
}

export function redactIban(text: string): string {
  return text.replace(IBAN_RE, (_m, start: string, _mid, end: string) => `${start}****${end}`)
}

export function redactComprobante(text: string): string {
  return text.replace(COMPROBANTE_RE, (_m, label: string, id: string) => {
    const tail = id.slice(-4)
    return `${label} ****${tail}`
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Provider-bound masking (what the AI agents never see). Every pattern below is linear-time on customer text: no
// nested or overlapping quantifiers (a crafted message must never be able to stall the event loop), and each one
// only matches number SHAPES — never words, SKUs, prices, tracking numbers or quantities next to each other.
// ---------------------------------------------------------------------------------------------------------------

/** Card candidates: 13–19 digits, each optionally preceded by ONE space, dot or dash. Luhn decides. */
const CARD_RE = /\b\d(?:[ .-]?\d){12,18}\b/g
/** IBAN: 2 letters + 2 check digits + groups of 4 digits (CR IBAN = CRkk + 18 digits). Digits only after the prefix. */
const IBAN_PROVIDER_RE = /\b([A-Za-z]{2}\d{2})((?:[ ]?\d{4}){3,7})((?:[ ]?\d{1,4})?)\b/g
/** Dashed cédula without a label (1-2345-6789). Spaced forms are only masked after a label (they look like prices). */
const CEDULA_DASHED_RE = /\b\d-\d{4}-\d{4}\b/g
const CUENTA_CLIENTE_RE = /\b\d{17}\b/g
const CR_ACCOUNT_RE = /\b\d{3}-\d{6,8}-\d\b/g

/** ID labels. Sticky helpers below walk forward from each label without backtracking across alternatives. */
const ID_LABEL_RE = /\b(?:c[eé]dula|dimex|pasaporte|identificaci[oó]n)\b/gi
const SEP_STICKY = /[\s:#.,-]{0,4}/y
const FILLER_STICKY = /(?:de|es|mi|n[uú]mero|num|no|nro|personal|jur[ií]dica|f[ií]sica)\b\.?/iy
/** The ID itself: optional 1–3 letter prefix, then digits with at most one space/dash between digits. */
const ID_VALUE_STICKY = /[A-Za-z]{0,3}\d(?:[ -]?\d){4,14}/y

/** Never scan more than this per message: longer text is cut before masking (the prompt caps it anyway). */
export const PROVIDER_REDACT_MAX_CHARS = 4_000

function luhnOk(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** Card numbers (13–19 digits that pass the Luhn check; spaces, dashes and dots allowed). */
export function redactCardNumbers(text: string): string {
  return text.replace(CARD_RE, (m) => {
    const digits = m.replace(/[^0-9]/g, '')
    return digits.length >= 13 && digits.length <= 19 && luhnOk(digits) ? `****${digits.slice(-4)}` : m
  })
}

function redactIbanForProvider(text: string): string {
  return text.replace(IBAN_PROVIDER_RE, (_m, start: string, body: string, tail: string) => {
    const digits = `${body}${tail}`.replace(/\s/g, '')
    return `${start.toUpperCase()}****${digits.slice(-4)}`
  })
}

/** Masks the value that follows an ID label, skipping up to 4 filler words ("es", "número", ...). */
function redactLabeledIds(text: string): string {
  const spans: Array<[number, number]> = []
  ID_LABEL_RE.lastIndex = 0
  for (let m = ID_LABEL_RE.exec(text); m; m = ID_LABEL_RE.exec(text)) {
    let pos = m.index + m[0].length
    for (let i = 0; i < 5; i += 1) {
      SEP_STICKY.lastIndex = pos
      if (SEP_STICKY.exec(text)) pos = SEP_STICKY.lastIndex
      FILLER_STICKY.lastIndex = pos
      if (i < 4 && FILLER_STICKY.exec(text)) {
        pos = FILLER_STICKY.lastIndex
        continue
      }
      break
    }
    ID_VALUE_STICKY.lastIndex = pos
    const value = ID_VALUE_STICKY.exec(text)
    if (value && value[0].replace(/\D/g, '').length >= 6) spans.push([pos, pos + value[0].length])
  }
  if (!spans.length) return text
  let out = ''
  let cursor = 0
  for (const [a, b] of spans) {
    if (a < cursor) continue
    out += `${text.slice(cursor, a)}[número oculto]`
    cursor = b
  }
  return out + text.slice(cursor)
}

/** Costa Rican ID and account numbers: labelled IDs, dashed cédula, 17-digit cuenta cliente, bank account. */
export function redactIdNumbers(text: string): string {
  return redactLabeledIds(text)
    .replace(CEDULA_DASHED_RE, '[cédula]')
    .replace(CUENTA_CLIENTE_RE, '[cuenta]')
    .replace(CR_ACCOUNT_RE, '[cuenta]')
}

/**
 * What the AI agents never see: card numbers, IBAN/account numbers and ID numbers. Applied to every customer
 * message and history line before a provider call. Best effort by pattern — it cannot catch every possible format.
 * Phones and emails are NOT masked here (the conversation itself is addressed to them).
 */
export function redactSensitiveForProvider(text: string): string {
  const bounded = text.length > PROVIDER_REDACT_MAX_CHARS ? text.slice(0, PROVIDER_REDACT_MAX_CHARS) : text
  return redactIdNumbers(redactIbanForProvider(redactCardNumbers(bounded)))
}

export function redactPiiText(text: string): string {
  let out = text
  out = redactEmail(out)
  out = redactIban(out)
  out = redactSinpe(out)
  out = redactPhone(out)
  out = redactComprobante(out)
  return out
}

export function redactToolTrace(value: unknown): unknown {
  if (typeof value === 'string') return redactPiiText(value)
  if (Array.isArray(value)) return value.map((v) => redactToolTrace(v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactToolTrace(v)
    }
    return out
  }
  return value
}
