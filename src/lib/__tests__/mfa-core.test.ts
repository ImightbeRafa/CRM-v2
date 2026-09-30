import assert from 'node:assert/strict'
import test from 'node:test'
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCodeAt,
  totpStep,
  verifyTotp,
} from '../totp'
import { decryptMfaSecretStrict, encryptMfaSecret, mfaCryptoAvailable, mfaHash, mfaHashCandidates } from '../mfa-crypto'
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_COUNT, recoveryCodeHashCandidates } from '../mfa-recovery'

process.env.NEXTAUTH_SECRET ||= 'test-secret-for-mfa-core'

// RFC 6238 appendix B, SHA1 seed "12345678901234567890" (last 6 digits of the 8-digit vectors).
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii')
const RFC_SECRET = base32Encode(RFC_SEED)

test('TOTP matches the RFC 6238 SHA1 test vectors', () => {
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ]
  for (const [seconds, code] of vectors) {
    assert.equal(totpCodeAt(RFC_SEED, totpStep(seconds * 1000)), code, `T=${seconds}`)
    assert.equal(verifyTotp(RFC_SECRET, code, seconds * 1000, 0), totpStep(seconds * 1000))
  }
})

test('TOTP accepts ±1 step of clock drift and refuses anything further', () => {
  const now = 1111111109 * 1000
  const step = totpStep(now)
  const prev = totpCodeAt(RFC_SEED, step - 1)
  const next = totpCodeAt(RFC_SEED, step + 1)
  const far = totpCodeAt(RFC_SEED, step + 2)
  assert.equal(verifyTotp(RFC_SECRET, prev, now), step - 1)
  assert.equal(verifyTotp(RFC_SECRET, next, now), step + 1)
  assert.equal(verifyTotp(RFC_SECRET, far, now), null)
})

test('TOTP refuses malformed input and bad secrets', () => {
  const now = 59 * 1000
  for (const bad of ['', '12345', '1234567', 'abcdef', '28708a', '287 08', null, undefined]) {
    assert.equal(verifyTotp(RFC_SECRET, bad as unknown as string, now), null, String(bad))
  }
  assert.equal(verifyTotp(RFC_SECRET, ' 287082 ', now, 0), totpStep(now)) // spaces tolerated
  assert.equal(verifyTotp('!!!notbase32', '287082', now), null)
  assert.equal(verifyTotp('AAAA', '287082', now), null) // too short a secret
})

test('base32 round-trips and new secrets are 160-bit', () => {
  const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7])
  assert.deepEqual(base32Decode(base32Encode(buf)), buf)
  const secret = generateTotpSecret()
  assert.match(secret, /^[A-Z2-7]{32}$/)
  assert.equal(base32Decode(secret).length, 20)
  assert.notEqual(generateTotpSecret(), secret)
})

test('otpauth URI carries issuer, account and parameters (escaped)', () => {
  const uri = otpauthUri({ secret: 'ABC', accountName: 'ana+x@betsycrm.com' })
  assert.match(uri, /^otpauth:\/\/totp\/Betsy%20CRM:ana%2Bx%40betsycrm\.com\?/)
  const params = new URL(uri).searchParams
  assert.equal(params.get('secret'), 'ABC')
  assert.equal(params.get('issuer'), 'Betsy CRM')
  assert.equal(params.get('digits'), '6')
  assert.equal(params.get('period'), '30')
})

test('secret encryption: round trip, bound to the user, strict on plaintext / tampering', () => {
  const enc = encryptMfaSecret('JBSWY3DPEHPK3PXP', 'user-a')
  assert.match(enc, /^enc:mfa1:/)
  assert.doesNotMatch(enc, /JBSWY3DPEHPK3PXP/)
  assert.equal(decryptMfaSecretStrict(enc, 'user-a'), 'JBSWY3DPEHPK3PXP')
  assert.notEqual(encryptMfaSecret('JBSWY3DPEHPK3PXP', 'user-a'), enc) // random IV
  // Copied onto another user's row: refused.
  assert.throws(() => decryptMfaSecretStrict(enc, 'user-b'))
  // A plaintext (or social-token style) value planted in the DB is never accepted.
  assert.throws(() => decryptMfaSecretStrict('JBSWY3DPEHPK3PXP', 'user-a'), /MFA_SECRET_NOT_ENCRYPTED/)
  assert.throws(() => decryptMfaSecretStrict('enc:AAAA', 'user-a'), /MFA_SECRET_NOT_ENCRYPTED/)
  // Key id travels with the ciphertext.
  assert.match(enc, /^enc:mfa1:[0-9a-f]{8}:/)
  // Tampered ciphertext: refused.
  const kid = enc.slice('enc:mfa1:'.length, 'enc:mfa1:'.length + 8)
  const raw = Buffer.from(enc.slice('enc:mfa1:'.length + 9), 'base64')
  raw[14] ^= 1
  assert.throws(() => decryptMfaSecretStrict(`enc:mfa1:${kid}:` + raw.toString('base64'), 'user-a'))
  assert.throws(() => decryptMfaSecretStrict('enc:mfa1:AA==', 'user-a'), /MFA_SECRET_CORRUPT/)
  assert.throws(() => decryptMfaSecretStrict(`enc:mfa1:${kid}:AA==`, 'user-a'), /MFA_SECRET_CORRUPT/)
  assert.throws(() => encryptMfaSecret('x', ''), /MFA_USER_REQUIRED/)
})

