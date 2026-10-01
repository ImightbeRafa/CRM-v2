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

/**
 * Lean, briefly cached view of the selected membership for READ-ONLY per-page calls (/api/auth/me,
 * /api/billing/access): one query with only the fields they show, 30 s per process. Anything that
 * changes data or money keeps using getMembershipForToken (fresh every time).
 */
export type MembershipSummary = {
  role: string
  tenantId: string
  tenant: { id: string; name: string }
  user: { id: string; email: string; username: string | null; active: boolean }
}

const summaryCache = new Map<string, { value: MembershipSummary | null; at: number }>()
const SUMMARY_TTL_MS = 30_000

export async function getMembershipSummaryForToken(token: TenantToken | null | undefined): Promise<MembershipSummary | null> {
  const userId = token?.sub
  const tenantId = getSelectedTenantId(token)
  if (!userId || !tenantId) return null
  const key = `${userId}|${tenantId}`
  const hit = summaryCache.get(key)
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return hit.value
  const row = await prisma.membership.findFirst({
    where: { userId, tenantId, isActive: true, user: { active: true }, tenant: { isActive: true } },
    select: {
      role: true,
      tenantId: true,
      tenant: { select: { id: true, name: true } },
      user: { select: { id: true, email: true, username: true, active: true } },
    },
  })
  const value = row ? (row as MembershipSummary) : null
  if (summaryCache.size > 10_000) summaryCache.clear()
  summaryCache.set(key, { value, at: Date.now() })
  return value
}

/** Tests / explicit invalidation (e.g. after a business switch in this process). */
export function forgetMembershipSummary(userId: string): void {
  for (const key of summaryCache.keys()) if (key.startsWith(`${userId}|`)) summaryCache.delete(key)
}
