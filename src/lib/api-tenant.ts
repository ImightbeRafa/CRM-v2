import { NextRequest } from 'next/server';
import { prisma as globalPrisma } from '@/lib/db';

type ApiToken = {
  sub?: string | null;
  tenantId?: string | null;
  currentTenant?: { id?: string | null } | null;
};

export async function resolveTenantId(req: NextRequest, token: ApiToken | null): Promise<string | null> {
  const selectedTenantId = req.headers.get('x-tenant-id')
    || (typeof token?.tenantId === 'string' ? token.tenantId : null)
    || (typeof token?.currentTenant?.id === 'string' ? token.currentTenant.id : null);

  if (!token?.sub || !selectedTenantId) return null;

  const membership = await globalPrisma.membership.findFirst({
    where: {
      userId: token.sub,
      tenantId: selectedTenantId,
      isActive: true,
      user: { active: true },
      tenant: { isActive: true },
    },
    select: { tenantId: true },
  });

  return membership?.tenantId ?? null;
}
