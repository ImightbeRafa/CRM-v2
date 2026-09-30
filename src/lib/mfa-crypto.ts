import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'crypto'

/**
 * Two-step login secrets at rest (SecureDog AUTH-45).
 *
 * - Own key: MFA_ENCRYPTION_KEY. In production there is NO fallback: without it 2FA reports itself
 *   unavailable (nobody can enrol), instead of silently tying secrets to NEXTAUTH_SECRET / a key
 *   someone may rotate during an incident. Dev / tests fall back to ENCRYPTION_KEY / NEXTAUTH_SECRET.
 * - Rotation: ciphertexts carry a key id; MFA_ENCRYPTION_KEY_PREVIOUS (comma separated) keeps old
 *   keys readable, and recovery-code hashes are checked against every known key.
 * - Separate AES and HMAC subkeys (HKDF). The user id is bound as AES additional data, so a secret
 *   copied onto another user's row fails. Decrypt is STRICT: no prefix → throws.
 *
 * NEVER change MFA_ENCRYPTION_KEY without moving the old value to MFA_ENCRYPTION_KEY_PREVIOUS.
 */
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const PREFIX = 'enc:mfa1:'

type MfaKey = { kid: string; aes: Buffer; mac: Buffer }

let cache: { signature: string; current: MfaKey; all: MfaKey[] } | null = null

function derive(source: string): MfaKey {
  const ikm = Buffer.from(source, 'utf8')
  return {
    kid: createHash('sha256').update(`betsy-mfa-kid:${source}`).digest('hex').slice(0, 8),
    aes: Buffer.from(hkdfSync('sha256', ikm, 'betsy-mfa-v1', 'aes-256-gcm', 32)),
    mac: Buffer.from(hkdfSync('sha256', ikm, 'betsy-mfa-v1', 'hmac-sha256', 32)),
  }
}

function currentSource(): string | null {
  const dedicated = process.env.MFA_ENCRYPTION_KEY?.trim()
  // Production: at least 32 characters (e.g. `openssl rand -base64 32`), or 2FA stays unavailable.
  if (dedicated && (process.env.NODE_ENV !== 'production' || dedicated.length >= 32)) return dedicated
  if (process.env.NODE_ENV === 'production') return null
  return process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || null
}

/** False in production until MFA_ENCRYPTION_KEY is set: setup refuses, the panel says so. */
export function mfaCryptoAvailable(): boolean {
  return Boolean(currentSource())
}

function keys(): { current: MfaKey; all: MfaKey[] } {
  const current = currentSource()
  if (!current) throw new Error('MFA_KEY_MISSING')
  const previous = (process.env.MFA_ENCRYPTION_KEY_PREVIOUS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const signature = [current, ...previous].join('\u0000')
  if (cache?.signature === signature) return cache
  const cur = derive(current)
  const all = [cur, ...previous.map(derive).filter((k) => k.kid !== cur.kid)]
  cache = { signature, current: cur, all }
  return cache
}

function aad(userId: string): Buffer {
  if (!userId) throw new Error('MFA_USER_REQUIRED')
  return Buffer.from(`betsy-mfa:${userId}`, 'utf8')
}

export function encryptMfaSecret(plaintext: string, userId: string): string {
  if (!plaintext) throw new Error('MFA_SECRET_REQUIRED')
  const additional = aad(userId)
  const { current } = keys()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, current.aes, iv)
  cipher.setAAD(additional)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${PREFIX}${current.kid}:${Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64')}`
}

export function decryptMfaSecretStrict(value: string, userId: string): string {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) throw new Error('MFA_SECRET_NOT_ENCRYPTED')
  const rest = value.slice(PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep !== 8) throw new Error('MFA_SECRET_CORRUPT')
  const kid = rest.slice(0, sep)
  const combined = Buffer.from(rest.slice(sep + 1), 'base64')
  if (combined.length <= IV_LENGTH + TAG_LENGTH) throw new Error('MFA_SECRET_CORRUPT')
  const key = keys().all.find((k) => k.kid === kid)
  if (!key) throw new Error('MFA_KEY_UNKNOWN')
  const iv = combined.subarray(0, IV_LENGTH)
  const tag = combined.subarray(combined.length - TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key.aes, iv)
  decipher.setAAD(aad(userId))
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
}

/** Keyed hash with the CURRENT key (store this). */
export function mfaHash(value: string, purpose: 'recovery' | 'challenge'): string {
  return createHmac('sha256', keys().current.mac).update(`${purpose}:${value}`).digest('hex')
}

/** Hashes under every known key (look-ups keep working across a key rotation). */
export function mfaHashCandidates(value: string, purpose: 'recovery' | 'challenge'): string[] {
  return keys().all.map((k) => createHmac('sha256', k.mac).update(`${purpose}:${value}`).digest('hex'))
}
