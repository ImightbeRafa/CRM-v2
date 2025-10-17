import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    console.log('Testing database connection...')
    
    // Test basic connection
    const userCount = await prisma.user.count()
    console.log('User count:', userCount)
    
    // Test if AuditLog table exists by trying to count
    let auditLogCount = 0
    try {
      auditLogCount = await prisma.auditLog.count()
      console.log('AuditLog count:', auditLogCount)
    } catch (error) {
      console.log('AuditLog table error:', error)
      return NextResponse.json({ 
        status: 'error', 
        error: 'AuditLog table does not exist or has issues: ' + error 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      status: 'success', 
      message: 'Database connection successful',
      data: {
        userCount,
        auditLogCount,
        tablesExist: {
          users: true,
          auditLog: true
        }
      }
    })
  } catch (error) {
    console.error('Database test error:', error)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Database test failed: ' + error 
    }, { status: 500 })
  }
}
