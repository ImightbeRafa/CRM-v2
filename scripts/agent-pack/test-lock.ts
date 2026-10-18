/**
 * Sleeping exam C4 (2026-10-18): ONE test run (exam / mystery shoppers / silent trial) per business at a time.
 * The old guard only refused when the current cap was ≥ the requested cap, so a run asking for a higher cap started
 * while another was still running; both shared the ceiling and the later rows ended "not run".
 *
 * The lock is its own row (TenantFeatureFlag key `agent_test_session_lock`, enabled=false, never read by the app),
 * taken and released inside a row-locked transaction (SELECT … FOR UPDATE), so two scripts cannot both take it. A run
 * that died without releasing it (power cut, kill -9) blocks for at most LOCK_TTL_MS. Both moves are audited by the
 * caller (test-session.ts).
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { Prisma } from '@prisma/client'

export const TEST_SESSION_LOCK_KEY = 'agent_test_session_lock'
/** Longest a run may hold the lock without releasing it (the longest silent trial takes ~3 h). */
export const LOCK_TTL_MS = 6 * 60 * 60_000

export type TestLock = { token: string; label: string; host: string; pid: number; startedAt: string; expiresAt: string; cap: number }

/** The lock a row holds right now (null = free: no row, released, malformed or expired). Pure. */
export function activeLock(config: unknown, now: Date): TestLock | null {
  const c = (config && typeof config === 'object' ? config : {}) as Partial<TestLock> & { released?: boolean }
  if (c.released || typeof c.token !== 'string' || typeof c.expiresAt !== 'string') return null
  const until = Date.parse(c.expiresAt)
  if (!Number.isFinite(until) || until <= now.getTime()) return null
  return c as TestLock
}

type LockTx = {
  tenantFeatureFlag: {
    upsert: (args: {
      where: { scope_key: { scope: string; key: string } }
      create: { tenantId: string; scope: string; key: string; enabled: boolean; config: Prisma.InputJsonValue }
      update: { tenantId: string }
    }) => Promise<unknown>
    update: (args: { where: { scope_key: { scope: string; key: string } }; data: { config: Prisma.InputJsonValue } }) => Promise<unknown>
  }
  $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}
export type LockDb = { $transaction: <T>(fn: (tx: LockTx) => Promise<T>) => Promise<T> }

async function lockedRow(tx: LockTx, tenantId: string): Promise<unknown> {
  await tx.tenantFeatureFlag.upsert({
    where: { scope_key: { scope: tenantId, key: TEST_SESSION_LOCK_KEY } },
    create: { tenantId, scope: tenantId, key: TEST_SESSION_LOCK_KEY, enabled: false, config: { released: true } },
    update: { tenantId },
  })
  const rows = await tx.$queryRaw<Array<{ config: unknown }>>`
    SELECT config FROM "TenantFeatureFlag" WHERE scope = ${tenantId} AND key = ${TEST_SESSION_LOCK_KEY} FOR UPDATE
  `
  return rows[0]?.config
}

/** Takes the business's test lock, or throws naming the run that holds it. */
export async function acquireTestLock(
  db: LockDb,
  input: { tenantId: string; label: string; cap: number; now?: Date },
): Promise<TestLock> {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const held = activeLock(await lockedRow(tx, input.tenantId), now)
    if (held) {
      throw new Error(
        `Otra prueba está corriendo en este negocio (${held.label}, ${held.host} pid ${held.pid}, desde ${held.startedAt}, hasta ${held.expiresAt} como máximo). Esperá que termine.`,
      )
    }
    const lock: TestLock = {
      token: randomUUID(),
      label: input.label,
      host: hostname(),
      pid: process.pid,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
      cap: input.cap,
    }
    await tx.tenantFeatureFlag.update({
      where: { scope_key: { scope: input.tenantId, key: TEST_SESSION_LOCK_KEY } },
      data: { config: lock as unknown as Prisma.InputJsonValue },
    })
    return lock
  })
}

/** The lock row's config right now (no row lock; for read-only checks). */
export async function readTestLock(db: LockDb, tenantId: string): Promise<unknown> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`
      SELECT config FROM "TenantFeatureFlag" WHERE scope = ${tenantId} AND key = ${TEST_SESSION_LOCK_KEY}
    `
    return rows[0]?.config ?? null
  })
}

/** test-cap --unlock: frees whatever lock is held (a dead run's). Returns the lock it freed, or null. Audited by the caller. */
export async function forceReleaseTestLock(db: LockDb, input: { tenantId: string; now?: Date }): Promise<TestLock | null> {
  return db.$transaction(async (tx) => {
    const held = activeLock(await lockedRow(tx, input.tenantId), input.now ?? new Date())
    if (!held) return null
    await tx.tenantFeatureFlag.update({
      where: { scope_key: { scope: input.tenantId, key: TEST_SESSION_LOCK_KEY } },
      data: { config: { ...held, released: true, releasedAt: new Date().toISOString(), releasedBy: 'test-cap --unlock' } as unknown as Prisma.InputJsonValue },
    })
    return held
  })
}

/** Releases OUR lock only (a lock another run took after ours expired is left alone). True when released. */
export async function releaseTestLock(db: LockDb, input: { tenantId: string; token: string }): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const c = (await lockedRow(tx, input.tenantId)) as Partial<TestLock> | null
    if (!c || c.token !== input.token) return false
    await tx.tenantFeatureFlag.update({
      where: { scope_key: { scope: input.tenantId, key: TEST_SESSION_LOCK_KEY } },
      data: { config: { ...c, released: true, releasedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue },
    })
    return true
  })
}
