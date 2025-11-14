import prismaTenant, { prisma as prismaBase } from './db';
import { TenantError } from './errors';
import { getTenantContext } from './tenantContext';

export const prismaRaw = prismaBase;

export function getTenantPrisma(tenantId: string) {
  if (!tenantId) {
    throw new TenantError('Tenant ID is required for tenant-isolated queries');
  }

  const context = getTenantContext();
  if (context?.tenantId && context.tenantId !== tenantId) {
    console.warn('[Prisma] Tenant context mismatch', {
      contextTenantId: context.tenantId,
      requestedTenantId: tenantId,
    });
  }

  return prismaTenant;
}

export function getTenantIdFromSession(session: any): string {
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    throw new TenantError('Session does not contain tenantId');
  }
  return tenantId;
}

export { prismaTenant as prisma };
