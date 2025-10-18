import { prisma } from './db'
import { createSuccessResponse, createErrorResponse, handleApiError } from './apiUtils'
import { logBulkDelete, logBulkUpdate, logBulkToggle } from './auditLogger'
import { NextRequest } from 'next/server'

export interface BulkOperationResult {
  success: number
  failed: number
  errors: string[]
}

export interface BulkDeleteRequest {
  ids: string[]
  type: 'users' | 'orders' | 'fields' | 'optionSets' | 'options' | 'shipping' | 'sellers'
  reason?: string
  request?: NextRequest
}

export interface BulkUpdateRequest {
  ids: string[]
  type: 'users' | 'orders' | 'fields' | 'optionSets' | 'options' | 'shipping' | 'sellers'
  updates: Record<string, any>
  request?: NextRequest
}

export async function bulkDelete(request: BulkDeleteRequest): Promise<BulkOperationResult> {
  const { ids, type, reason, request: httpRequest } = request
  const result: BulkOperationResult = {
    success: 0,
    failed: 0,
    errors: []
  }

  // Get entity names for audit logging
  let entityNames: string[] = []
  try {
    switch (type) {
      case 'users':
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
        entityNames = users.map(u => u.username)
        break
      case 'orders':
        const orders = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderId: true } })
        entityNames = orders.map(o => o.orderId)
        break
      case 'fields':
        const fields = await prisma.productField.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
        entityNames = fields.map(f => f.label)
        break
      case 'optionSets':
        const optionSets = await prisma.productOptionSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        entityNames = optionSets.map(os => os.name)
        break
      case 'options':
        const options = await prisma.productOption.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
        entityNames = options.map(o => o.label)
        break
      case 'shipping':
        const shipping = await prisma.shippingMethod.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        entityNames = shipping.map(s => s.name)
        break
      case 'sellers':
        const sellers = await prisma.seller.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        entityNames = sellers.map(s => s.name)
        break
    }
  } catch (error) {
    console.error('Failed to get entity names for audit:', error)
  }

  try {
    switch (type) {
      case 'users':
        // Don't allow deleting master users
        const masterUsers = await prisma.user.findMany({
          where: { id: { in: ids }, role: 'MASTER' }
        })
        
        if (masterUsers.length > 0) {
          result.errors.push('Cannot delete master users')
          result.failed += masterUsers.length
        }
        
        const regularUserIds = ids.filter(id => !masterUsers.some(u => u.id === id))
        if (regularUserIds.length > 0) {
          await prisma.user.deleteMany({
            where: { id: { in: regularUserIds } }
          })
          result.success += regularUserIds.length
        }
        break

      case 'orders':
        await prisma.order.deleteMany({
          where: { id: { in: ids } }
        })
        result.success = ids.length
        break

      case 'fields':
        await prisma.productField.deleteMany({
          where: { id: { in: ids } }
        })
        result.success = ids.length
        break

      case 'optionSets':
        await prisma.productOptionSet.deleteMany({
          where: { id: { in: ids } }
        })
        result.success = ids.length
        break

      case 'options':
        await prisma.productOption.deleteMany({
          where: { id: { in: ids } }
        })
        result.success = ids.length
        break

      case 'shipping':
        await prisma.shippingMethod.deleteMany({
          where: { id: { in: ids } }
        })
        result.success = ids.length
        break

      case 'sellers':
        await prisma.seller.deleteMany({
          where: { id: { in: ids } }
        })
        result.success = ids.length
        break

      default:
        throw new Error(`Unsupported bulk delete type: ${type}`)
    }

    // Log audit trail
    if (httpRequest && result.success > 0) {
      try {
        console.log('Logging bulk delete:', {
          type,
          count: result.success,
          entityNames: entityNames.slice(0, result.success),
          reason
        })
        await logBulkDelete(httpRequest, type, ids.slice(0, result.success), entityNames.slice(0, result.success), reason)
      } catch (auditError) {
        console.error('Failed to log bulk delete audit:', auditError)
      }
    }

    return result
  } catch (error) {
    console.error('Bulk delete error:', error)
    result.failed = ids.length
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

export async function bulkUpdate(request: BulkUpdateRequest): Promise<BulkOperationResult> {
  const { ids, type, updates } = request
  const result: BulkOperationResult = {
    success: 0,
    failed: 0,
    errors: []
  }

  try {
    // Validate updates based on type
    const sanitizedUpdates = sanitizeUpdates(updates, type)
    
    switch (type) {
      case 'users':
        // Don't allow changing master user roles
        if (updates.role && updates.role !== 'MASTER') {
          const masterUsers = await prisma.user.findMany({
            where: { id: { in: ids }, role: 'MASTER' }
          })
          
          if (masterUsers.length > 0) {
            result.errors.push('Cannot change master user roles')
            result.failed += masterUsers.length
          }
        }
        
        await prisma.user.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      case 'orders':
        await prisma.order.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      case 'fields':
        await prisma.productField.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      case 'optionSets':
        await prisma.productOptionSet.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      case 'options':
        await prisma.productOption.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      case 'shipping':
        await prisma.shippingMethod.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      case 'sellers':
        await prisma.seller.updateMany({
          where: { id: { in: ids } },
          data: sanitizedUpdates
        })
        result.success = ids.length
        break

      default:
        throw new Error(`Unsupported bulk update type: ${type}`)
    }

    // Log audit trail for bulk updates
    if (request && result.success > 0) {
      try {
        console.log('Logging bulk update:', {
          type,
          count: result.success,
          updates
        })
        // Get entity names for audit logging
        let entityNames: string[] = []
        try {
          switch (type) {
            case 'users':
              const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
              entityNames = users.map(u => u.username)
              break
            case 'orders':
              const orders = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderId: true } })
              entityNames = orders.map(o => o.orderId)
              break
            case 'fields':
              const fields = await prisma.productField.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
              entityNames = fields.map(f => f.label)
              break
            case 'optionSets':
              const optionSets = await prisma.productOptionSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
              entityNames = optionSets.map(os => os.name)
              break
            case 'options':
              const options = await prisma.productOption.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
              entityNames = options.map(o => o.label)
              break
            case 'shipping':
              const shipping = await prisma.shippingMethod.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
              entityNames = shipping.map(s => s.name)
              break
            case 'sellers':
              const sellers = await prisma.seller.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
              entityNames = sellers.map(s => s.name)
              break
          }
        } catch (error) {
          console.error('Failed to get entity names for bulk update audit:', error)
        }
        
        await logBulkUpdate(request, type, ids.slice(0, result.success), entityNames.slice(0, result.success), updates)
      } catch (auditError) {
        console.error('Failed to log bulk update audit:', auditError)
      }
    }

    return result
  } catch (error) {
    console.error('Bulk update error:', error)
    result.failed = ids.length
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

function sanitizeUpdates(updates: Record<string, any>, type: string): Record<string, any> {
  const sanitized: Record<string, any> = {}
  
  // Remove dangerous fields
  const dangerousFields = ['id', 'createdAt', 'updatedAt']
  
  for (const [key, value] of Object.entries(updates)) {
    if (dangerousFields.includes(key)) continue
    
    // Sanitize string values
    if (typeof value === 'string') {
      sanitized[key] = value.trim().replace(/[<>]/g, '')
    } else {
      sanitized[key] = value
    }
  }
  
  return sanitized
}

export async function bulkToggleActive(
  ids: string[], 
  type: 'users' | 'fields' | 'optionSets' | 'options' | 'shipping' | 'sellers',
  active: boolean
): Promise<BulkOperationResult> {
  return bulkUpdate({
    ids,
    type,
    updates: { active }
  })
}
