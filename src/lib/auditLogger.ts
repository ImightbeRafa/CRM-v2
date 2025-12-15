import { prisma } from '@/lib/db'
import { prismaRaw } from '@/lib/prisma-tenant'
import { getToken } from 'next-auth/jwt'
import { NextRequest } from 'next/server'
import { getTenantContext } from './tenantContext'

import { AuditAction as PrismaAuditAction } from '@prisma/client';

// Define our extended audit action type that includes custom actions
type ExtendedAuditAction = PrismaAuditAction | 'SECURITY_WARNING' | 'TENANT_ERROR';

// Type guard to check if an action is a valid Prisma audit action
function isPrismaAuditAction(action: string): action is PrismaAuditAction {
  const validActions: string[] = Object.values(PrismaAuditAction);
  return validActions.includes(action);
}

export interface AuditLogData {
  action: ExtendedAuditAction;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  description?: string | null;
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
  try {
    // Validate that user exists before attempting to create audit log
    let userExists = false;
    if (data.userId) {
      try {
        const user = await prismaRaw.user.findUnique({
          where: { id: data.userId },
          select: { id: true }
        });
        userExists = !!user;
      } catch (err) {
        console.warn('[AuditLogger] Failed to verify user exists:', err);
      }
    }

    // Ensure the action is a valid Prisma audit action
    const action: PrismaAuditAction = isPrismaAuditAction(data.action) 
      ? data.action 
      : 'CREATE';

    // Prepare the log data - userId is now optional
    const logData: any = {
      action,
      entityType: data.entityType,
      entityId: data.entityId,
      entityName: data.entityName || null,
      reason: data.description || null,
      oldValues: data.oldValues ? JSON.parse(JSON.stringify(data.oldValues)) : null,
      newValues: (() => {
        const base = data.newValues ? JSON.parse(JSON.stringify(data.newValues)) : null;
        if (data.details) {
          const wrapped = typeof base === 'object' && base !== null ? base : {};
          (wrapped as any)._meta = {
            ...(typeof data.details === 'object' ? data.details : { details: data.details }),
            originalAction: data.action,
          };
          return wrapped;
        }
        return base;
      })(),
      userName: data.userName || 'System',
      userRole: data.userRole,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      userId: null, // Explicitly null by default (optional field)
      tenant: {
        connect: { id: data.tenantId }
      }
    };

    // Only add user relation if user exists
    if (userExists && data.userId) {
      logData.userId = data.userId;
      logData.user = {
        connect: { id: data.userId }
      };
    }

    // Create the audit log using raw client to bypass tenant middleware
    await prismaRaw.auditLog.create({
      data: logData
    });
    
    if (!userExists) {
      console.log(`[AuditLogger] ⚠️  Audit log created without user reference: ${data.action} on ${data.entityType} by ${data.userName || 'System'}`);
    }
  } catch (error) {
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

    // Get user details from database using the token's sub (user ID)
    const user = await prismaRaw.user.findUnique({
      where: { id: token.sub },
      select: { 
        id: true, 
        username: true,
        defaultTenantId: true,
        memberships: {
          where: { isActive: true },
          select: {
            role: true,
            tenantId: true
          },
          take: 1
        }
      }
    })

    if (!user || !user.memberships || user.memberships.length === 0) {
      console.warn('⚠️ User not found or no active memberships for audit context');
      return null
    }

    // Map the new role system to audit log format
    const role = user.memberships[0].role
    const userRole = (role === 'OWNER' || role === 'ADMIN') ? 'MASTER' : 'REGULAR'
    const tenantId = user.memberships[0].tenantId || user.defaultTenantId

    return {
      userId: user.id,
      userName: user.username || 'Unknown',
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

export async function logBulkDelete(request: NextRequest, entityType: string, entityIds: string[], entityNames: string[], reason?: string) {
  const context = await getAuditContext(request)
  if (!context) return

  // Log each item individually for detailed tracking
  for (let i = 0; i < entityIds.length; i++) {
    await logAuditEvent({
      action: 'BULK_DELETE',
      entityType,
      entityId: entityIds[i],
      entityName: entityNames[i],
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      tenantId: context.tenantId || 'unknown'  // Add tenant isolation
    })
  }
}

export async function logBulkUpdate(request: NextRequest, entityType: string, entityIds: string[], entityNames: string[], updates: any) {
  const context = await getAuditContext(request)
  if (!context) return

  for (let i = 0; i < entityIds.length; i++) {
    await logAuditEvent({
      action: 'BULK_UPDATE',
      entityType,
      entityId: entityIds[i],
      entityName: entityNames[i],
      newValues: updates,
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      tenantId: context.tenantId || 'unknown'  // Add tenant isolation
    })
  }
}

/**
 * Log an audit event with tenant context
 */
export async function logAudit(data: AuditLogData): Promise<void> {
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
    
    // Build base log data WITHOUT user relation first
    const logData: any = {
      action: actionFinal,
      entityType: data.entityType,
      entityId: data.entityId,
      entityName: data.entityName || null,
      reason: data.description || null,
      ipAddress: data.ipAddress?.substring(0, 100) || null,
      userAgent: data.userAgent?.substring(0, 255) || null,
      userRole: safeUserRole,
      userName: data.userName || 'System',
      userId: null, // Explicitly set to null (optional field now)
      tenant: {
        connect: { id: data.tenantId }
      }
    };

    // Handle JSON fields with proper typing
    if (data.oldValues) {
      logData.oldValues = data.oldValues;
    }
    
    if (data.newValues) {
      let newVals: any = typeof data.newValues === 'object' ? { ...data.newValues } : data.newValues;
      if (data.details && typeof newVals === 'object') {
        (newVals as any)._meta = {
          ...(typeof data.details === 'object' ? data.details : { details: data.details }),
        };
      }
      logData.newValues = newVals;
    }

    // Only add user relation if userId is provided and user exists
    if (data.userId) {
      try {
        const user = await prismaRaw.user.findUnique({
          where: { id: data.userId },
          select: { id: true }
        });
        
        if (user) {
          // User exists - connect the relation
          logData.userId = data.userId;
          logData.user = {
            connect: { id: data.userId }
          };
        } else {
          // User doesn't exist - keep userId as null, userName as provided
          console.log('[AuditLogger] User not found, logging without user relation:', data.userId);
        }
      } catch (err) {
        console.warn('[AuditLogger] Failed to verify user exists:', err);
        // Keep userId as null on error
      }
    }

    // Create audit log using raw client to bypass tenant middleware
    await prismaRaw.auditLog.create({
      data: logData
    });
    
  } catch (error) {
    console.error('[AuditLogger] Failed to log audit event:', error);
    // Don't throw - audit logging should not break the main operation
  }
}

export async function logBulkToggle(request: NextRequest, entityType: string, entityIds: string[], entityNames: string[], active: boolean) {
  const context = await getAuditContext(request)
  if (!context) return

  for (let i = 0; i < entityIds.length; i++) {
    await logAuditEvent({
      action: 'BULK_TOGGLE',
      entityType,
      entityId: entityIds[i],
      entityName: entityNames[i],
      newValues: { active },
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      tenantId: context.tenantId || 'unknown'  // Add tenant isolation
    })
  }
}
