import crypto from 'crypto'

export const TEAM_INVITE_COOKIE = 'betsy_team_invite'
export const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export type TeamInviteRole = 'ADMIN' | 'MANAGER' | 'SALES' | 'PRODUCTION' | 'VIEWER'

const ALLOWED_ROLES = new Set<TeamInviteRole>([
  'ADMIN',
  'MANAGER',
  'SALES',
  'PRODUCTION',
  'VIEWER',
])

/** Constant-time invite token comparison (a presented link token vs the stored one). */
export function inviteTokenMatches(presented: unknown, actual: string | null | undefined): boolean {
  if (typeof presented !== 'string' || !presented || !actual) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(actual)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Security (2026-09-28): a pending invite is only auto-accepted by someone who proved they own
 * the invited mailbox: they hold the emailed invite token, their email is verified, or the
 * identity provider (Google) verified it. Knowing the address alone is never enough — before
 * this, registering an invited email with any password joined that business with the invited
 * role (pre-hijack).
 */
export function canAutoAcceptInvite(input: { viaToken: boolean; emailVerified: boolean }): boolean {
  return input.viaToken || input.emailVerified
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isAllowedInviteRole(role: string): role is TeamInviteRole {
  return ALLOWED_ROLES.has(role as TeamInviteRole)
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function inviteExpiresAt(now = Date.now()): Date {
  return new Date(now + TEAM_INVITE_TTL_MS)
}

export function isInviteAcceptable(invite: {
  email: string
  expiresAt: Date | string
  acceptedAt?: Date | string | null
  revokedAt?: Date | string | null
}): { ok: true } | { ok: false; reason: 'accepted' | 'revoked' | 'expired' } {
  if (invite.acceptedAt) return { ok: false, reason: 'accepted' }
  if (invite.revokedAt) return { ok: false, reason: 'revoked' }
  const expires = invite.expiresAt instanceof Date ? invite.expiresAt : new Date(invite.expiresAt)
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}

/**
 * Decide whether OAuth/register/sign-in should join an inviting tenant.
 * A pending TenantInvite always wins — even when the user already has other
 * active memberships (e.g. an orphan owned tenant from an earlier Google
 * signup). Never provision another owned tenant while an invite is pending.
 */
export function shouldJoinInviteInsteadOfProvisioning(input: {
  activeMembershipCount: number
  pendingInvite: { tenantId: string; role: string } | null
}): 'join_invite' | 'use_existing' | 'provision_owned' {
  if (input.pendingInvite) return 'join_invite'
  if (input.activeMembershipCount > 0) return 'use_existing'
  return 'provision_owned'
}

export function inviteEmailsMatch(inviteEmail: string, userEmail: string): boolean {
  return normalizeInviteEmail(inviteEmail) === normalizeInviteEmail(userEmail)
}

export function buildInviteAcceptPath(token: string): string {
  return `/auth/accept-invite?token=${encodeURIComponent(token)}`
}
