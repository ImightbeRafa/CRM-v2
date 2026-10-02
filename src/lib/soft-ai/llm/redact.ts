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

const CARD_RE = /\b(?:\d[ .-]?){12,18}\d\b/g
const CEDULA_DASHED_RE = /\b\d[ -]\d{4}[ -]\d{4}\b/g
// Label (cédula, DIMEX, pasaporte, identificación...) + filler words + the first token that contains a digit.
const ID_LABEL_RE =
  /\b(c[eé]dula|dimex|pasaporte|identificaci[oó]n|id)\b((?:\s+(?:de|es|n[uú]mero|num|no\.?|nro\.?|personal|jur[ií]dica|f[ií]sica)|[:#.\s-])*)([A-Za-z]{0,3}\d[A-Za-z0-9 -]{5,14}\d)/gi
const CUENTA_CLIENTE_RE = /\b\d{17}\b/g
const CR_ACCOUNT_RE = /\b\d{3}-\d{6,8}-\d\b/g
const IBAN_ANY_RE = /\b([A-Za-z]{2}\d{2})((?:\s?[A-Za-z0-9]){8,30})\b/g

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

/** Costa Rican ID numbers: dashed/spaced cédula, labelled cédula/DIMEX/pasaporte (any filler words), 17-digit cuenta cliente. */
export function redactIdNumbers(text: string): string {
  return text
    .replace(CEDULA_DASHED_RE, '[cédula]')
    .replace(ID_LABEL_RE, (_m, label: string, sep: string) => `${label}${sep}[número oculto]`)
    .replace(CUENTA_CLIENTE_RE, '[cuenta]')
    .replace(CR_ACCOUNT_RE, '[cuenta]')
}

function redactIbanAnyCase(text: string): string {
  return text.replace(IBAN_ANY_RE, (m, start: string, rest: string) => {
    const compact = rest.replace(/\s/g, '')
    // Needs at least 8 more characters and at least 6 digits overall to look like an account number, not a word.
    return compact.length >= 8 && (compact.match(/\d/g) || []).length >= 6 ? `${start}****${compact.slice(-4)}` : m
  })
}

/**
 * What the AI agents never see: card numbers, account/IBAN/SINPE and ID numbers. Applied to every customer
 * message and history line before a provider call. Best effort by pattern — it cannot catch every possible format.
 * Phones and emails are NOT masked here (the conversation itself is addressed to them).
 */
export function redactSensitiveForProvider(text: string): string {
  return redactIdNumbers(redactIbanAnyCase(redactIban(redactSinpe(redactCardNumbers(text)))))
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
