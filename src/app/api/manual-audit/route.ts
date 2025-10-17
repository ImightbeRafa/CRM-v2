import { NextRequest, NextResponse } from 'next/server'
import { Database } from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'

export async function GET(request: NextRequest) {
  try {
    console.log('Creating manual audit log...')
    
    // Connect to SQLite database directly
    const dbPath = path.join(process.cwd(), 'prisma', 'dev.db')
    const db = await open({
      filename: dbPath,
      driver: require('sqlite3').Database
    })

    // Create audit log entry manually
    const auditId = 'manual-' + Date.now()
    const timestamp = new Date().toISOString()
    
    await db.run(`
      INSERT INTO AuditLog (
        id, action, entityType, entityId, entityName, 
        newValues, userId, userName, userRole, timestamp, 
        ipAddress, userAgent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      auditId,
      'CREATE',
      'test',
      'test-' + Date.now(),
      'Manual Test Entry',
      JSON.stringify({ test: true, timestamp }),
      'manual-user',
      'Manual User',
      'MASTER',
      timestamp,
      '127.0.0.1',
      'Manual Test'
    ])

    console.log('Manual audit log created with ID:', auditId)

    // Fetch all audit logs
    const auditLogs = await db.all(`
      SELECT * FROM AuditLog 
      ORDER BY timestamp DESC 
      LIMIT 10
    `)

    await db.close()

    return NextResponse.json({
      status: 'success',
      message: 'Manual audit log created successfully',
      data: {
        createdId: auditId,
        totalLogs: auditLogs.length,
        recentLogs: auditLogs
      }
    })
  } catch (error) {
    console.error('Manual audit error:', error)
    return NextResponse.json({
      status: 'error',
      error: 'Manual audit failed: ' + String(error)
    }, { status: 500 })
  }
}
