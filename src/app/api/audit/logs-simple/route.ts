import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    console.log('Fetching audit logs (simple)...')
    
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const entityType = searchParams.get('entityType')
    const userRole = searchParams.get('userRole')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

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

    console.log('Querying audit logs with where clause:', where)

    const auditLogs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset
    })

    const total = await prisma.auditLog.count({ where })

    console.log('Found audit logs:', auditLogs.length, 'Total:', total)

    return NextResponse.json({
      status: 'success',
      data: {
        logs: auditLogs,
        total,
        limit,
        offset
      }
    })
  } catch (error) {
    console.error('Error fetching audit logs:', error)
    return NextResponse.json({
      status: 'error',
      error: 'Failed to fetch audit logs: ' + String(error)
    }, { status: 500 })
  }
}
