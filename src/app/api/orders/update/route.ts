// src/app/api/orders/update/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields, sanitizeInput } from '@/lib/apiUtils'
import { logCreate, logUpdate } from '@/lib/auditLogger'

// Function to detect meaningful changes between old and new order data
function detectChanges(oldData: any, newData: any): string[] {
  const changes: string[] = []
  
  // All fields from the production form that should be tracked
  const productionFields = [
    // Información del Cliente
    { key: 'username', label: 'Usuario' },
    { key: 'customerName', label: 'Cliente' },
    { key: 'phone', label: 'Teléfono' },
    { key: 'email', label: 'Email' },
    { key: 'business', label: 'Negocio' },
    
    // Producto
    { key: 'product', label: 'Producto' },
    { key: 'quantity', label: 'Cantidad' },
    { key: 'size', label: 'Tamaño' },
    { key: 'color', label: 'Color' },
    { key: 'packaging', label: 'Empaque' },
    { key: 'customization', label: 'Personalización' },
    { key: 'delivery', label: 'Delivery' },
    
    // Estado y Canal
    { key: 'status', label: 'Estado' },
    { key: 'funnel', label: 'Canal' },
    
    // Detalles de Envío
    { key: 'address', label: 'Dirección' },
    { key: 'expectedDate', label: 'Fecha Esperada' },
    { key: 'saleDate', label: 'Fecha de Venta' },
    { key: 'courier', label: 'Mensajería' },
    { key: 'seller', label: 'Vendedor' },
    { key: 'province', label: 'Provincia' },
    { key: 'canton', label: 'Cantón' },
    { key: 'district', label: 'Distrito' },
    
    // Costos y Total
    { key: 'productCost', label: 'Costo de Producto' },
    { key: 'shippingCost', label: 'Costo de Envío' },
    { key: 'iva', label: 'IVA' },
    { key: 'total', label: 'Total' },
    
    // Comentarios
    { key: 'comments', label: 'Comentarios' },
    
    // Fechas adicionales
    { key: 'agreedDate', label: 'Fecha Acordada' },
    { key: 'pickupDate', label: 'Fecha de Recogida' }
  ]

  for (const field of productionFields) {
    const oldValue = oldData[field.key]
    const newValue = newData[field.key]
    
    // Skip if both are null/undefined/empty
    if ((!oldValue || oldValue === '') && (!newValue || newValue === '')) continue
    
    // Skip if values are the same
    if (oldValue === newValue) continue
    
    // Format the change description with the production form label
    const oldDisplay = oldValue || 'N/A'
    const newDisplay = newValue || 'N/A'
    
    changes.push(`${field.label}: "${oldDisplay}" → "${newDisplay}"`)
  }

  return changes
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields(body, ['orderId'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }

    // Sanitize string inputs
    const cleanData: any = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        typeof value === 'string' ? sanitizeInput(value) : value
      ])
    )

    const existing = await prisma.order.findUnique({ where: { orderId: cleanData.orderId } })
    const data = {
      orderId: cleanData.orderId,
      orderType: cleanData.orderType || 'EA',
      status: cleanData.status || 'Pendiente',
      delivery: cleanData.delivery || null,
      timestamp: cleanData.timestamp ? new Date(cleanData.timestamp) : undefined,
      customerName: cleanData.customerName || '',
      username: cleanData.username || null,
      phone: cleanData.phone || null,
      email: cleanData.email || null,
      business: cleanData.business || null,
      product: cleanData.product || null,
      quantity: Number(cleanData.quantity || 0),
      size: cleanData.size || null,
      color: cleanData.color || null,
      packaging: cleanData.packaging || null,
      customization: cleanData.customization || null,
      comments: cleanData.comments || null,
      total: Number(cleanData.total || 0),
      iva: cleanData.iva != null ? Number(cleanData.iva) : null,
      shippingCost: cleanData.shippingCost != null ? Number(cleanData.shippingCost) : null,
      productCost: cleanData.productCost != null ? Number(cleanData.productCost) : null,
      funnel: cleanData.funnel || null,
      expectedDate: cleanData.expectedDate || null,
      saleDate: cleanData.saleDate || null,
      courier: cleanData.courier || null,
      seller: cleanData.seller || null,
      province: cleanData.province || null,
      canton: cleanData.canton || null,
      district: cleanData.district || null,
      address: cleanData.address || null,
      agreedDate: cleanData.agreedDate || null,
      pickupDate: cleanData.pickupDate || null,
    }

    const result = existing
      ? await prisma.order.update({ where: { orderId: cleanData.orderId }, data })
      : await prisma.order.create({ data })

    // Log audit trail with smart change detection
    try {
      if (existing) {
        // Only log if there are actual changes
        const changes = detectChanges(existing, data)
        if (changes.length > 0) {
          console.log('Logging order update with changes:', changes)
          await logUpdate(request as any, 'order', result.id, `Order #${result.orderId}`, 
            { changes: changes }, 
            { changes: changes })
        }
      } else {
        console.log('Logging order creation')
        await logCreate(request as any, 'order', result.id, `Order #${result.orderId}`, 
          { orderId: result.orderId, customerName: data.customerName, status: data.status })
      }
    } catch (auditError) {
      console.error('Failed to log audit trail:', auditError)
      // Try to log manually if the audit logger fails
      try {
        const changes = existing ? detectChanges(existing, data) : []
        await prisma.auditLog.create({
          data: {
            action: existing ? 'UPDATE' : 'CREATE',
            entityType: 'order',
            entityId: result.id,
            entityName: `Order #${result.orderId}`,
            oldValues: existing ? { changes: changes } : null,
            newValues: existing ? { changes: changes } : { 
              orderId: result.orderId, 
              customerName: data.customerName, 
              status: data.status 
            },
            userId: 'system',
            userName: 'System',
            userRole: 'MASTER',
            ipAddress: 'unknown',
            userAgent: 'unknown'
          }
        })
        console.log('Manual audit log created successfully')
      } catch (manualError) {
        console.error('Failed to create manual audit log:', manualError)
        // Create a simple audit log entry
        const changes = existing ? detectChanges(existing, data) : []
        console.log('AUDIT LOG:', {
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'order',
          entityId: result.id,
          entityName: `Order #${result.orderId}`,
          changes: changes,
          timestamp: new Date().toISOString()
        })
      }
    }

    return createSuccessResponse(result, existing ? 'Order updated successfully' : 'Order created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}