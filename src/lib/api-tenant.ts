import { NextRequest } from 'next/server';
import { prisma as globalPrisma } from '@/lib/db';

type ApiToken = {
  sub?: string | null;
  tenantId?: string | null;
  currentTenant?: { id?: string | null } | null;
};

export async function resolveTenantId(req: NextRequest, token: ApiToken | null): Promise<string | null> {
  const headerTenantId = req.headers.get('x-tenant-id');
  if (headerTenantId) return headerTenantId;

  if (typeof token?.tenantId === 'string' && token.tenantId) {
    return token.tenantId;
  }

  if (typeof token?.currentTenant?.id === 'string' && token.currentTenant.id) {
    return token.currentTenant.id;
  }

  if (!token?.sub) return null;

  const user = await globalPrisma.user.findUnique({
    where: { id: token.sub },
    select: {
      memberships: {
        where: { isActive: true },
        select: { tenantId: true },
        take: 1,
      },
    },
  });

  return user?.memberships?.[0]?.tenantId ?? null;
}
