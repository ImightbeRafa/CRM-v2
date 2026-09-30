import 'server-only'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { decryptMfaSecretStrict, encryptMfaSecret, mfaHash } from '@/lib/mfa-crypto'
import { generateRecoveryCodes, hashRecoveryCode } from '@/lib/mfa-recovery'
import { generateTotpSecret, verifyTotp } from '@/lib/totp'

/**
 * Two-step login state (SQL 038). Tables absent = nobody enrolled (nobody can enrol before they
 * exist). Any OTHER database error is thrown: the sign-in gate fails closed.
 */
export const MFA_CHALLENGE_TTL_MS = 10 * 60_000
export const MFA_MAX_ATTEMPTS = 5
export const MFA_SETUP_TTL_MS = 15 * 60_000

let tablesMissingUntil = 0
function markMissing(error: unknown): boolean {
  if (!isMissingRelation(error)) return false
  tablesMissingUntil = Date.now() + 5 * 60_000
  return true
}
export function mfaTablesKnownMissing(): boolean {
  return Date.now() < tablesMissingUntil
}

/** True when the user has finished enrolling (a code will be asked at every sign-in). */
export async function isMfaEnabled(userId: string): Promise<boolean> {
  if (!userId) return false
  if (mfaTablesKnownMissing()) return false
  try {
    const row = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { enabledAt: true } })
    return Boolean(row?.enabledAt)
  } catch (error) {
    if (markMissing(error)) return false
    throw error
  }
}

/** Starts the "code pending" step of one sign-in. The raw nonce goes only into the encrypted JWT. */
export async function createMfaChallenge(userId: string, now = Date.now()): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = randomBytes(32).toString('base64url')
  const expiresAt = now + MFA_CHALLENGE_TTL_MS
  await prisma.userTwoFactorChallenge.create({
    data: { userId, nonceHash: mfaHash(nonce, 'challenge'), expiresAt: new Date(expiresAt) },
  })
  return { nonce, expiresAt }
}

export type MfaVerifyResult =
  | { ok: true; method: 'totp' | 'recovery'; recoveryLeft?: number }
  | { ok: false; reason: 'expired' | 'locked' | 'invalid' | 'not_enrolled' }

/**
 * Checks a code for the pending challenge. Spends one attempt atomically BEFORE checking (5 per
 * challenge, then the sign-in must restart). TOTP: one use per time step (replay-proof). Recovery
 * code: single use. On success the challenge is marked verified (the session upgrade consumes it).
 */
export async function verifyMfaChallenge(args: {
  userId: string
  nonce: string
  code?: string | null
  recoveryCode?: string | null
  now?: number
}): Promise<MfaVerifyResult> {
  const now = args.now ?? Date.now()
  const nonceHash = mfaHash(args.nonce, 'challenge')
  const spent = await prisma.userTwoFactorChallenge.updateMany({
    where: {
      nonceHash,
      userId: args.userId,
      consumedAt: null,
      verifiedAt: null,
      expiresAt: { gt: new Date(now) },
      attempts: { lt: MFA_MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  })
  if (spent.count !== 1) {
    const row = await prisma.userTwoFactorChallenge.findFirst({
      where: { nonceHash, userId: args.userId },
      select: { attempts: true, expiresAt: true },
    })
    if (row && row.attempts >= MFA_MAX_ATTEMPTS) return { ok: false, reason: 'locked' }
    return { ok: false, reason: 'expired' }
  }

  const factor = await prisma.userTwoFactor.findUnique({
    where: { userId: args.userId },
    select: { secretEnc: true, enabledAt: true },
  })
  if (!factor?.enabledAt) return { ok: false, reason: 'not_enrolled' }

  let method: 'totp' | 'recovery' | null = null
  let recoveryLeft: number | undefined
  if (args.code) {
    const step = verifyTotp(decryptMfaSecretStrict(factor.secretEnc, args.userId), args.code, now)
    if (step !== null && (await consumeTotpStep(args.userId, step))) method = 'totp'
  } else if (args.recoveryCode) {
    const used = await consumeRecoveryCode(args.userId, args.recoveryCode, now)
    if (used !== null) {
      method = 'recovery'
      recoveryLeft = used
    }
  }
  if (!method) return { ok: false, reason: 'invalid' }

  await prisma.userTwoFactorChallenge.updateMany({
    where: { nonceHash, userId: args.userId, consumedAt: null, verifiedAt: null },
    data: { verifiedAt: new Date(now) },
  })
  return { ok: true, method, recoveryLeft }
}

/** Upgrades the session exactly once: verified, not yet consumed, not expired. */
export async function consumeVerifiedMfaChallenge(userId: string, nonce: string, now = Date.now()): Promise<boolean> {
  const done = await prisma.userTwoFactorChallenge.updateMany({
    where: {
      nonceHash: mfaHash(nonce, 'challenge'),
      userId,
      verifiedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: new Date(now) },
    },
    data: { consumedAt: new Date(now) },
  })
  return done.count === 1
}

/** One accepted code per 30 s step: a code seen once (e.g. shoulder-surfed) can't be replayed. */
async function consumeTotpStep(userId: string, step: number): Promise<boolean> {
  const done = await prisma.$executeRaw`
    UPDATE "UserTwoFactor" SET "lastUsedStep" = ${BigInt(step)}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${userId} AND "enabledAt" IS NOT NULL
      AND ("lastUsedStep" IS NULL OR "lastUsedStep" < ${BigInt(step)})`
  return done === 1
}

/** Returns how many unused codes remain after this one, or null if the code is not valid. */
async function consumeRecoveryCode(userId: string, input: string, now: number): Promise<number | null> {
  const codeHash = hashRecoveryCode(input)
  if (!codeHash) return null
  const used = await prisma.userRecoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date(now) },
  })
  if (used.count !== 1) return null
  return prisma.userRecoveryCode.count({ where: { userId, usedAt: null } })
}

