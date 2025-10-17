import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'
import { createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function GET(request: NextRequest) {
  try {
    const { authorized } = await requireAdmin(request)
    if (!authorized) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const entityType = searchParams.get('entityType')
    const userRole = searchParams.get('userRole')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Build where clause
    const where: any = {}
    
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
      orderBy: { timestamp: 'desc' }
    })

    // Convert to CSV
    const csvHeaders = [
      'ID',
      'Acción',
      'Tipo de Entidad',
      'ID de Entidad',
      'Nombre de Entidad',
      'Usuario',
      'Rol',
      'Timestamp',
      'IP',
      'Razón',
      'Valores Anteriores',
      'Nuevos Valores'
    ]

    const csvRows = auditLogs.map(log => [
      log.id,
      log.action,
      log.entityType,
      log.entityId,
      log.entityName || '',
      log.userName,
      log.userRole,
      log.timestamp.toISOString(),
      log.ipAddress || '',
      log.reason || '',
      log.oldValues ? JSON.stringify(log.oldValues) : '',
      log.newValues ? JSON.stringify(log.newValues) : ''
    ])

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
    ].join('\n')

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`
      }
    })
  } catch (error) {
    return handleApiError(error)
  }
}
