/**
 * Session revocation (security, 2026-09-28).
 *
 * JWT sessions live up to 24 h and API requests use the middleware's signed context (no DB read),
 * so a password reset or a deactivation used to leave existing sessions working. Now:
 * - `User.sessionVersion` (migration 034) is copied into the JWT at sign-in (`token.sv`) and into
 *   the signed middleware context; a password reset bumps it.
 * - `authenticateAPI` checks (active, sessionVersion) for the signed fast path, cached 60 s per
 *   process, and the JWT refresh (every 5 min) clears revoked tokens.
 *
 * Deploy-order safe: until 034 is applied the column is missing, every user reads as version 0 and
 * a bump is a no-op, so nothing changes and nobody is logged out. A token without `sv` counts as 0
 * (= the column default), so the deploy itself logs nobody out either.
 */
import 'server-only'
import { prisma } from '@/lib/db'

export type UserAuthState = { active: boolean; sessionVersion: number }

const CACHE_TTL_MS = 60_000
const CACHE_MAX = 5_000
const cache = new Map<string, { state: UserAuthState | null; at: number }>()
let columnMissingUntil = 0

function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string }
  const code = e?.meta?.code || e?.code
  const message = String(e?.message || '')
  return code === '42703' || (/sessionVersion/.test(message) && /does not exist|column/i.test(message))
}

/** null = no such user. Throws only on database errors other than the missing column. */
export async function loadUserAuthState(userId: string): Promise<UserAuthState | null> {
  if (Date.now() >= columnMissingUntil) {
    try {
      const rows = await prisma.$queryRaw<Array<{ active: boolean; sessionVersion: number }>>`
        SELECT active, "sessionVersion" FROM "User" WHERE id = ${userId} LIMIT 1`
      if (!rows.length) return null
      return { active: rows[0].active !== false, sessionVersion: Number(rows[0].sessionVersion) || 0 }
    } catch (error) {
      if (!isMissingColumn(error)) throw error
      columnMissingUntil = Date.now() + 5 * 60_000 // pre-034: stop asking for a while
    }
  }
  const rows = await prisma.$queryRaw<Array<{ active: boolean }>>`
    SELECT active FROM "User" WHERE id = ${userId} LIMIT 1`
  return rows.length ? { active: rows[0].active !== false, sessionVersion: 0 } : null
}

export function sessionMatches(state: UserAuthState | null, tokenVersion: number | null | undefined): boolean {
  if (!state || !state.active) return false
  return state.sessionVersion === (Number(tokenVersion) || 0)
}

/**
 * Signed fast path check. Database trouble fails OPEN (the request's own queries would fail
 * anyway; an auth-state hiccup must not log the whole team out).
 */
export async function sessionStillValid(userId: string, tokenVersion: number | null | undefined): Promise<boolean> {
  const now = Date.now()
  const hit = cache.get(userId)
  let state: UserAuthState | null
  if (hit && now - hit.at < CACHE_TTL_MS) {
    state = hit.state
  } else {
    try {
      state = await loadUserAuthState(userId)
    } catch (error) {
      console.warn('[session] auth state lookup failed; allowing', error instanceof Error ? error.message : error)
      return true
    }
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(userId, { state, at: now })
  }
  return sessionMatches(state, tokenVersion)
}

/** Ends every existing session of the user (password reset, "sign out everywhere"). */
export async function revokeUserSessions(userId: string): Promise<void> {
  cache.delete(userId)
  try {
    await prisma.$executeRaw`
      UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1, "passwordChangedAt" = NOW() WHERE id = ${userId}`
  } catch (error) {
    if (!isMissingColumn(error)) throw error
    // pre-034: nothing to bump
  }
}

/** Tests only. */
export function __resetSessionRevocationForTests() {
  cache.clear()
  columnMissingUntil = 0
}
