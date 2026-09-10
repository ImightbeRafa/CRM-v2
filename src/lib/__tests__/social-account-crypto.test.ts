import assert from 'node:assert/strict'
import test from 'node:test'
import { decrypt, encrypt } from '../encryption'
import {
  decryptSocialAccessToken,
  encryptSocialAccessToken,
} from '../social-account-crypto'

test('encryptSocialAccessToken roundtrip returns plaintext and stores enc: prefix', () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-soft-copilot-harden'
  const plaintext = 'EAAB-test-token-value-12345'
  const stored = encryptSocialAccessToken(plaintext)
  assert.equal(typeof stored, 'string')
  assert.ok(String(stored).startsWith('enc:'))
  assert.notEqual(stored, plaintext)
  assert.equal(decryptSocialAccessToken(stored), plaintext)
  assert.equal(decrypt(String(stored)), plaintext)
})

test('encryptSocialAccessToken is idempotent for already-encrypted values', () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-soft-copilot-harden'
  const once = encryptSocialAccessToken('token-abc')
  const twice = encryptSocialAccessToken(once)
  assert.equal(once, twice)
})

test('decryptSocialAccessToken passthrough keeps legacy plaintext readable', () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-soft-copilot-harden'
  assert.equal(decryptSocialAccessToken('legacy-plaintext-token'), 'legacy-plaintext-token')
  assert.equal(decryptSocialAccessToken(null), null)
  assert.equal(decryptSocialAccessToken(undefined), undefined)
  assert.equal(decryptSocialAccessToken(''), '')
})

test('encrypt() helper produces decryptable ciphertext for SocialAccount path', () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-soft-copilot-harden'
  const cipher = encrypt('graph-token')
  assert.ok(cipher.startsWith('enc:'))
  assert.equal(decrypt(cipher), 'graph-token')
  assert.equal(decrypt('not-encrypted'), 'not-encrypted')
})
