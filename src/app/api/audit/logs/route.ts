import { NextRequest, NextResponse } from 'next/server'
import { prisma, prismaRaw } from '@/lib/db'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { entityTypeFilterAliases } from '@/lib/auditPayload'
import { getMembershipForToken } from '@/lib/selected-tenant'
import { shouldUseSoftDeleteRestoreV2 } from '@/lib/feature-flags'
import { getOrderRestoreEligibility } from '@/lib/order-archive'

export async function GET(request: NextRequest) {
  try {
    const { getToken } = await import('next-auth/jwt')
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return createErrorResponse('Unauthorized', 401)
    }

    const membership = await getMembershipForToken(token)
    if (!membership) {
      return createErrorResponse('Unauthorized', 401)
    }

    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      return createErrorResponse('Forbidden — requires ADMIN or OWNER role', 403)
    }

    const tenantId = membership.tenantId

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const entityType = searchParams.get('entityType')
    const userRole = searchParams.get('userRole')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limit = Math.min(250, Math.max(1, parseInt(searchParams.get('limit') || '100') || 100))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0') || 0)

    // Build where clause with TENANT ISOLATION
    const where: any = {
      tenantId: tenantId  // ← CRITICAL: Only show logs for this tenant
    }
    
    if (action) where.action = action
    if (entityType) {
      where.entityType = { in: entityTypeFilterAliases(entityType) }
    }
    if (userRole) where.userRole = userRole
    
    if (dateFrom || dateTo) {
      where.timestamp = {}
      if (dateFrom) where.timestamp.gte = new Date(dateFrom)
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        where.timestamp.lte = endDate
      }
    }

    const auditLogs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset
    })

    const total = await prisma.auditLog.count({ where })

    let responseLogs: Array<Record<string, unknown>> = auditLogs
    if (membership.role === 'OWNER' && await shouldUseSoftDeleteRestoreV2(tenantId)) {
      const restorableAuditLogs = auditLogs.filter(log => (
        (log.action === 'DELETE' || log.action === 'BULK_DELETE')
        && ['order', 'orders', 'sale', 'sales'].includes(log.entityType.toLowerCase())
      ))
      const orderIds = [...new Set(restorableAuditLogs.map(log => log.entityId))]
      const archivedOrders = orderIds.length > 0
        ? await prismaRaw.order.findMany({
            where: { tenantId, id: { in: orderIds }, deletedAt: { not: null } },
            select: { id: true, deletedAt: true, archiveMetadata: true },
          })
        : []
      const archivedByAuditId = new Map<string, { orderId: string; deletedAt: Date }>()
      for (const order of archivedOrders) {
        const metadata = order.archiveMetadata
        const auditLogId = (
          metadata
          && typeof metadata === 'object'
          && !Array.isArray(metadata)
          && 'archiveAuditLogId' in metadata
          && typeof metadata.archiveAuditLogId === 'string'
        ) ? metadata.archiveAuditLogId : undefined
        if (auditLogId && order.deletedAt) {
          archivedByAuditId.set(auditLogId, { orderId: order.id, deletedAt: order.deletedAt })
        }
      }
      responseLogs = auditLogs.map(log => {
        const archived = archivedByAuditId.get(log.id)
        if (!archived || archived.orderId !== log.entityId) return log
        const deletedAt = archived.deletedAt
        const restore = getOrderRestoreEligibility(deletedAt)
        return {
          ...log,
          restore: {
            eligible: restore.eligible,
            expectedDeletedAt: deletedAt.toISOString(),
            expiresAt: restore.expiresAt.toISOString(),
          },
        }
      })
    }

    return createSuccessResponse({
      logs: responseLogs,
      total,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error fetching audit logs:', error)
    return handleApiError(error)
  }
}