/** Proves the user still holds the factor (disable / regenerate). Replay-safe like sign-in. */
export async function verifyCurrentFactor(userId: string, input: { code?: string | null; recoveryCode?: string | null }): Promise<boolean> {
  const factor = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { secretEnc: true, enabledAt: true } })
  if (!factor?.enabledAt) return false
  if (input.code) {
    const step = verifyTotp(decryptMfaSecretStrict(factor.secretEnc, userId), input.code)
    return step !== null && (await consumeTotpStep(userId, step))
  }
  if (input.recoveryCode) return (await consumeRecoveryCode(userId, input.recoveryCode, Date.now())) !== null
  return false
}

export type MfaStatus = { available: boolean; enabled: boolean; enabledAt: string | null; recoveryLeft: number }

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  if (mfaTablesKnownMissing()) return { available: false, enabled: false, enabledAt: null, recoveryLeft: 0 }
  try {
    const row = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { enabledAt: true } })
    const recoveryLeft = row?.enabledAt ? await prisma.userRecoveryCode.count({ where: { userId, usedAt: null } }) : 0
    return { available: true, enabled: Boolean(row?.enabledAt), enabledAt: row?.enabledAt?.toISOString() ?? null, recoveryLeft }
  } catch (error) {
    if (markMissing(error)) return { available: false, enabled: false, enabledAt: null, recoveryLeft: 0 }
    throw error
  }
}

/**
 * Setup step 1: a fresh secret, not active until a code proves the app has it. Never replaces an
 * ACTIVE factor (disable first).
 */
export async function beginMfaSetup(userId: string, now = Date.now()): Promise<{ secret: string } | { error: 'already_enabled' }> {
  const existing = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { enabledAt: true } })
  if (existing?.enabledAt) return { error: 'already_enabled' }
  const secret = generateTotpSecret()
  const data = {
    secretEnc: encryptMfaSecret(secret, userId),
    enabledAt: null,
    lastUsedStep: null,
    setupExpiresAt: new Date(now + MFA_SETUP_TTL_MS),
  }
  // Only a not-yet-enabled row may be overwritten (race with a concurrent enable is refused).
  const updated = await prisma.userTwoFactor.updateMany({ where: { userId, enabledAt: null }, data })
  if (updated.count === 0) {
    try {
      await prisma.userTwoFactor.create({ data: { userId, ...data } })
    } catch {
      return { error: 'already_enabled' }
    }
  }
  return { secret }
}

/** Setup step 2: the code proves the app has the secret. Returns the recovery codes ONCE. */
export async function completeMfaSetup(
  userId: string,
  code: string,
  now = Date.now(),
): Promise<{ recoveryCodes: string[] } | { error: 'no_setup' | 'expired' | 'invalid' }> {
  const row = await prisma.userTwoFactor.findUnique({
    where: { userId },
    select: { secretEnc: true, enabledAt: true, setupExpiresAt: true },
  })
  if (!row || row.enabledAt) return { error: 'no_setup' }
  if (!row.setupExpiresAt || row.setupExpiresAt.getTime() <= now) return { error: 'expired' }
  const step = verifyTotp(decryptMfaSecretStrict(row.secretEnc, userId), code, now)
  if (step === null) return { error: 'invalid' }

  const recoveryCodes = generateRecoveryCodes()
  const enabled = await prisma.$transaction(async (tx) => {
    const done = await tx.userTwoFactor.updateMany({
      where: { userId, enabledAt: null, secretEnc: row.secretEnc },
      data: { enabledAt: new Date(now), setupExpiresAt: null, lastUsedStep: BigInt(step) },
    })
    if (done.count !== 1) return false
    await tx.userRecoveryCode.deleteMany({ where: { userId } })
    await tx.userRecoveryCode.createMany({
      data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) as string })),
    })
    await tx.userTwoFactorChallenge.deleteMany({ where: { userId } })
    return true
  })
  if (!enabled) return { error: 'no_setup' }
  return { recoveryCodes }
}

/** New set of recovery codes (old ones stop working). Caller has verified the current factor. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const recoveryCodes = generateRecoveryCodes()
  await prisma.$transaction(async (tx) => {
    await tx.userRecoveryCode.deleteMany({ where: { userId } })
    await tx.userRecoveryCode.createMany({
      data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) as string })),
    })
  })
  return recoveryCodes
}

/** Turns 2FA off. Caller has verified the current factor (and password). */
export async function disableMfa(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userRecoveryCode.deleteMany({ where: { userId } })
    await tx.userTwoFactorChallenge.deleteMany({ where: { userId } })
    await tx.userTwoFactor.deleteMany({ where: { userId } })
  })
}

