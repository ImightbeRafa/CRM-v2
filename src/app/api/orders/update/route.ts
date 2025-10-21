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
    
    if (!existing) {
      return createErrorResponse('Order not found', 404)
    }

    // Only update fields that are provided in the request
    const updateData: any = {}
    
    // Check each field and only include it if it's provided
    if (cleanData.orderType !== undefined) updateData.orderType = cleanData.orderType
    if (cleanData.status !== undefined) updateData.status = cleanData.status
    if (cleanData.delivery !== undefined) updateData.delivery = cleanData.delivery
    if (cleanData.timestamp !== undefined) updateData.timestamp = new Date(cleanData.timestamp)
    if (cleanData.customerName !== undefined) updateData.customerName = cleanData.customerName
    if (cleanData.username !== undefined) updateData.username = cleanData.username
    if (cleanData.phone !== undefined) updateData.phone = cleanData.phone
    if (cleanData.email !== undefined) updateData.email = cleanData.email
    if (cleanData.business !== undefined) updateData.business = cleanData.business
    if (cleanData.product !== undefined) updateData.product = cleanData.product
    if (cleanData.quantity !== undefined) updateData.quantity = Number(cleanData.quantity)
    if (cleanData.size !== undefined) updateData.size = cleanData.size
    if (cleanData.color !== undefined) updateData.color = cleanData.color
    if (cleanData.packaging !== undefined) updateData.packaging = cleanData.packaging
    if (cleanData.customization !== undefined) updateData.customization = cleanData.customization
    if (cleanData.comments !== undefined) updateData.comments = cleanData.comments
    if (cleanData.total !== undefined) updateData.total = Number(cleanData.total)
    if (cleanData.iva !== undefined) updateData.iva = cleanData.iva != null ? Number(cleanData.iva) : null
    if (cleanData.shippingCost !== undefined) updateData.shippingCost = cleanData.shippingCost != null ? Number(cleanData.shippingCost) : null
    if (cleanData.productCost !== undefined) updateData.productCost = cleanData.productCost != null ? Number(cleanData.productCost) : null
    if (cleanData.funnel !== undefined) updateData.funnel = cleanData.funnel
    if (cleanData.expectedDate !== undefined) updateData.expectedDate = cleanData.expectedDate
    if (cleanData.saleDate !== undefined) updateData.saleDate = cleanData.saleDate
    if (cleanData.courier !== undefined) updateData.courier = cleanData.courier
    if (cleanData.seller !== undefined) updateData.seller = cleanData.seller
    if (cleanData.province !== undefined) updateData.province = cleanData.province
    if (cleanData.canton !== undefined) updateData.canton = cleanData.canton
    if (cleanData.district !== undefined) updateData.district = cleanData.district
    if (cleanData.address !== undefined) updateData.address = cleanData.address
    if (cleanData.agreedDate !== undefined) updateData.agreedDate = cleanData.agreedDate
    if (cleanData.pickupDate !== undefined) updateData.pickupDate = cleanData.pickupDate

    const result = await prisma.order.update({ where: { orderId: cleanData.orderId }, data: updateData })

    // Log audit trail with smart change detection
    if (Object.keys(updateData).length > 0) {
      // Only log if there are actual changes
      const changes = detectChanges(existing, updateData)
      if (changes.length > 0) {
        console.log('Logging order update with changes:', {
          orderId: result.orderId,
          changes: changes,
          userId: 'will-be-determined-by-audit-logger'
        })
        await logUpdate(request as any, 'order', result.id, `Order #${result.orderId}`, 
          { changes: changes }, 
          { changes: changes })
      }
    }

    return createSuccessResponse(result, 'Order updated successfully')
  } catch (error) {
    return handleApiError(error)
  }
}