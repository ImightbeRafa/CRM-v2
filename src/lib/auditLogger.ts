import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { NextRequest } from 'next/server'

export interface AuditLogData {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_TOGGLE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT'
  entityType: string
  entityId: string
  entityName?: string
  oldValues?: any
  newValues?: any
  reason?: string
  userId: string
  userName: string
  userRole: 'MASTER' | 'REGULAR'
  ipAddress?: string
  userAgent?: string
}

export async function logAuditEvent(data: AuditLogData & { tenantId?: string }) {
  try {
    const logData: any = {
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      entityName: data.entityName,
      oldValues: data.oldValues,
      newValues: data.newValues,
      reason: data.reason,
      userId: data.userId,
      userName: data.userName,
      userRole: data.userRole,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    };
    
    // Add tenantId if provided (for multi-tenant isolation)
    if (data.tenantId) {
      logData.tenantId = data.tenantId;
    }
    
    await prisma.auditLog.create({
      data: logData
    });
    
    console.log(`✅ Audit log created: ${data.action} on ${data.entityType} by ${data.userName}`);
  } catch (error) {
    console.error('❌ Failed to log audit event:', error);
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
    const user = await prisma.user.findUnique({
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
      reason,
      userId: context.userId,
      userName: context.userName || 'Unknown',
      userRole: context.userRole,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
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
      userAgent: context.userAgent
    })
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
      userAgent: context.userAgent
    })
  }
}
