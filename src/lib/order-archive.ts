import { Prisma } from '@prisma/client';
import { prismaRaw } from '@/lib/db';

export const ORDER_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60_000;

export function getOrderRestoreEligibility(deletedAt: Date, now = new Date()) {
  const expiresAt = new Date(deletedAt.getTime() + ORDER_RESTORE_WINDOW_MS);
  return { eligible: expiresAt.getTime() >= now.getTime(), expiresAt };
}

export class OrderArchiveError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'OrderArchiveError';
  }
}

function parseExactDate(value: string | Date | undefined, field: string) {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new OrderArchiveError('INVALID_ARCHIVE_VERSION', `${field} is invalid`, 400);
  }
  return parsed;
}

function isOrderAuditEntity(value: string) {
  return ['order', 'orders', 'sale', 'sales'].includes(value.trim().toLowerCase());
}

export async function archiveOrder(input: {
  tenantId: string;
  orderId: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  reason?: string;
  source: 'sales-delete' | 'bulk-delete';
  expectedUpdatedAt?: string | Date;
}) {
  const expectedUpdatedAt = parseExactDate(input.expectedUpdatedAt, 'expectedUpdatedAt');

  return prismaRaw.$transaction(async tx => {
    const existing = await tx.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId },
    });
    if (!existing) {
      throw new OrderArchiveError('ORDER_NOT_FOUND', 'Order not found', 404);
    }
    if (existing.deletedAt) {
      return { order: existing, alreadyArchived: true };
    }

    const deletedAt = new Date();
    const baseArchiveMetadata = {
      version: 1,
      source: input.source,
      actorRole: input.actorRole,
      archivedAt: deletedAt.toISOString(),
      priorUpdatedAt: existing.updatedAt.toISOString(),
    };
    const updated = await tx.order.updateMany({
      where: {
        id: input.orderId,
        tenantId: input.tenantId,
        deletedAt: null,
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
      },
      data: {
        deletedAt,
        deletedBy: input.actorUserId,
        deleteReason: input.reason?.trim().slice(0, 2000) || null,
        archiveMetadata: baseArchiveMetadata,
      },
    });
    if (updated.count !== 1) {
      throw new OrderArchiveError(
        'ORDER_ARCHIVE_CONFLICT',
        'Order changed before it could be archived',
        409,
      );
    }

    const auditLog = await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        action: input.source === 'bulk-delete' ? 'BULK_DELETE' : 'DELETE',
        entityType: 'order',
        entityId: existing.id,
        entityName: `Order #${existing.orderId}`,
        reason: input.reason?.trim().slice(0, 2000) || 'Archived order',
        oldValues: {
          id: existing.id,
          orderId: existing.orderId,
          status: existing.status,
          total: existing.total,
          timestamp: existing.timestamp.toISOString(),
        },
        newValues: {
          deletedAt: deletedAt.toISOString(),
          sideEffectsReplayed: false,
        },
        userId: input.actorUserId,
        userName: input.actorName,
        userRole: input.actorRole,
      },
    });

    // Bind this archive version to this exact audit event. That prevents an
    // older delete log for the same retained row from restoring a newer
    // archive version. Failure rolls the whole transaction back.
    const bound = await tx.order.updateMany({
      where: {
        id: input.orderId,
        tenantId: input.tenantId,
        deletedAt,
      },
      data: {
        archiveMetadata: {
          ...baseArchiveMetadata,
          archiveAuditLogId: auditLog.id,
        },
      },
    });
    if (bound.count !== 1) {
      throw new OrderArchiveError(
        'ORDER_ARCHIVE_CONFLICT',
        'Order changed before its archive event could be recorded',
        409,
      );
    }

    const archived = await tx.order.findFirstOrThrow({
      where: { id: input.orderId, tenantId: input.tenantId },
    });
    return { order: archived, auditLogId: auditLog.id, alreadyArchived: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function restoreOrderFromAudit(input: {
  tenantId: string;
  auditLogId: string;
  actorUserId: string;
  actorName: string;
  actorRole: 'OWNER';
  expectedDeletedAt: string | Date;
}) {
  const expectedDeletedAt = parseExactDate(input.expectedDeletedAt, 'expectedDeletedAt');
  if (!expectedDeletedAt) {
    throw new OrderArchiveError(
      'ARCHIVE_VERSION_REQUIRED',
      'expectedDeletedAt is required',
      400,
    );
  }

  return prismaRaw.$transaction(async tx => {
    const auditLog = await tx.auditLog.findFirst({
      where: {
        id: input.auditLogId,
        tenantId: input.tenantId,
        action: { in: ['DELETE', 'BULK_DELETE'] },
      },
    });
    if (!auditLog || !isOrderAuditEntity(auditLog.entityType)) {
      throw new OrderArchiveError('RESTORE_AUDIT_NOT_FOUND', 'Restorable audit entry not found', 404);
    }

    // The audit row identifies the retained record only. No field is rebuilt
    // from oldValues/newValues, and no related business table is touched.
    const order = await tx.order.findFirst({
      where: { id: auditLog.entityId, tenantId: input.tenantId },
    });
    if (!order) {
      throw new OrderArchiveError(
        'LEGACY_HARD_DELETE_NOT_RESTORABLE',
        'This order was hard-deleted and cannot be safely reconstructed',
        409,
      );
    }
    if (!order.deletedAt) {
      throw new OrderArchiveError('ORDER_ALREADY_ACTIVE', 'Order is already active', 409);
    }
    const archiveMetadata = order.archiveMetadata;
    const archiveAuditLogId =
      archiveMetadata &&
      typeof archiveMetadata === 'object' &&
      !Array.isArray(archiveMetadata) &&
      'archiveAuditLogId' in archiveMetadata
        ? archiveMetadata.archiveAuditLogId
        : undefined;
    if (archiveAuditLogId !== auditLog.id) {
      throw new OrderArchiveError(
        'RESTORE_AUDIT_VERSION_MISMATCH',
        'This audit entry does not match the current archive version',
        409,
      );
    }
    if (order.deletedAt.getTime() !== expectedDeletedAt.getTime()) {
      throw new OrderArchiveError(
        'ORDER_RESTORE_CONFLICT',
        'The archived order changed before restore',
        409,
      );
    }
    if (!getOrderRestoreEligibility(order.deletedAt).eligible) {
      throw new OrderArchiveError('RESTORE_WINDOW_EXPIRED', 'The 30-day restore window expired', 410);
    }

    const restoredAt = new Date();
    const updated = await tx.order.updateMany({
      where: {
        id: order.id,
        tenantId: input.tenantId,
        deletedAt: expectedDeletedAt,
      },
      data: {
        deletedAt: null,
        archiveMetadata: {
          version: 1,
          lastArchivedAt: expectedDeletedAt.toISOString(),
          lastDeletedBy: order.deletedBy,
          lastDeleteReason: order.deleteReason,
          restoredAt: restoredAt.toISOString(),
          restoredBy: input.actorUserId,
          restoreAuditLogId: auditLog.id,
        },
      },
    });
    if (updated.count !== 1) {
      throw new OrderArchiveError(
        'ORDER_RESTORE_CONFLICT',
        'The archived order changed before restore',
        409,
      );
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        action: 'UPDATE',
        entityType: 'order',
        entityId: order.id,
        entityName: `Order #${order.orderId}`,
        reason: 'Restored archived order without replaying side effects',
        oldValues: { deletedAt: expectedDeletedAt.toISOString() },
        newValues: {
          deletedAt: null,
          restoredAt: restoredAt.toISOString(),
          sourceAuditLogId: auditLog.id,
          sideEffectsReplayed: false,
        },
        userId: input.actorUserId,
        userName: input.actorName,
        userRole: input.actorRole,
      },
    });

    return {
      orderId: order.id,
      publicOrderId: order.orderId,
      restoredAt,
      sourceAuditLogId: auditLog.id,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
