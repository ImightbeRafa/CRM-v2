/**
 * Who may change whose role / membership in a business (security AUTH-23, 2026-09-29).
 *
 * Before: anyone with `manage_users` (ADMIN) could make themselves OWNER, demote or remove the OWNER
 * and take the business over. Rules now:
 * - roles must be real MemberRole values;
 * - only an OWNER may grant OWNER, or change / deactivate / remove an OWNER;
 * - nobody changes their own role or removes themselves here (no accidental lock-out, no
 *   self-promotion);
 * - the last active OWNER can never be demoted or removed.
 */
export const MEMBER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SALES', 'PRODUCTION', 'VIEWER'] as const

export type MemberChange = {
  actorUserId: string
  actorRole: string
  targetUserId: string
  targetRole: string
  targetActive: boolean
  newRole?: string | null
  /** true = deactivate / remove from the business */
  remove?: boolean
  /** true = turn an inactive membership back on */
  reactivate?: boolean
  /** active OWNER memberships in the business right now (including the target) */
  activeOwnerCount: number
}

export type GuardResult = { ok: true } | { ok: false; error: string; status: number }

export function checkMemberChange(c: MemberChange): GuardResult {
  const roleChanges = c.newRole != null && c.newRole !== c.targetRole
  if (c.newRole != null && !(MEMBER_ROLES as readonly string[]).includes(c.newRole)) {
    return { ok: false, error: 'Rol inválido', status: 400 }
  }
  const reactivates = Boolean(c.reactivate) && !c.targetActive
  if (!roleChanges && !c.remove && !reactivates) return { ok: true }

  if (c.actorUserId === c.targetUserId) {
    return { ok: false, error: 'No puedes cambiar tu propio rol ni removerte a ti mismo.', status: 403 }
  }
  // Reactivating a removed Owner makes them an Owner again (AUTH-25): Owner-only too.
  const touchesOwner = c.targetRole === 'OWNER' || c.newRole === 'OWNER'
  if (touchesOwner && c.actorRole !== 'OWNER') {
    return { ok: false, error: 'Solo un Owner puede asignar o cambiar el rol Owner.', status: 403 }
  }
  const ownerLeaves = c.targetRole === 'OWNER' && c.targetActive && (c.remove || (roleChanges && c.newRole !== 'OWNER'))
  if (ownerLeaves && c.activeOwnerCount <= 1) {
    return { ok: false, error: 'El negocio necesita al menos un Owner activo.', status: 409 }
  }
  return { ok: true }
}
