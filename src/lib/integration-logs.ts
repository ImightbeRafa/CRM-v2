import { prisma } from './db';

const PII_KEYS = new Set([
  'email',
  'phone',
  'telefono',
  'teléfono',
  'address',
  'direccion',
  'dirección',
  'customername',
  'name',
  'nombre',
  'cedula',
  'cédula',
  'idnumber',
  'password',
  'token',
  'apikey',
  'api_key',
  'authorization',
]);

/** Redact PII fields before persisting integration logs. */
export function redactIntegrationLogData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(redactIntegrationLogData);
  if (typeof data !== 'object') return data;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[\s_-]/g, '');
    if (PII_KEYS.has(normalized) || PII_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else if (key === 'body' && value && typeof value === 'object') {
      // Validation errors previously logged the full request body
      out[key] = redactIntegrationLogData(value);
    } else if (value && typeof value === 'object') {
      out[key] = redactIntegrationLogData(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

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
        data:
          data === undefined || data === null
            ? undefined
            : (redactIntegrationLogData(data) as any),
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
