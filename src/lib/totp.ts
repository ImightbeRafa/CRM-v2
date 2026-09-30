import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s) for two-step login with an authenticator app.
 * In-house on node:crypto: no dependency. Replay protection (one code per time step) lives in
 * the caller, which stores the last accepted step.
 */
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) throw new Error('INVALID_BASE32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** 160-bit secret (RFC 4226 recommendation), base32 for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS)
}

export function totpCodeAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', secret).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (bin % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0')
}

/**
 * Returns the matched time step, or null. Accepts ±`window` steps for clock drift. Compares in
 * constant time and checks every candidate step (no early exit on a match).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
  window = 1,
): number | null {
  const normalized = String(code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return null
  let secret: Buffer
  try {
    secret = base32Decode(secretBase32)
  } catch {
    return null
  }
  if (secret.length < 10) return null
  const current = totpStep(nowMs)
  const given = Buffer.from(normalized)
  let matched: number | null = null
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta
    if (step < 0) continue
    const expected = Buffer.from(totpCodeAt(secret, step))
    if (timingSafeEqual(expected, given) && matched === null) matched = step
  }
  return matched
}

/** otpauth:// URI for authenticator apps (QR or manual entry). */
export function otpauthUri(opts: { secret: string; accountName: string; issuer?: string }): string {
  const issuer = opts.issuer || 'Betsy CRM'
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(opts.accountName)}`
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
