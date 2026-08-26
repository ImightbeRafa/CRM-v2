import { prisma } from '@/lib/db'
import { prismaRaw } from '@/lib/prisma-tenant'
import { getToken } from 'next-auth/jwt'
import { NextRequest } from 'next/server'
import { getSelectedTenantId } from './selected-tenant'
import {
  normalizeEntityType,
  pickSnapshot,
  sanitizeAuditPayload,
} from './auditPayload'

import { AuditAction as PrismaAuditAction } from '@prisma/client';

// Define our extended audit action type that includes custom actions
type ExtendedAuditAction = PrismaAuditAction | 'SECURITY_WARNING' | 'TENANT_ERROR';

// Type guard to check if an action is a valid Prisma audit action
function isPrismaAuditAction(action: string): action is PrismaAuditAction {
  const validActions: string[] = Object.values(PrismaAuditAction);
  return validActions.includes(action);
}

function resolveDescription(data: AuditLogData & { reason?: string | null }): string | null {
  return data.description || data.reason || null
}

function prepareJsonPayload(value: unknown): unknown | null {
  if (value === undefined || value === null) return null
  return sanitizeAuditPayload(JSON.parse(JSON.stringify(value)))
}

function mergeDetailsIntoNewValues(
  newValues: unknown | null | undefined,
  details: unknown | null | undefined,
  action: string
): unknown | null {
  const hasDetails = details !== undefined && details !== null
  let base: Record<string, unknown> | null = null

  if (newValues && typeof newValues === 'object' && !Array.isArray(newValues)) {
    base = { ...(newValues as Record<string, unknown>) }
  } else if (hasDetails && typeof details === 'object' && details !== null && !Array.isArray(details)) {
    const d = details as Record<string, unknown>
    // Promote mutation `data` (or result snapshot) to primary content when writers only send details
    if (d.data && typeof d.data === 'object') {
      base = { ...(sanitizeAuditPayload(d.data) as Record<string, unknown>) }
    } else if (d.result && typeof d.result === 'object') {
      base = { ...(sanitizeAuditPayload(d.result) as Record<string, unknown>) }
    } else {
      base = {}
    }
  } else if (newValues !== undefined && newValues !== null) {
    return sanitizeAuditPayload(newValues)
  } else {
    return null
  }

  if (hasDetails && base) {
    base._meta = {
      ...(typeof details === 'object' && details !== null && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : { details }),
      originalAction: action,
    }
  }

  return base ? sanitizeAuditPayload(base) : null
}

// === Circuit breaker to prevent cascading failures during connection exhaustion ===
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;   // Trip after 3 consecutive failures
const CIRCUIT_BREAKER_RESET_MS = 30000; // Auto-recover after 30s

function isCircuitOpen(): boolean {
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (Date.now() < circuitOpenUntil) {
      return true; // Circuit still open
    }
    // Reset after cooldown
    consecutiveFailures = 0;
  }
  return false;
}

function recordAuditSuccess(): void {
  consecutiveFailures = 0;
}

function recordAuditFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    console.warn(`[AuditLogger] ⚡ Circuit breaker OPEN — skipping audit logs for ${CIRCUIT_BREAKER_RESET_MS / 1000}s after ${consecutiveFailures} consecutive failures`);
  }
}

// === User existence cache to avoid repeated findUnique queries ===
const userExistsCache = new Map<string, { exists: boolean; expiry: number }>();
const USER_CACHE_TTL_MS = 300000; // 5 minutes

async function checkUserExists(userId: string): Promise<boolean> {
  const cached = userExistsCache.get(userId);
  if (cached && Date.now() < cached.expiry) {
    return cached.exists;
  }
  try {
    const user = await prismaRaw.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    const exists = !!user;
    userExistsCache.set(userId, { exists, expiry: Date.now() + USER_CACHE_TTL_MS });
    return exists;
  } catch (err) {
    console.warn('[AuditLogger] Failed to verify user exists:', err);
    return false;
  }
}

export interface AuditLogData {
  action: ExtendedAuditAction;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  description?: string | null;
  /** Alias accepted by callers; persisted as AuditLog.reason */
  reason?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  details?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId?: string | null;  // Optional for bot/system operations
  userName?: string | null;
  userRole: string;
  tenantId: string;
}

