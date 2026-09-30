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
