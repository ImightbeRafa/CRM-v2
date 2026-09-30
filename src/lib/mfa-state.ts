import 'server-only'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { decryptMfaSecretStrict, encryptMfaSecret, mfaCryptoAvailable, mfaHash } from '@/lib/mfa-crypto'
import { generateRecoveryCodes, hashRecoveryCode, recoveryCodeHashCandidates } from '@/lib/mfa-recovery'
import { generateTotpSecret, verifyTotp } from '@/lib/totp'

/**
 * Two-step login state (SQL 038).
 *
 * Tables absent = nobody enrolled (nobody can enrol before they exist) — UNLESS
 * MFA_TABLES_REQUIRED=1 (set once 038 is applied): then a missing table fails closed, so a restore
 * of an old backup or a wrong DATABASE_URL can never silently switch 2FA off (AUTH-48). Any OTHER
 * database error is thrown: the sign-in gate fails closed.
 */
export const MFA_CHALLENGE_TTL_MS = 10 * 60_000
export const MFA_MAX_ATTEMPTS = 5
export const MFA_SETUP_TTL_MS = 15 * 60_000
/** Per-user guess budget, shared by sign-in, setup, disable and recovery-code changes (AUTH-43). */
export const MFA_WINDOW_LIMIT = 10
export const MFA_DAY_LIMIT = 30

