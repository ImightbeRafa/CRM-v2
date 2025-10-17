import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    console.log('Fetching mock audit logs...')
    
    // Create mock audit log data with focused, relevant information
    const mockAuditLogs = [
      {
        id: 'audit-1',
        action: 'CREATE',
        entityType: 'order',
        entityId: 'order-001',
        entityName: 'Order #EA-2024-001',
        oldValues: null,
        newValues: {
          orderId: 'EA-2024-001',
          customerName: 'John Doe',
          status: 'Pendiente',
          total: 150
        },
        reason: null,
        userId: 'user-1',
        userName: 'Admin User',
        userRole: 'MASTER',
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0...'
      },
      {
        id: 'audit-2',
        action: 'UPDATE',
        entityType: 'order',
        entityId: 'order-001',
        entityName: 'Order #EA-2024-001',
        oldValues: {
          changes: ['Estado: "Pendiente" → "En Proceso"']
        },
        newValues: {
          changes: ['Estado: "Pendiente" → "En Proceso"']
        },
        reason: null,
        userId: 'user-1',
        userName: 'Admin User',
        userRole: 'MASTER',
        timestamp: new Date(Date.now() - 1000 * 60 * 3).toISOString(), // 3 minutes ago
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0...'
      },
      {
        id: 'audit-3',
        action: 'UPDATE',
        entityType: 'order',
        entityId: 'order-001',
        entityName: 'Order #EA-2024-001',
        oldValues: {
          changes: [
            'Cliente: "John Doe" → "John Smith"',
            'Teléfono: "123-456-7890" → "123-456-7891"',
            'Total: "150" → "175"',
            'Cantidad: "5" → "7"'
          ]
        },
        newValues: {
          changes: [
            'Cliente: "John Doe" → "John Smith"',
            'Teléfono: "123-456-7890" → "123-456-7891"',
            'Total: "150" → "175"',
            'Cantidad: "5" → "7"'
          ]
        },
        reason: null,
        userId: 'user-1',
        userName: 'Admin User',
        userRole: 'MASTER',
        timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), // 2 minutes ago
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0...'
      },
      {
        id: 'audit-4',
        action: 'UPDATE',
        entityType: 'order',
        entityId: 'order-001',
        entityName: 'Order #EA-2024-001',
        oldValues: {
          changes: [
            'Dirección: "Av. Central, 100m este" → "Av. Central, 200m este"',
            'Mensajería: "Correos de Costa Rica" → "DHL Express"',
            'Vendedor: "Juan Pérez" → "María González"'
          ]
        },
        newValues: {
          changes: [
            'Dirección: "Av. Central, 100m este" → "Av. Central, 200m este"',
            'Mensajería: "Correos de Costa Rica" → "DHL Express"',
            'Vendedor: "Juan Pérez" → "María González"'
          ]
        },
        reason: null,
        userId: 'user-1',
        userName: 'Admin User',
        userRole: 'MASTER',
        timestamp: new Date(Date.now() - 1000 * 60 * 1).toISOString(), // 1 minute ago
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0...'
      },
      {
        id: 'audit-5',
        action: 'DELETE',
        entityType: 'order',
        entityId: 'order-002',
        entityName: 'Order #EA-2024-002',
        oldValues: {
          orderId: 'EA-2024-002',
          customerName: 'Jane Smith',
          status: 'Pendiente',
          total: 200
        },
        newValues: null,
        reason: 'Order cancelled by customer',
        userId: 'user-1',
        userName: 'Admin User',
        userRole: 'MASTER',
        timestamp: new Date(Date.now() - 1000 * 60 * 1).toISOString(), // 1 minute ago
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0...'
      }
    ]

    console.log('Returning mock audit logs:', mockAuditLogs.length)

    return NextResponse.json({
      status: 'success',
      data: {
        logs: mockAuditLogs,
        total: mockAuditLogs.length,
        limit: 100,
        offset: 0
      }
    })
  } catch (error) {
    console.error('Mock audit logs error:', error)
    return NextResponse.json({
      status: 'error',
      error: 'Failed to fetch mock audit logs: ' + String(error)
    }, { status: 500 })
  }
}
