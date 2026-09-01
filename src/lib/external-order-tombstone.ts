import { prisma } from '@/lib/db';

export class ExternalOrderDeletedError extends Error {
  constructor(public readonly orderId: string) {
    super(`External order ${orderId} was previously deleted`);
    this.name = 'ExternalOrderDeletedError';
  }
}

/** Audit entityName variants used by bulk delete, sales delete, and archive. */
export function deletedExternalOrderEntityNames(orderId: string): string[] {
  return [orderId, `Order #${orderId}`, `Sale #${orderId}`];
}

export type DeletedExternalOrderAudit = {
  id: string;
  action: string;
  timestamp: Date;
  reason: string | null;
};

/**
 * Hard-deleted CRM orders are not stored as rows. Staff deletes (mass or
 * sales) still leave an AuditLog snapshot, which we treat as a tombstone so
 * the website intake retry cannot recreate the same storefront orderId as EA.
 */
export async function findDeletedExternalOrderAudit(
  tenantId: string,
  orderId: string,
): Promise<DeletedExternalOrderAudit | null> {
  return prisma.auditLog.findFirst({
    where: {
      tenantId,
      entityType: { in: ['order', 'sale'] },
      action: { in: ['DELETE', 'BULK_DELETE'] },
      OR: [
        { entityName: { in: deletedExternalOrderEntityNames(orderId) } },
        { oldValues: { path: ['orderId'], equals: orderId } },
      ],
    },
    select: { id: true, action: true, timestamp: true, reason: true },
    orderBy: { timestamp: 'desc' },
  });
}