let tablesMissingUntil = 0
function markMissing(error: unknown): boolean {
  if (!isMissingRelation(error)) return false
  if (process.env.MFA_TABLES_REQUIRED === '1') {
    console.error('[2FA] tables missing while MFA_TABLES_REQUIRED=1: failing closed')
    return false
  }
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

export type MfaBudgetScope = 'signin' | 'manage'
/** Account changes (disable / new codes / setup) have their own window budget (AUTH-53). */
export const MFA_MANAGE_LIMIT = 10

/**
 * Spends one guess from the user's budget BEFORE a code is checked, in one conditional UPDATE (row
 * lock): parallel requests can't overspend, with or without Upstash (AUTH-43). Sign-in and account
 * changes have separate budgets, so exhausting one never locks the other (AUTH-53). `firstLock` is
 * true at most once a day (the caller emails the user; AUTH-54).
 */
export async function reserveMfaAttempt(
  userId: string,
  scope: MfaBudgetScope = 'signin',
): Promise<{ ok: true } | { ok: false; firstLock: boolean }> {
  const reserved =
    scope === 'signin'
      ? await prisma.$executeRaw`
    UPDATE "UserTwoFactor" SET
      "failCount" = CASE WHEN "failWindowStart" IS NULL OR "failWindowStart" < (now() AT TIME ZONE 'UTC') - interval '15 minutes' THEN 1 ELSE "failCount" + 1 END,
      "failWindowStart" = CASE WHEN "failWindowStart" IS NULL OR "failWindowStart" < (now() AT TIME ZONE 'UTC') - interval '15 minutes' THEN (now() AT TIME ZONE 'UTC') ELSE "failWindowStart" END,
      "dayFailCount" = CASE WHEN "dayWindowStart" IS NULL OR "dayWindowStart" < (now() AT TIME ZONE 'UTC') - interval '24 hours' THEN 1 ELSE "dayFailCount" + 1 END,
      "dayWindowStart" = CASE WHEN "dayWindowStart" IS NULL OR "dayWindowStart" < (now() AT TIME ZONE 'UTC') - interval '24 hours' THEN (now() AT TIME ZONE 'UTC') ELSE "dayWindowStart" END
    WHERE "userId" = ${userId}
      AND ("failWindowStart" IS NULL OR "failWindowStart" < (now() AT TIME ZONE 'UTC') - interval '15 minutes' OR "failCount" < ${MFA_WINDOW_LIMIT})
      AND ("dayWindowStart" IS NULL OR "dayWindowStart" < (now() AT TIME ZONE 'UTC') - interval '24 hours' OR "dayFailCount" < ${MFA_DAY_LIMIT})`
      : await prisma.$executeRaw`
    UPDATE "UserTwoFactor" SET
      "mgmtFailCount" = CASE WHEN "mgmtWindowStart" IS NULL OR "mgmtWindowStart" < (now() AT TIME ZONE 'UTC') - interval '15 minutes' THEN 1 ELSE "mgmtFailCount" + 1 END,
      "mgmtWindowStart" = CASE WHEN "mgmtWindowStart" IS NULL OR "mgmtWindowStart" < (now() AT TIME ZONE 'UTC') - interval '15 minutes' THEN (now() AT TIME ZONE 'UTC') ELSE "mgmtWindowStart" END
    WHERE "userId" = ${userId}
      AND ("mgmtWindowStart" IS NULL OR "mgmtWindowStart" < (now() AT TIME ZONE 'UTC') - interval '15 minutes' OR "mgmtFailCount" < ${MFA_MANAGE_LIMIT})`
  if (reserved === 1) return { ok: true }
  const notify = await prisma.$executeRaw`
    UPDATE "UserTwoFactor" SET "lockNotifiedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "userId" = ${userId}
      AND ("lockNotifiedAt" IS NULL OR "lockNotifiedAt" < (now() AT TIME ZONE 'UTC') - interval '24 hours')`
  return { ok: false, firstLock: notify === 1 }
}

/**
 * A proven code gives back only the slot it used (AUTH-54): an attacker's earlier guesses in the
 * window still count, and the day counter is never reset by a success.
 */
async function refundMfaAttempt(userId: string, scope: MfaBudgetScope): Promise<void> {
  if (scope === 'signin') {
    await prisma.$executeRaw`UPDATE "UserTwoFactor" SET "failCount" = GREATEST(0, "failCount" - 1) WHERE "userId" = ${userId}`
  } else {
    await prisma.$executeRaw`UPDATE "UserTwoFactor" SET "mgmtFailCount" = GREATEST(0, "mgmtFailCount" - 1) WHERE "userId" = ${userId}`
  }
}

/** True at most once a day: the first wrong code after a correct password is worth an email (AUTH-54). */
export async function shouldNotifyWrongCode(userId: string): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE "UserTwoFactor" SET "wrongCodeNotifiedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "userId" = ${userId}
      AND ("wrongCodeNotifiedAt" IS NULL OR "wrongCodeNotifiedAt" < (now() AT TIME ZONE 'UTC') - interval '24 hours')`
  return n === 1
}

/** A successful password reset clears the code budgets (the owner proved the mailbox; AUTH-53). */
export async function clearMfaBudgets(userId: string): Promise<void> {
  try {
    await prisma.userTwoFactor.updateMany({ where: { userId }, data: { failCount: 0, mgmtFailCount: 0 } })
  } catch (error) {
    if (!isMissingRelation(error)) throw error
  }
}

/**
 * Starts the "code pending" step of one sign-in. Several can be live (a second sign-in never kicks
 * the owner out of theirs; AUTH-53): guessing is bounded by the per-user budget, not by challenges.
 * Expired rows of the user are cleaned up. The raw nonce goes only into the encrypted JWT.
 */
export async function createMfaChallenge(userId: string, now = Date.now()): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = randomBytes(32).toString('base64url')
  const expiresAt = now + MFA_CHALLENGE_TTL_MS
  const nowDate = new Date(now)
  await prisma.$transaction([
    prisma.userTwoFactorChallenge.deleteMany({ where: { userId, expiresAt: { lte: nowDate } } }),
    prisma.userTwoFactorChallenge.create({
      data: { userId, nonceHash: mfaHash(nonce, 'challenge'), expiresAt: new Date(expiresAt) },
    }),
  ])
  return { nonce, expiresAt }
}

export type MfaVerifyResult =
  | { ok: true; method: 'totp' | 'recovery' | 'already_verified'; recoveryLeft?: number }
  | { ok: false; reason: 'expired' | 'locked' | 'invalid' | 'not_enrolled' | 'throttled'; firstLock?: boolean }

/**
 * Checks a code for the pending challenge. Order: challenge still live (5 attempts, spent
 * atomically) → user budget (atomic) → code. TOTP: one use per time step (replay-proof). Recovery
 * code: single use. On success the challenge is marked verified; the session upgrade consumes it.
 * A challenge that is already verified but not yet consumed answers success again (a lost
 * `update()` must not burn another code; AUTH-50).
 */
export async function verifyMfaChallenge(args: {
  userId: string
  nonce: string
  code?: string | null
  recoveryCode?: string | null
  now?: number
}): Promise<MfaVerifyResult> {
  const now = args.now ?? Date.now()
  const nowDate = new Date(now)
  const nonceHash = mfaHash(args.nonce, 'challenge')

  const already = await prisma.userTwoFactorChallenge.findFirst({
    where: { nonceHash, userId: args.userId, verifiedAt: { not: null }, consumedAt: null, expiresAt: { gt: nowDate } },
    select: { id: true },
  })
  if (already) return { ok: true, method: 'already_verified' }

  const spent = await prisma.userTwoFactorChallenge.updateMany({
    where: {
      nonceHash,
      userId: args.userId,
      consumedAt: null,
      verifiedAt: null,
      expiresAt: { gt: nowDate },
      attempts: { lt: MFA_MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  })
  if (spent.count !== 1) {
    const row = await prisma.userTwoFactorChallenge.findFirst({
      where: { nonceHash, userId: args.userId },
      select: { attempts: true },
    })
    if (row && row.attempts >= MFA_MAX_ATTEMPTS) return { ok: false, reason: 'locked' }
    return { ok: false, reason: 'expired' }
  }

  const method = await checkFactor(args.userId, { code: args.code, recoveryCode: args.recoveryCode }, now, 'signin')
  if (!method.ok) return { ok: false, reason: method.reason, firstLock: method.firstLock }

  await prisma.userTwoFactorChallenge.updateMany({
    where: { nonceHash, userId: args.userId, consumedAt: null, verifiedAt: null },
    data: { verifiedAt: nowDate },
  })
  return { ok: true, method: method.method, recoveryLeft: method.recoveryLeft }
}

/**
 * Checks a TOTP or recovery code. TOTP: the secret is decrypted FIRST (a server/key error never
 * spends the user's budget; AUTH-55), then one guess is reserved, then the code is compared.
 * Recovery codes (~50 bits, single use) are not budgeted: a lock can never take away the way back
 * in (AUTH-53); the per-challenge (sign-in) and per-IP caps still apply.
 */
async function checkFactor(
  userId: string,
  input: { code?: string | null; recoveryCode?: string | null },
  now: number,
  scope: MfaBudgetScope,
): Promise<
  | { ok: true; method: 'totp' | 'recovery'; recoveryLeft?: number }
  | { ok: false; reason: 'invalid' | 'not_enrolled' | 'throttled'; firstLock?: boolean }
> {
  const factor = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { secretEnc: true, enabledAt: true } })
  if (!factor?.enabledAt) return { ok: false, reason: 'not_enrolled' }
  if (input.code) {
    const secret = decryptMfaSecretStrict(factor.secretEnc, userId)
    const budget = await reserveMfaAttempt(userId, scope)
    if (!budget.ok) return { ok: false, reason: 'throttled', firstLock: budget.firstLock }
    const step = verifyTotp(secret, input.code, now)
    if (step !== null && (await consumeTotpStep(userId, step))) {
      await refundMfaAttempt(userId, scope)
      return { ok: true, method: 'totp' }
    }
    return { ok: false, reason: 'invalid' }
  }
  if (input.recoveryCode) {
    const left = await consumeRecoveryCode(userId, input.recoveryCode, now)
    if (left !== null) return { ok: true, method: 'recovery', recoveryLeft: left }
  }
  return { ok: false, reason: 'invalid' }
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
  const candidates = recoveryCodeHashCandidates(input)
  if (!candidates.length) return null
  const used = await prisma.userRecoveryCode.updateMany({
    where: { userId, codeHash: { in: candidates }, usedAt: null },
    data: { usedAt: new Date(now) },
  })
  if (used.count !== 1) return null
  return prisma.userRecoveryCode.count({ where: { userId, usedAt: null } })
}

export type FactorCheck = { ok: true } | { ok: false; reason: 'invalid' | 'not_enrolled' | 'throttled'; firstLock?: boolean }

/** Proves the user still holds the factor (disable / regenerate). Account-change budget, replay-safe. */
export async function verifyCurrentFactor(userId: string, input: { code?: string | null; recoveryCode?: string | null }): Promise<FactorCheck> {
  const result = await checkFactor(userId, input, Date.now(), 'manage')
  if (!result.ok) return { ok: false, reason: result.reason, firstLock: result.firstLock }
  return { ok: true }
}

export type MfaStatus = { available: boolean; enabled: boolean; enabledAt: string | null; recoveryLeft: number }

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const off = { available: false, enabled: false, enabledAt: null, recoveryLeft: 0 }
  if (mfaTablesKnownMissing()) return off
  try {
    const row = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { enabledAt: true } })
    const recoveryLeft = row?.enabledAt ? await prisma.userRecoveryCode.count({ where: { userId, usedAt: null } }) : 0
    // Enrolled users always see their state; new enrolment needs the dedicated key.
    return {
      available: Boolean(row?.enabledAt) || mfaCryptoAvailable(),
      enabled: Boolean(row?.enabledAt),
      enabledAt: row?.enabledAt?.toISOString() ?? null,
      recoveryLeft,
    }
  } catch (error) {
    if (markMissing(error)) return off
    throw error
  }
}

/** Everything setup needs that does NOT involve the password (checked before it; AUTH-52). */
export async function mfaSetupPrecheck(userId: string): Promise<{ ok: true } | { error: 'unavailable' | 'email_unverified' | 'already_enabled' }> {
  if (!mfaCryptoAvailable() || mfaTablesKnownMissing()) return { error: 'unavailable' }
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } })
  if (!owner?.emailVerified) return { error: 'email_unverified' }
  const existing = await prisma.userTwoFactor.findUnique({ where: { userId }, select: { enabledAt: true } })
  if (existing?.enabledAt) return { error: 'already_enabled' }
  return { ok: true }
}

/**
 * Setup step 1: a fresh secret, not active until a code proves the app has it. Never replaces an
 * ACTIVE factor (disable first).
 */
export async function beginMfaSetup(userId: string, now = Date.now()): Promise<{ secret: string } | { error: 'already_enabled' | 'unavailable' | 'email_unverified' }> {
  if (!mfaCryptoAvailable()) return { error: 'unavailable' }
  // Only a proven mailbox can put 2FA on an account (never a squatter on an unverified address).
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } })
  if (!owner?.emailVerified) return { error: 'email_unverified' }
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
): Promise<{ recoveryCodes: string[] } | { error: 'no_setup' | 'expired' | 'invalid' | 'throttled' }> {
  const row = await prisma.userTwoFactor.findUnique({
    where: { userId },
    select: { secretEnc: true, enabledAt: true, setupExpiresAt: true },
  })
  if (!row || row.enabledAt) return { error: 'no_setup' }
  if (!row.setupExpiresAt || row.setupExpiresAt.getTime() <= now) return { error: 'expired' }
  const secret = decryptMfaSecretStrict(row.secretEnc, userId)
  if (!(await reserveMfaAttempt(userId, 'manage')).ok) return { error: 'throttled' }
  const step = verifyTotp(secret, code, now)
  if (step === null) return { error: 'invalid' }

  const recoveryCodes = generateRecoveryCodes()
  const enabled = await prisma.$transaction(async (tx) => {
    const done = await tx.userTwoFactor.updateMany({
      where: { userId, enabledAt: null, secretEnc: row.secretEnc },
      data: {
        enabledAt: new Date(now),
        setupExpiresAt: null,
        lastUsedStep: BigInt(step),
        failCount: 0,
        mgmtFailCount: 0,
      },
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

/** Nightly: 2FA sign-in challenges older than a day are done (verified, consumed or expired). */
export async function purgeOldMfaChallenges(now = Date.now()): Promise<number> {
  try {
    const res = await prisma.userTwoFactorChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(now - 24 * 60 * 60_000) } },
    })
    return res.count
  } catch (error) {
    if (isMissingRelation(error)) return 0
    throw error
  }
}
