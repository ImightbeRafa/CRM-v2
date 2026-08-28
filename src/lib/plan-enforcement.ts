import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export interface PlanCheck {
  allowed: boolean;
  needsUpgrade: boolean;
  message: string;
  currentPlan: string;
  currentCount: number;
  limit: number;
}

const planLimits = {
  users: { FREE: 1, BASIC: 5, PRO: 25, ENTERPRISE: 999999 },
};

export async function getTenantSeatUsageWithClient(client: Prisma.TransactionClient, tenantId: string) {
  const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
  if (!tenant) return { plan: 'FREE', members: 0, countedBotSessions: 0, grandfatheredBotSessions: 0, currentCount: 0, totalWithGrandfathered: 0, limit: 0 };
  const plan = tenant.plan as keyof typeof planLimits.users;
  const limit = planLimits.users[plan] ?? 1;
  const [members, countedBotSessions, grandfatheredBotSessions] = await Promise.all([
    client.membership.count({ where: { tenantId, isActive: true } }),
    client.botSession.count({
      where: { tenantId, isActive: true, userId: null, seatPolicy: 'COUNTED' },
    }),
    client.botSession.count({
      where: {
        tenantId,
        isActive: true,
        userId: null,
        OR: [{ seatPolicy: null }, { seatPolicy: 'GRANDFATHERED' }],
      },
    }),
  ]);
  const currentCount = members + countedBotSessions;
  return {
    plan,
    members,
    countedBotSessions,
    grandfatheredBotSessions,
    currentCount,
    totalWithGrandfathered: currentCount + grandfatheredBotSessions,
    limit,
  };
}

export async function getTenantSeatUsage(tenantId: string) {
  return getTenantSeatUsageWithClient(prisma as unknown as Prisma.TransactionClient, tenantId);
}

/**
 * Check if tenant can add more users
 */
export async function checkUserLimit(tenantId: string): Promise<PlanCheck> {
  const usage = await getTenantSeatUsage(tenantId);
  if (usage.limit === 0) {
    return {
      allowed: false,
      needsUpgrade: false,
      message: 'Tenant not found',
      currentPlan: 'FREE',
      currentCount: 0,
      limit: 0
    };
  }

  const { plan, limit, currentCount } = usage;
  const allowed = currentCount < limit;

  return {
    allowed,
    needsUpgrade: !allowed,
    message: allowed
      ? 'OK'
      : `Límite de usuarios alcanzado (${currentCount}/${limit}). Actualiza tu plan para agregar más usuarios.`,
    currentPlan: plan,
    currentCount,
    limit
  };
}

/**
 * Check if tenant subscription is active
 * Returns soft warning for past_due/pending, hard block for canceled/expired
 */
export async function checkSubscriptionStatus(tenantId: string): Promise<{
  active: boolean;
  status: string;
  warning: string | null;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true }
  });

  if (!tenant) {
    return { active: false, status: 'unknown', warning: 'Tenant not found' };
  }

  const status = 'active'; // Default to active since subscriptionStatus field doesn't exist

  // Hard block: subscription is truly dead
  if (['canceled', 'expired'].includes(status)) {
    return {
      active: false,
      status,
      warning: 'Tu suscripción ha expirado. Por favor, renueva para continuar.'
    };
  }

  // Soft warning: payment pending but still functional (grace period)
  if (['past_due', 'pending', 'incomplete'].includes(status)) {
    return {
      active: true,
      status,
      warning: 'Tu pago está pendiente. Por favor, actualiza tu método de pago para evitar interrupciones.'
    };
  }

  // All good
  return { active: true, status, warning: null };
}

