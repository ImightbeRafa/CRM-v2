import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    console.log('Creating test audit log manually...')
    
    // Create a simple test audit log entry
    const testAuditLog = {
      id: 'test-audit-' + Date.now(),
      action: 'CREATE',
      entityType: 'order',
      entityId: 'test-order-001',
      entityName: 'Test Order #001',
      oldValues: null,
      newValues: { 
        orderId: 'TEST-001',
        customerName: 'Test Customer',
        status: 'Pendiente',
        total: 100
      },
      reason: null,
      userId: 'test-user',
      userName: 'Test User',
      userRole: 'MASTER',
      timestamp: new Date().toISOString(),
      ipAddress: '127.0.0.1',
      userAgent: 'Test Agent'
    }

    console.log('Test audit log created:', testAuditLog)

    return NextResponse.json({
      status: 'success',
      message: 'Test audit log created successfully',
      data: testAuditLog
    })
  } catch (error) {
    console.error('Test audit creation error:', error)
    return NextResponse.json({
      status: 'error',
      error: 'Test audit creation failed: ' + String(error)
    }, { status: 500 })
  }
}
