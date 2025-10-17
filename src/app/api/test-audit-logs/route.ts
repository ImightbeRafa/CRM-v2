import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    console.log('Fetching audit logs...')
    
    // Get recent audit logs
    const auditLogs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 10
    })

    console.log('Found audit logs:', auditLogs.length)

    return NextResponse.json({ 
      status: 'success', 
      message: 'Audit logs retrieved successfully',
      data: auditLogs,
      count: auditLogs.length
    })
  } catch (error) {
    console.error('Test audit logs error:', error)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to fetch audit logs: ' + error 
    }, { status: 500 })
  }
}
