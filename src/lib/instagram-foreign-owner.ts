import { hasPermission, type Role } from '@/lib/rbac'
import { getSelectedTenantMembership } from '@/lib/selected-tenant'
import type { InstagramForeignOwnerAccess } from '@/lib/instagram-social-account'

/**
 * Builds the resolveForeignOwner callback for an IG connect by `userId`.
 * Transfer needs update_config (OWNER/ADMIN) in the tenant that holds the asset;
 * the workspace name is only revealed to active members of that tenant.
 */
export function instagramForeignOwnerResolver(
  userId: string,
): (foreignTenantId: string) => Promise<InstagramForeignOwnerAccess> {
  return async (foreignTenantId) => {
    const membership = await getSelectedTenantMembership(userId, foreignTenantId)
    if (!membership) return { canTransfer: false }
    return {
      canTransfer: hasPermission(membership.role as Role, 'update_config'),
      workspaceName: membership.tenant?.name ?? null,
    }
  }
}
