import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export const ORDER_LIFECYCLE_V2_FLAG = 'order_lifecycle_v2';
export const PRODUCTION_SERVER_V2_FLAG = 'production_server_v2';
export const CLIENTS_SERVER_V2_FLAG = 'clients_server_v2';
export const BOT_INBOX_V2_FLAG = 'bot_inbox_v2';
export const BOT_LIFECYCLE_V2_FLAG = 'bot_lifecycle_v2';
export const SOFT_DELETE_RESTORE_V2_FLAG = 'soft_delete_restore_v2';
export const AI_CUSTOMER_PASTE_V2_FLAG = 'ai_customer_paste_v2';
export const SETUP_GUIDE_V2_FLAG = 'setup_guide_v2';
export const STATISTICS_REVENUE_V2_FLAG = 'statistics_revenue_v2';

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
        scope: tenantId,
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

type FeatureFlagConfig = Record<string, unknown>;

export interface TenantFeatureReadiness {
  enabled: boolean;
  config: FeatureFlagConfig;
}

async function readTenantFlag(tenantId: string, key: string): Promise<TenantFeatureReadiness> {
  try {
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key },
      select: { enabled: true, config: true },
    });
    const config = flag?.config && typeof flag.config === 'object' && !Array.isArray(flag.config)
      ? flag.config as FeatureFlagConfig
      : {};
    return { enabled: flag?.enabled === true, config };
  } catch (error) {
    if (isMissingFeatureFlagTable(error)) return { enabled: false, config: {} };
    throw error;
  }
}

export async function readProductionServerReadiness(tenantId: string) {
  const flag = await readTenantFlag(tenantId, PRODUCTION_SERVER_V2_FLAG);
  const mappingRevision = typeof flag.config.terminalMappingRevision === 'string'
    ? flag.config.terminalMappingRevision
    : null;
  return {
    enabled: flag.enabled,
    terminalFilteringEnabled: flag.enabled
      && flag.config.terminalFilteringEnabled === true
      && mappingRevision !== null
      && typeof flag.config.terminalMappingApprovedAt === 'string',
    mappingRevision,
  };
}

export async function readClientsServerReadiness(tenantId: string) {
  const [clientsFlag, lifecycleFlag] = await Promise.all([
    readTenantFlag(tenantId, CLIENTS_SERVER_V2_FLAG),
    readTenantFlag(tenantId, ORDER_LIFECYCLE_V2_FLAG),
  ]);
  const backfillCompletedAt = typeof lifecycleFlag.config.clientBackfillCompletedAt === 'string'
    ? lifecycleFlag.config.clientBackfillCompletedAt
    : null;
  return {
    enabled: clientsFlag.enabled && backfillCompletedAt !== null,
    requested: clientsFlag.enabled,
    backfillCompletedAt,
  };
}

export async function readBotInboxReadiness(tenantId: string) {
  const flag = await readTenantFlag(tenantId, BOT_INBOX_V2_FLAG);
  const configuredSeatMode = flag.config.seatMode;
  const seatMode: 'observe' | 'warn' | 'enforce' = configuredSeatMode === 'enforce' || configuredSeatMode === 'warn'
    ? configuredSeatMode
    : 'observe';
  return {
    enabled: flag.enabled,
    seatMode,
  };
}

export async function shouldUseBotLifecycleV2(tenantId: string) {
  const [lifecycleReady, inbox, botLifecycle] = await Promise.all([
    readLifecycleReadiness(tenantId),
    readTenantFlag(tenantId, BOT_INBOX_V2_FLAG),
    readTenantFlag(tenantId, BOT_LIFECYCLE_V2_FLAG),
  ]);
  return lifecycleReady && inbox.enabled && botLifecycle.enabled;
}

export async function shouldUseSoftDeleteRestoreV2(tenantId: string) {
  return isTenantFeatureEnabled(tenantId, SOFT_DELETE_RESTORE_V2_FLAG);
}

export async function readTenantUiReadiness(tenantId: string) {
  try {
    const flags = await prisma.tenantFeatureFlag.findMany({
      where: {
        tenantId,
        scope: tenantId,
        key: { in: [AI_CUSTOMER_PASTE_V2_FLAG, SETUP_GUIDE_V2_FLAG, STATISTICS_REVENUE_V2_FLAG] },
      },
      select: { key: true, enabled: true, config: true },
    });
    const byKey = new Map(flags.map(flag => [flag.key, flag]));
    const statistics = byKey.get(STATISTICS_REVENUE_V2_FLAG);
    const statisticsConfig = statistics?.config && typeof statistics.config === 'object' && !Array.isArray(statistics.config)
      ? statistics.config as Record<string, unknown>
      : {};
    return {
      aiCustomerPaste: byKey.get(AI_CUSTOMER_PASTE_V2_FLAG)?.enabled === true,
      setupGuide: byKey.get(SETUP_GUIDE_V2_FLAG)?.enabled === true,
      statistics: {
        enabled: statistics?.enabled === true,
        mode: statisticsConfig.mode === 'primary' ? 'primary' as const : 'observe' as const,
      },
    };
  } catch (error) {
    if (isMissingFeatureFlagTable(error)) {
      return {
        aiCustomerPaste: false,
        setupGuide: false,
        statistics: { enabled: false, mode: 'observe' as const },
      };
    }
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
  | 'tenant-guia'
  | 'bot';

/** One flag controls the complete non-bot adapter set. There is intentionally
 * no per-channel override because partial activation forks business truth. */
export function shouldUseOrderLifecycleV2(tenantId: string, _adapter: OrderLifecycleAdapter) {
  return readLifecycleReadiness(tenantId);
}

async function readLifecycleReadiness(tenantId: string) {
  try {
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: ORDER_LIFECYCLE_V2_FLAG },
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
