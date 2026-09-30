import { randomInt } from 'crypto'
import { mfaHash, mfaHashCandidates } from './mfa-crypto'

/**
 * One-time recovery codes for two-step login: shown once, stored only as keyed hashes, each usable
 * once. Format `xxxxx-xxxxx` from an unambiguous alphabet (no 0/O, 1/I/L): 10 chars ≈ 50 bits.
 */
export const RECOVERY_CODE_COUNT = 10
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode(): string {
  let out = ''
  for (let i = 0; i < 10; i += 1) out += ALPHABET[randomInt(ALPHABET.length)]
  return `${out.slice(0, 5)}-${out.slice(5)}`.toLowerCase()
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>()
  while (codes.size < count) codes.add(randomCode())
  return [...codes]
}

/** Case, spaces and dashes don't matter when the user types it back. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = String(input ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (clean.length !== 10) return null
  for (const ch of clean) if (!ALPHABET.includes(ch)) return null
  return clean
}

export function hashRecoveryCode(input: string): string | null {
  const normalized = normalizeRecoveryCode(input)
  return normalized ? mfaHash(normalized, 'recovery') : null
}

/** Hashes of the code under every known key (a key rotation never invalidates saved codes). */
export function recoveryCodeHashCandidates(input: string): string[] {
  const normalized = normalizeRecoveryCode(input)
  return normalized ? mfaHashCandidates(normalized, 'recovery') : []
}
