import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    console.log('Creating test audit log...')
    
    // Create a test audit log entry
    const testAuditLog = await prisma.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'test',
        entityId: 'test-' + Date.now(),
        entityName: 'Test Audit Entry',
        newValues: { test: true, timestamp: new Date() },
        userId: 'test-user',
        userName: 'Test User',
        userRole: 'MASTER',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent'
      }
    })

    console.log('Test audit log created:', testAuditLog)

    return NextResponse.json({ 
      status: 'success', 
      message: 'Test audit log created successfully',
      data: testAuditLog 
    })
  } catch (error) {
    console.error('Test audit error:', error)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to create test audit log: ' + error 
    }, { status: 500 })
  }
}
