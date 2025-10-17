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

export async function logAuditEvent(data: AuditLogData) {
  try {
    await prisma.auditLog.create({
      data: {
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
      }
    })
  } catch (error) {
    console.error('Failed to log audit event:', error)
    // Don't throw error to avoid breaking the main operation
  }
}

export async function getAuditContext(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return null
    }

    return {
      userId: token.sub || '',
      userName: (token as any).username || 'Unknown',
      userRole: (token as any).role as 'MASTER' | 'REGULAR',
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown'
    }
  } catch (error) {
    console.error('Failed to get audit context:', error)
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
  
  // Use fallback context if no authentication context is available
  const fallbackContext = {
    userId: 'system',
    userName: 'System',
    userRole: 'MASTER' as const,
    ipAddress: 'unknown',
    userAgent: 'unknown'
  }

  const auditContext = context || fallbackContext

  console.log('Logging audit action:', {
    action,
    entityType,
    entityId,
    entityName,
    context: auditContext
  })

  await logAuditEvent({
    action,
    entityType,
    entityId,
    entityName,
    oldValues,
    newValues,
    reason,
    userId: auditContext.userId,
    userName: auditContext.userName,
    userRole: auditContext.userRole,
    ipAddress: auditContext.ipAddress,
    userAgent: auditContext.userAgent
  })
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
