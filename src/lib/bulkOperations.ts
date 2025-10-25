import { prisma } from './db'
import { getTenantPrisma } from './prisma-tenant'
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
  tenantId?: string  // Add tenant ID for isolation
}

export interface BulkUpdateRequest {
  ids: string[]
  type: 'users' | 'orders' | 'fields' | 'optionSets' | 'options' | 'shipping' | 'sellers'
  updates: Record<string, any>
  request?: NextRequest
  tenantId?: string  // Add tenant ID for isolation
}

export async function bulkDelete(request: BulkDeleteRequest): Promise<BulkOperationResult> {
  const { ids, type, reason, request: httpRequest, tenantId } = request
  const result: BulkOperationResult = {
    success: 0,
    failed: 0,
    errors: []
  }

  console.log(`🗑️ Starting bulk delete: ${ids.length} ${type} for tenant ${tenantId}`);

  // Use tenant-aware prisma client if tenantId is provided
  const db = tenantId ? getTenantPrisma(tenantId) : prisma;

  // Get entity names for audit logging
  const entityMap = new Map<string, string>(); // id -> name
  
  try {
    switch (type) {
      case 'users':
        const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
        users.forEach(u => entityMap.set(u.id, u.username || 'Unknown'));
        break
      case 'orders':
        const orders = await db.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderId: true } })
        orders.forEach(o => entityMap.set(o.id, o.orderId));
        break
      case 'fields':
        const fields = await db.productField.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
        fields.forEach(f => entityMap.set(f.id, f.label));
        break
      case 'optionSets':
        const optionSets = await db.productOptionSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        optionSets.forEach(os => entityMap.set(os.id, os.name));
        break
      case 'options':
        const options = await db.productOption.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
        options.forEach(o => entityMap.set(o.id, o.label));
        break
      case 'shipping':
        const shipping = await db.shippingMethod.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        shipping.forEach(s => entityMap.set(s.id, s.name));
        break
      case 'sellers':
        const sellers = await db.seller.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        sellers.forEach(s => entityMap.set(s.id, s.name));
        break
    }
  } catch (error) {
    console.error('❌ Failed to get entity names for audit:', error)
  }

  // Process deletions one by one for better error handling
  const successfulIds: string[] = [];
  const successfulNames: string[] = [];
  
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const name = entityMap.get(id) || id;
    
    try {
      // Special handling for users
      if (type === 'users') {
        const user = await db.user.findUnique({
          where: { id },
          select: { memberships: { select: { role: true } } }
        });
        
        if (user?.memberships?.some(m => m.role === 'OWNER' || m.role === 'ADMIN')) {
          result.failed++;
          result.errors.push(`Cannot delete admin/owner user: ${name}`);
          continue;
        }
      }
      
      // Delete based on type
      switch (type) {
        case 'users':
          await db.user.delete({ where: { id } });
          break;
        case 'orders':
          await db.order.delete({ where: { id } });
          break;
        case 'fields':
          await db.productField.delete({ where: { id } });
          break;
        case 'optionSets':
          await db.productOptionSet.delete({ where: { id } });
          break;
        case 'options':
          await db.productOption.delete({ where: { id } });
          break;
        case 'shipping':
          await db.shippingMethod.delete({ where: { id } });
          break;
        case 'sellers':
          await db.seller.delete({ where: { id } });
          break;
        default:
          throw new Error(`Unsupported bulk delete type: ${type}`);
      }
      
      result.success++;
      successfulIds.push(id);
      successfulNames.push(name);
      
      // Progress logging
      if ((i + 1) % 10 === 0 || i === ids.length - 1) {
        console.log(`Progress: ${i + 1}/${ids.length} deleted`);
      }
      
    } catch (error) {
      result.failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to delete ${name}: ${errorMsg}`);
      console.error(`❌ Failed to delete ${name}:`, errorMsg);
    }
  }

  // Log audit trail for successful deletions
  if (httpRequest && successfulIds.length > 0) {
    try {
      console.log(`✅ Logging ${successfulIds.length} successful deletions for audit trail`);
      await logBulkDelete(httpRequest, type, successfulIds, successfulNames, reason);
      console.log(`✅ Audit trail created for ${successfulIds.length} ${type} deletions`);
    } catch (auditError) {
      console.error('❌ Failed to log bulk delete audit:', auditError);
    }
  }

  console.log(`✅ Bulk delete complete: ${result.success} success, ${result.failed} failed`);
  return result;
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
            where: { id: { in: ids } }
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
              entityNames = users.map(u => u.username || 'Unknown')
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
        
        if (request.request) {
          await logBulkUpdate(request.request, type, ids.slice(0, result.success), entityNames.slice(0, result.success), updates)
        }
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
