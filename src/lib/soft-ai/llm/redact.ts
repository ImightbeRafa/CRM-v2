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
