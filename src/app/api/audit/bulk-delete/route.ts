import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  try {
    // Get tenant from authenticated user
    const { getToken } = await import('next-auth/jwt')
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Get user's tenant
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        defaultTenantId: true,
        memberships: {
          where: { isActive: true },
          select: { tenantId: true, role: true },
          take: 1
        }
      }
    })

    if (!user || !user.memberships || user.memberships.length === 0) {
      return createErrorResponse('Unauthorized', 401)
    }

    const tenantId = user.memberships[0].tenantId || user.defaultTenantId

    // Get IDs to delete from request body
    const { ids } = await request.json()

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return createErrorResponse('No IDs provided for deletion', 400)
    }

    console.log(`🗑️ Bulk deleting ${ids.length} audit logs for tenant ${tenantId}`)

    // Delete audit logs (with tenant isolation - CRITICAL for security)
    const result = await prisma.auditLog.deleteMany({
      where: {
        id: { in: ids },
        tenantId: tenantId  // ← CRITICAL: Only delete logs from this tenant
      }
    })

    console.log(`✅ Deleted ${result.count} audit logs`)

    // Log this bulk deletion action itself
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: tenantId,
          userId: token.sub!,
          userName: token.email || 'Unknown',
          userRole: user.memberships[0].role,
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

