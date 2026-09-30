import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'crypto'

/**
 * Two-step login secrets at rest. Same AES-256-GCM as `encryption.ts`, but:
 * - its own key derivation (salt 'betsy-mfa-v1'), so it never shares a key with social tokens;
 * - the user id is bound as AES additional data: a secret copied onto another user's row fails;
 * - decrypt is STRICT: anything without the `enc:` prefix throws (a plaintext value planted in the
 *   DB is never accepted as a secret).
 */
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const PREFIX = 'enc:mfa1:'

let cachedKey: { source: string; key: Buffer } | null = null

function mfaKeySource(): string {
  const secret = process.env.MFA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('MFA_ENCRYPTION_KEY, ENCRYPTION_KEY or NEXTAUTH_SECRET must be set')
  return secret
}

function mfaKey(): Buffer {
  const source = mfaKeySource()
  if (cachedKey?.source === source) return cachedKey.key
  const key = scryptSync(source, 'betsy-mfa-v1', 32)
  cachedKey = { source, key }
  return key
}

function aad(userId: string): Buffer {
  if (!userId) throw new Error('MFA_USER_REQUIRED')
  return Buffer.from(`betsy-mfa:${userId}`, 'utf8')
}

export function encryptMfaSecret(plaintext: string, userId: string): string {
  if (!plaintext) throw new Error('MFA_SECRET_REQUIRED')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, mfaKey(), iv)
  cipher.setAAD(aad(userId))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64')
}

export function decryptMfaSecretStrict(value: string, userId: string): string {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) throw new Error('MFA_SECRET_NOT_ENCRYPTED')
  const combined = Buffer.from(value.slice(PREFIX.length), 'base64')
  if (combined.length <= IV_LENGTH + TAG_LENGTH) throw new Error('MFA_SECRET_CORRUPT')
  const iv = combined.subarray(0, IV_LENGTH)
  const tag = combined.subarray(combined.length - TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, mfaKey(), iv)
  decipher.setAAD(aad(userId))
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
}

/** Keyed hash for recovery codes / challenge nonces (never stored in plaintext). */
export function mfaHash(value: string, purpose: 'recovery' | 'challenge'): string {
  return createHmac('sha256', mfaKey()).update(`${purpose}:${value}`).digest('hex')
}
