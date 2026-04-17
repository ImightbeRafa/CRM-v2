import { prisma } from './db';

export async function logIntegrationActivity(
  tenantId: string | null,
  action: string,
  data?: any
): Promise<void> {
  try {
    await prisma.integrationLog.create({
      data: {
        tenantId,
        action,
        data: data === undefined || data === null ? undefined : data,
      },
    });
  } catch (error) {
    console.error('Error logging integration activity:', error);
    // Don't throw - logging should not break the main flow
  }
}

export async function getIntegrationLogs(
  tenantId: string,
  options: {
    limit?: number;
    offset?: number;
    action?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}
) {
  const { limit = 50, offset = 0, action, startDate, endDate } = options;

  const where: any = {
    tenantId,
  };

  if (action) {
    where.action = action;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  return prisma.integrationLog.findMany({
    where,
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
    skip: offset,
  });
}

export async function getIntegrationStats(tenantId: string) {
  const [totalOrders, errorCount, lastOrder, lastError] = await Promise.all([
    prisma.integrationLog.count({
      where: {
        tenantId,
        action: 'ORDER_CREATED',
      },
    }),
    prisma.integrationLog.count({
      where: {
        tenantId,
        action: {
          in: ['VALIDATION_ERROR', 'API_ERROR', 'DUPLICATE_ORDER'],
        },
      },
    }),
    prisma.integrationLog.findFirst({
      where: {
        tenantId,
        action: 'ORDER_CREATED',
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.integrationLog.findFirst({
      where: {
        tenantId,
        action: {
          in: ['VALIDATION_ERROR', 'API_ERROR', 'DUPLICATE_ORDER'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    }),
  ]);

  return {
    totalOrders,
    errorCount,
    lastOrderDate: lastOrder?.createdAt,
    lastErrorDate: lastError?.createdAt,
  };
}
