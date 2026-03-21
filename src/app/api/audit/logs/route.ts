import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function GET(request: NextRequest) {
  try {
    // Get tenant from authenticated user
    const { getToken } = await import('next-auth/jwt')
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Get user's tenant
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        defaultTenantId: true,
        memberships: {
          where: { isActive: true },
          select: { tenantId: true, role: true },
          take: 1
        }
      }
    })

    if (!user || !user.memberships || user.memberships.length === 0) {
      return createErrorResponse('Unauthorized', 401)
    }

    const tenantId = user.memberships[0].tenantId || user.defaultTenantId

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const entityType = searchParams.get('entityType')
    const userRole = searchParams.get('userRole')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause with TENANT ISOLATION
    const where: any = {
      tenantId: tenantId  // ← CRITICAL: Only show logs for this tenant
    }
    
    if (action) where.action = action
    if (entityType) where.entityType = entityType
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