test('recovery codes: 10 unique, readable, hashed (never plaintext), typed back loosely', () => {
  const codes = generateRecoveryCodes()
  assert.equal(codes.length, RECOVERY_CODE_COUNT)
  assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT)
  for (const c of codes) assert.match(c, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/)
  const [first] = codes
  const hash = hashRecoveryCode(first)
  assert.ok(hash && /^[0-9a-f]{64}$/.test(hash))
  assert.ok(!hash.includes(first.replace('-', '')))
  assert.equal(hashRecoveryCode(first.toUpperCase().replace('-', ' ')), hash)
  assert.equal(hashRecoveryCode(` ${first} `), hash)
  assert.notEqual(hashRecoveryCode(codes[1]), hash)
  for (const bad of ['', 'short', 'abcde-fghi0', 'abcde-fghij-k', null]) {
    assert.equal(normalizeRecoveryCode(bad as unknown as string), null, String(bad))
  }
  // Recovery and challenge hashes live in separate domains.
  assert.notEqual(mfaHash('X', 'recovery'), mfaHash('X', 'challenge'))
})

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  try {
    fn()
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

test('AUTH-45: dedicated key required in production; rotation keeps secrets and recovery codes readable', () => {
  // Production without MFA_ENCRYPTION_KEY: unavailable, never a silent fallback to NEXTAUTH_SECRET.
  withEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: undefined }, () => {
    assert.equal(mfaCryptoAvailable(), false)
    assert.throws(() => encryptMfaSecret('X', 'u'), /MFA_KEY_MISSING/)
  })
  // AUTH-55: a weak (short) key in production counts as no key.
  withEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'short-key' }, () => {
    assert.equal(mfaCryptoAvailable(), false)
  })
  let oldCipher = ''
  let oldHash = ''
  withEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'key-A-0123456789abcdef0123456789abcdef', MFA_ENCRYPTION_KEY_PREVIOUS: undefined }, () => {
    assert.equal(mfaCryptoAvailable(), true)
    oldCipher = encryptMfaSecret('SECRET', 'u1')
    oldHash = hashRecoveryCode('abcde-fghjk') as string
  })
  // Rotated WITH the old key kept as previous: still readable; new writes use the new key.
  withEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'key-B-0123456789abcdef0123456789abcdef', MFA_ENCRYPTION_KEY_PREVIOUS: 'key-A-0123456789abcdef0123456789abcdef' }, () => {
    assert.equal(decryptMfaSecretStrict(oldCipher, 'u1'), 'SECRET')
    assert.ok(recoveryCodeHashCandidates('ABCDE FGHJK').includes(oldHash))
    assert.notEqual(hashRecoveryCode('abcde-fghjk'), oldHash)
    assert.notEqual(encryptMfaSecret('SECRET', 'u1').slice(0, 18), oldCipher.slice(0, 18))
  })
  // Rotated WITHOUT keeping the old key: refused loudly (not a wrong-code loop).
  withEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'key-B-0123456789abcdef0123456789abcdef', MFA_ENCRYPTION_KEY_PREVIOUS: undefined }, () => {
    assert.throws(() => decryptMfaSecretStrict(oldCipher, 'u1'), /MFA_KEY_UNKNOWN/)
  })
  // AES and HMAC use different subkeys; challenge / recovery domains differ.
  withEnv({ MFA_ENCRYPTION_KEY: 'key-A' }, () => {
    assert.equal(mfaHashCandidates('X', 'challenge').length, 1)
    assert.notEqual(mfaHash('X', 'recovery'), mfaHash('X', 'challenge'))
  })
})
