import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export const ORDER_LIFECYCLE_V2_FLAG = 'order_lifecycle_v2';

function isMissingFeatureFlagTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2021'
    : String((error as { code?: unknown })?.code || '') === '42P01';
}

/**
 * Reads a tenant flag from Postgres on every decision. Missing additive schema
 * is deliberately fail-safe: the feature remains off and the legacy adapter
 * set continues unchanged.
 */
export async function isTenantFeatureEnabled(tenantId: string, key: string): Promise<boolean> {
  try {
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: {
        tenantId,
        scope: 'tenant',
        key,
      },
      select: { enabled: true },
    });
    return flag?.enabled === true;
  } catch (error) {
    if (isMissingFeatureFlagTable(error)) return false;
    throw error;
  }
}

export type OrderLifecycleAdapter =
  | 'ventas'
  | 'website'
  | 'excel'
  | 'orders-update'
  | 'production-status'
  | 'ce-confirmation'
  | 'tenant-guia';

/** One flag controls the complete non-bot adapter set. There is intentionally
 * no per-channel override because partial activation forks business truth. */
export function shouldUseOrderLifecycleV2(tenantId: string, _adapter: OrderLifecycleAdapter) {
  return readLifecycleReadiness(tenantId);
}

async function readLifecycleReadiness(tenantId: string) {
  try {
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: 'tenant', key: ORDER_LIFECYCLE_V2_FLAG },
      select: { enabled: true, config: true },
    });
    const config = flag?.config && typeof flag.config === 'object' && !Array.isArray(flag.config)
      ? flag.config as Record<string, unknown>
      : {};
    // Enabling the switch without recording reconciliation readiness must not
    // create duplicate clients for a legacy tenant.
    return flag?.enabled === true && typeof config.clientBackfillCompletedAt === 'string';
  } catch (error) {
    if (isMissingFeatureFlagTable(error)) return false;
    throw error;
  }
}
