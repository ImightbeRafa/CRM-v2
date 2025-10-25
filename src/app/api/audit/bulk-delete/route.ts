import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  try {
    // Require 'view_config' permission for bulk delete
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId, userId } = auth;
    const prisma = getTenantPrisma(tenantId);

    // Get IDs to delete from request body
    const { ids } = await request.json()

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return createErrorResponse('No IDs provided for deletion', 400)
    }

    console.log(`🗑️ Bulk deleting ${ids.length} audit logs for tenant ${tenantId}`)

    // Delete audit logs (auto-filtered by tenantPrisma)
    const result = await prisma.auditLog.deleteMany({
      where: {
        id: { in: ids }
      }
    })

    console.log(`✅ Deleted ${result.count} audit logs`)

    // Log this bulk deletion action itself
    try {
      await prisma.auditLog.create({
        data: {
          userId: userId,
          userName: auth.session?.user?.email || 'Unknown',
          userRole: auth.role,
          action: 'BULK_DELETE',
          entityType: 'audit_log',
          entityId: 'bulk',
          entityName: `${result.count} audit logs`,
          reason: `Bulk deletion of ${result.count} audit log records`,
          oldValues: {
            requestedIds: ids.length,
            idsToDelete: ids
          },
          newValues: {
            deletedCount: result.count
          }
        }
      })
    } catch (auditError) {
      console.error('⚠️ Failed to log bulk deletion audit:', auditError)
      // Don't fail the main operation if audit logging fails
    }

    return createSuccessResponse({
      deleted: result.count,
      message: `${result.count} registros eliminados exitosamente`
    })
  } catch (error) {
    console.error('Error in bulk delete audit logs:', error)
    return handleApiError(error)
  }
}

