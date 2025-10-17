import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    console.log('Testing simple audit log creation...')
    
    // Try to import prisma
    const { prisma } = await import('@/lib/db')
    console.log('Prisma imported successfully')
    
    // Try to create a simple audit log
    const auditLog = await prisma.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'test',
        entityId: 'simple-test-' + Date.now(),
        entityName: 'Simple Test Entry',
        newValues: { test: true },
        userId: 'test-user',
        userName: 'Test User',
        userRole: 'MASTER',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent'
      }
    })

    console.log('Simple audit log created:', auditLog)

    return NextResponse.json({ 
      status: 'success', 
      message: 'Simple audit log created successfully',
      data: auditLog 
    })
  } catch (error) {
    console.error('Simple audit test error:', error)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Simple audit test failed: ' + String(error) 
    }, { status: 500 })
  }
}
