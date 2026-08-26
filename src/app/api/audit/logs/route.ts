import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { entityTypeFilterAliases } from '@/lib/auditPayload'
import { getMembershipForToken } from '@/lib/selected-tenant'

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

    return createSuccessResponse({
      logs: auditLogs,
      total,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error fetching audit logs:', error)
    return handleApiError(error)
  }
}