export async function logAuditEvent(data: AuditLogData): Promise<void> {
  // Circuit breaker: skip audit logging during connection exhaustion
  if (isCircuitOpen()) return;

  try {
    // Use cached user existence check instead of hitting DB every time
    const userExists = data.userId ? await checkUserExists(data.userId) : false;

    // Ensure the action is a valid Prisma audit action
    const action: PrismaAuditAction = isPrismaAuditAction(data.action)
      ? data.action
      : 'CREATE';

    const entityType = normalizeEntityType(data.entityType)
    const oldValues = prepareJsonPayload(data.oldValues)
    const newValues = mergeDetailsIntoNewValues(
      data.newValues ? JSON.parse(JSON.stringify(data.newValues)) : null,
      data.details,
      String(data.action)
    )

    // Prepare the log data - userId is now optional
    const logData: any = {
      action,
      entityType,
      entityId: data.entityId,
      entityName: data.entityName || null,
      reason: resolveDescription(data),
      oldValues,
      newValues,
      userName: data.userName || 'System',
      userRole: data.userRole,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      tenant: {
        connect: { id: data.tenantId }
      }
    };

    // Only add user relation if user exists (use connect, NOT direct userId field)
    if (userExists && data.userId) {
      logData.user = {
        connect: { id: data.userId }
      };
    }

    // Create the audit log using raw client to bypass tenant middleware
    await prismaRaw.auditLog.create({
      data: logData
    });

    recordAuditSuccess();
    if (!userExists) {
      console.log(`[AuditLogger] ⚠️  Audit log created without user reference: ${data.action} on ${data.entityType} by ${data.userName || 'System'}`);
    }
  } catch (error) {
    recordAuditFailure();
    console.error('[AuditLogger] ❌ Failed to log audit event:', error);
    // Don't throw error to avoid breaking the main operation
  }
}

export async function getAuditContext(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })

    if (!token) {
      console.warn('⚠️ No token found for audit context');
      return null
    }

    const selectedTenantId = getSelectedTenantId(token)
    if (!token.sub || !selectedTenantId) return null

    // Resolve only the membership selected by the authenticated session.
    const membership = await prismaRaw.membership.findFirst({
      where: {
        userId: token.sub,
        tenantId: selectedTenantId,
        isActive: true,
        user: { active: true },
        tenant: { isActive: true },
      },
      select: {
        role: true,
        tenantId: true,
        user: { select: { id: true, username: true } },
      }
    })

    if (!membership) {
      console.warn('⚠️ User not found or no active memberships for audit context');
      return null
    }

    // Map the new role system to audit log format
    const role = membership.role
    const userRole = (role === 'OWNER' || role === 'ADMIN') ? 'MASTER' : 'REGULAR'
    const tenantId = membership.tenantId

    return {
      userId: membership.user.id,
      userName: membership.user.username || 'Unknown',
      userRole: userRole as 'MASTER' | 'REGULAR',
      tenantId: tenantId,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown'
    }
  } catch (error) {
    console.error('❌ Failed to get audit context:', error)
    return null
  }
}

export async function logApiAction(
  request: NextRequest,
  action: AuditLogData['action'],
  entityType: string,
  entityId: string,
  entityName?: string,
  oldValues?: any,
  newValues?: any,
  reason?: string
) {
  const context = await getAuditContext(request)

  // Only log if we have a valid user context
  if (!context) {
    console.warn(`⚠️ Skipping audit log for ${action} on ${entityType} - no context`);
    return
  }

  await logAuditEvent({
    action,
    entityType,
    entityId,
    entityName,
    oldValues,
    newValues,
    description: reason || undefined,
    reason,
    userId: context.userId,
    userName: context.userName,
    userRole: context.userRole,
    tenantId: context.tenantId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  } as any)
}

// Helper functions for common audit scenarios
export async function logCreate(request: NextRequest, entityType: string, entityId: string, entityName: string, newValues: any) {
  await logApiAction(request, 'CREATE', entityType, entityId, entityName, undefined, newValues)
}

export async function logUpdate(request: NextRequest, entityType: string, entityId: string, entityName: string, oldValues: any, newValues: any) {
  await logApiAction(request, 'UPDATE', entityType, entityId, entityName, oldValues, newValues)
}

export async function logDelete(request: NextRequest, entityType: string, entityId: string, entityName: string, oldValues: any, reason?: string) {
  await logApiAction(request, 'DELETE', entityType, entityId, entityName, oldValues, undefined, reason)
}

