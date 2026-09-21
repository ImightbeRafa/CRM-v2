/**
 * Client-safe session permission helpers.
 *
 * IMPORTANT: Keep this module free of Prisma / next-auth server imports.
 * Client Components (e.g. /config/agentes, /config/social) may import it.
 * Server auth lives in auth-helpers.ts (server-only).
 */

import { Permission, Role, hasPermission } from './rbac'

/**
 * Check if current user has permission (for client components).
 * Use with session from useSession().
 */
export function hasSessionPermission(session: any, permission: Permission): boolean {
  if (!session?.user) return false

  const role = session.user.membershipRole || session.user.role || 'VIEWER'
  return hasPermission(role as Role, permission)
}

/** Get user's role from session (helper). */
export function getSessionRole(session: any): Role {
  if (!session?.user) return 'VIEWER'
  return (session.user.membershipRole || session.user.role || 'VIEWER') as Role
}

/** Get user's tenant ID from session (helper). */
export function getSessionTenantId(session: any): string | null {
  return session?.user?.tenantId || null
}
