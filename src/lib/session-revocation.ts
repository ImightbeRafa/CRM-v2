/**
 * Session revocation (security, 2026-09-28; membership check 2026-09-29).
 *
 * JWT sessions live up to 24 h and API requests use the middleware's signed context (no DB read),
 * so a password reset, a deactivation, a removal from the team or a role downgrade used to leave
 * existing sessions working. Now, on every API request (cached 60 s per process):
 * - `User.active` must be true and `User.sessionVersion` (migration 034) must equal the version the
 *   session was issued with (`token.sv`); a password reset bumps it.
 * - The session's business must still be an active membership, and the session's role must not
 *   grant anything the current membership role does not (a promotion is fine until the next
 *   refresh; a downgrade or removal ends the session). Works without 034.
 * The JWT refresh (every 5 min) clears revoked tokens so the browser goes back to the login.
 *
 * Deploy-order safe: until 034 is applied the column is missing, every user reads as version 0 and
 * a bump is a no-op. A token without `sv` counts as 0 (= the column default), so the deploy itself
 * logs nobody out.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { rolePermissions, type Role } from '@/lib/rbac'

export type UserAuthState = { active: boolean; sessionVersion: number }
type MembershipState = { active: boolean; role: string } | null

const CACHE_TTL_MS = 60_000
const CACHE_MAX = 5_000
const MISSING_COLUMN_RECHECK_MS = 60_000
const userCache = new Map<string, { state: UserAuthState | null; at: number }>()
const memberCache = new Map<string, { state: MembershipState; at: number }>()
let columnMissingUntil = 0

export function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string }
  const code = e?.meta?.code || e?.code
  const message = String(e?.message || '')
  return code === '42703' || (/sessionVersion|passwordChangedAt/.test(message) && /does not exist|column/i.test(message))
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
      columnMissingUntil = Date.now() + MISSING_COLUMN_RECHECK_MS // pre-034: stop asking for a minute
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

/** True when `current` grants at least everything `claimed` grants (same role, or a promotion). */
export function roleCovers(current: string, claimed: string): boolean {
  if (current === claimed) return true
  // VIEWER is also middleware's fallback when a token has no role for the business; it is
  // read-only, and the membership itself is still checked above.
  if (claimed === 'VIEWER') return true
  const have = rolePermissions[current as Role]
  const want = rolePermissions[claimed as Role]
  if (!have || !want) return false
  return want.every((p) => have.includes(p))
}

export function membershipAllows(state: MembershipState, claimedRole: string | null | undefined): boolean {
  if (!state || !state.active) return false
  return claimedRole ? roleCovers(state.role, claimedRole) : true
}

async function loadMembership(userId: string, tenantId: string): Promise<MembershipState> {
  // Membership only: what an inactive / unpaid business may do is billing-access's job, not ours.
  const rows = await prisma.$queryRaw<Array<{ isActive: boolean; role: string }>>`
    SELECT m."isActive", m.role::text AS role
    FROM "Membership" m
    WHERE m."userId" = ${userId} AND m."tenantId" = ${tenantId}
    LIMIT 1`
  if (!rows.length) return null
  return { active: rows[0].isActive === true, role: rows[0].role }
}

function remember<T>(map: Map<string, { state: T; at: number }>, key: string, state: T, now: number) {
  if (map.size >= CACHE_MAX) map.clear()
  map.set(key, { state, at: now })
}

/**
 * The signed fast path (and cookie-only routes) check. Database trouble fails OPEN (the request's
 * own queries would fail anyway; an auth-state hiccup must not log the whole team out).
 * `scope` adds the membership check for the session's business and role.
 */
export async function sessionStillValid(
  userId: string,
  tokenVersion: number | null | undefined,
  scope?: { tenantId?: string | null; role?: string | null },
): Promise<boolean> {
  const now = Date.now()
  try {
    const hit = userCache.get(userId)
    let state: UserAuthState | null
    if (hit && now - hit.at < CACHE_TTL_MS) {
      state = hit.state
    } else {
      state = await loadUserAuthState(userId)
      remember(userCache, userId, state, now)
    }
    if (!sessionMatches(state, tokenVersion)) return false

    if (scope?.tenantId) {
      const key = `${userId}|${scope.tenantId}`
      const mhit = memberCache.get(key)
      let membership: MembershipState
      if (mhit && now - mhit.at < CACHE_TTL_MS) {
        membership = mhit.state
      } else {
        membership = await loadMembership(userId, scope.tenantId)
        remember(memberCache, key, membership, now)
      }
      if (!membershipAllows(membership, scope.role)) return false
    }
    return true
  } catch (error) {
    console.warn('[session] auth state lookup failed; allowing', error instanceof Error ? error.message : error)
    return true
  }
}

/** Drops this process's cached state for the user (call AFTER the change is written). */
export function forgetUserAuthState(userId: string): void {
  userCache.delete(userId)
  for (const key of memberCache.keys()) if (key.startsWith(`${userId}|`)) memberCache.delete(key)
}

/** Ends every existing session of the user (Google first proof, "sign out everywhere"). */
export async function revokeUserSessions(userId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE id = ${userId}`
  } catch (error) {
    if (!isMissingColumn(error)) throw error
    // pre-034: nothing to bump
  }
  // After the write, so a concurrent request cannot re-cache the old version (SecureDog L7).
  forgetUserAuthState(userId)
}

/** Tests only. */
export function __resetSessionRevocationForTests() {
  userCache.clear()
  memberCache.clear()
  columnMissingUntil = 0
}