export async function logBulkDelete(
  request: NextRequest,
  entityType: string,
  entityIds: string[],
  entityNames: string[],
  reason?: string,
  snapshotsById?: Record<string, Record<string, unknown> | null | undefined>
) {
  const context = await getAuditContext(request)
  if (!context) return

  const normalizedType = normalizeEntityType(entityType)

  // Log each item individually for detailed tracking
  for (let i = 0; i < entityIds.length; i++) {
    const entityId = entityIds[i]
    const rawSnapshot = snapshotsById?.[entityId]
    const oldValues = rawSnapshot
      ? pickSnapshot(normalizedType, rawSnapshot as Record<string, unknown>)
      : null

    await logAuditEvent({
      action: 'BULK_DELETE',
      entityType: normalizedType,
      entityId,
      entityName: entityNames[i],
      description: reason || undefined,
      reason,
      oldValues: oldValues || undefined,
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      tenantId: context.tenantId || 'unknown'
    })
  }
}

export async function logBulkUpdate(request: NextRequest, entityType: string, entityIds: string[], entityNames: string[], updates: any) {
  const context = await getAuditContext(request)
  if (!context) return

  const normalizedType = normalizeEntityType(entityType)
  const safeUpdates = sanitizeAuditPayload(updates)

  for (let i = 0; i < entityIds.length; i++) {
    await logAuditEvent({
      action: 'BULK_UPDATE',
      entityType: normalizedType,
      entityId: entityIds[i],
      entityName: entityNames[i],
      newValues: safeUpdates,
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      tenantId: context.tenantId || 'unknown'
    })
  }
}

/**
 * Log an audit event with tenant context
 */
export async function logAudit(data: AuditLogData): Promise<void> {
  // Circuit breaker: skip audit logging during connection exhaustion
  if (isCircuitOpen()) return;

  // Ensure required fields are present (userId is NOW optional for bot/system operations)
  if (!data.entityType || !data.entityId || !data.tenantId) {
    console.error('❌ Missing required fields for audit log:', {
      entityType: data.entityType,
      entityId: data.entityId,
      tenantId: data.tenantId
    });
    return;
  }

  try {
    // Prepare the data with proper JSON handling
    const safeUserRole = data.userRole || 'SYSTEM';
    const actionFinal: PrismaAuditAction = isPrismaAuditAction(String(data.action))
      ? (data.action as PrismaAuditAction)
      : 'CREATE';

    // Build base log data WITHOUT userId field (use user relation instead)
    const logData: any = {
      action: actionFinal,
      entityType: normalizeEntityType(data.entityType),
      entityId: data.entityId,
      entityName: data.entityName || null,
      reason: resolveDescription(data),
      ipAddress: data.ipAddress?.substring(0, 100) || null,
      userAgent: data.userAgent?.substring(0, 255) || null,
      userRole: safeUserRole,
      userName: data.userName || 'System',
      // Note: userId is handled via user relation connect, not as direct field
      tenant: {
        connect: { id: data.tenantId }
      }
    };

    // Handle JSON fields with proper typing (always persist details even without newValues)
    if (data.oldValues) {
      logData.oldValues = prepareJsonPayload(data.oldValues);
    }

    const mergedNew = mergeDetailsIntoNewValues(
      data.newValues ? JSON.parse(JSON.stringify(data.newValues)) : null,
      data.details,
      String(data.action)
    );
    if (mergedNew !== null) {
      logData.newValues = mergedNew;
    }

    // Only add user relation if userId is provided and user exists
    if (data.userId) {
      const exists = await checkUserExists(data.userId);
      if (exists) {
        logData.user = {
          connect: { id: data.userId }
        };
      }
    }

    // Create audit log using raw client to bypass tenant middleware
    await prismaRaw.auditLog.create({
      data: logData
    });

    recordAuditSuccess();
  } catch (error) {
    recordAuditFailure();
    console.error('[AuditLogger] Failed to log audit event:', error);
    // Don't throw - audit logging should not break the main operation
  }
}

export async function logBulkToggle(request: NextRequest, entityType: string, entityIds: string[], entityNames: string[], active: boolean) {
  const context = await getAuditContext(request)
  if (!context) return

  const normalizedType = normalizeEntityType(entityType)

  for (let i = 0; i < entityIds.length; i++) {
    await logAuditEvent({
      action: 'BULK_TOGGLE',
      entityType: normalizedType,
      entityId: entityIds[i],
      entityName: entityNames[i],
      newValues: { active },
      description: active ? 'Activado' : 'Desactivado',
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      tenantId: context.tenantId || 'unknown'
    })
  }
}
