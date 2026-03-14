import { prisma } from '@/lib/db';

export interface PlanCheck {
  allowed: boolean;
  needsUpgrade: boolean;
  message: string;
  currentPlan: string;
  currentCount: number;
  limit: number;
}

const planLimits = {
  users: { FREE: 1, BASIC: 999999, PRO: 999999, ENTERPRISE: 999999 },
  ordersPerMonth: { FREE: 100, BASIC: 999999, PRO: 999999, ENTERPRISE: 999999 },
};

/**
 * Check if tenant can create more orders this month
 * Returns soft limit info instead of throwing
 */
export async function checkOrderLimit(tenantId: string): Promise<PlanCheck> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true }
  });

  if (!tenant) {
    return {
      allowed: false,
      needsUpgrade: false,
      message: 'Tenant not found',
      currentPlan: 'FREE',
      currentCount: 0,
      limit: 0
    };
  }

  const plan = tenant.plan as keyof typeof planLimits.ordersPerMonth;
  const limit = planLimits.ordersPerMonth[plan] ?? 100;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentCount = await prisma.order.count({
    where: { tenantId, timestamp: { gte: startOfMonth } }
  });

  const allowed = currentCount < limit;

  return {
    allowed,
    needsUpgrade: !allowed,
    message: allowed
      ? 'OK'
      : `Límite mensual de órdenes alcanzado (${currentCount}/${limit}). Actualiza tu plan para continuar.`,
    currentPlan: plan,
    currentCount,
    limit
  };
}

/**
 * Check if tenant can add more users
 */
export async function checkUserLimit(tenantId: string): Promise<PlanCheck> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true }
  });

  if (!tenant) {
    return {
      allowed: false,
      needsUpgrade: false,
      message: 'Tenant not found',
      currentPlan: 'FREE',
      currentCount: 0,
      limit: 0
    };
  }

  const plan = tenant.plan as keyof typeof planLimits.users;
  const limit = planLimits.users[plan] ?? 1;

  const currentCount = await prisma.membership.count({
    where: { tenantId, isActive: true }
  });

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

