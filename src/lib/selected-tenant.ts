import type { JWT } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

type TenantToken = Pick<JWT, 'sub'> & {
  tenantId?: string | null;
  currentTenant?: { id?: string | null } | null;
};

/**
 * Return the tenant selected by the authenticated session.
 * Membership fallback is intentionally forbidden here: callers must never
 * silently act on a different tenant when the selected tenant is unavailable.
 */
export function getSelectedTenantId(token: TenantToken | null | undefined): string | null {
  if (typeof token?.tenantId === 'string' && token.tenantId) return token.tenantId;
  const currentTenantId = token?.currentTenant?.id;
  return typeof currentTenantId === 'string' && currentTenantId ? currentTenantId : null;
}

/** Verify that a user has an active membership in the selected tenant. */
export async function getSelectedTenantMembership(
  userId: string | null | undefined,
  tenantId: string | null | undefined,
) {
  if (!userId || !tenantId) return null;

  return prisma.membership.findFirst({
    where: {
      userId,
      tenantId,
      isActive: true,
      user: { active: true },
      tenant: { isActive: true },
    },
    include: { tenant: true, user: true },
  });
}

export async function getMembershipForToken(token: TenantToken | null | undefined) {
  return getSelectedTenantMembership(token?.sub, getSelectedTenantId(token));
}
