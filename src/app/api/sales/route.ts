import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPI } from '@/lib/auth-helpers'
import { withTenantContext } from '@/lib/tenantContext'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { logCreate, logUpdate, logDelete } from '@/lib/auditLogger'
import { shouldUseSoftDeleteRestoreV2 } from '@/lib/feature-flags'
import { archiveOrder, OrderArchiveError } from '@/lib/order-archive'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId, userId, role } = auth

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName: 'System' }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId)
      
      const sales = await tenantPrisma.order.findMany({
        where: {
          saleDate: { not: null }
        },
        orderBy: { saleDate: 'desc' },
        take: 100 // Limit to last 100 sales
      })

      return createSuccessResponse(sales)
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId, userId, role } = auth

    const body = await request.json()

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName: 'System' }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId)
      
      // Create a new sale record with tenant isolation
      const sale = await tenantPrisma.order.create({
        data: {
          tenantId, // Ensure tenant ID is set
          orderId: body.orderId || `SALE-${Date.now()}`,
          orderType: body.orderType || 'EA',
          status: 'Completado',
          customerName: body.customerName || '',
          product: body.product || '',
          quantity: Number(body.quantity || 1),
          total: Number(body.total || 0),
          saleDate: new Date().toISOString(),
          timestamp: new Date(),
        }
      })

      // Log audit trail
      try {
        await logCreate(request, 'sale', sale.id, `Sale #${sale.orderId}`, sale)
      } catch (auditError) {
        console.error('Failed to log audit trail:', auditError)
      }

      return createSuccessResponse(sale, 'Sale created successfully')
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId, userId, role, session } = auth

    if (role !== 'OWNER' && role !== 'ADMIN') {
      return createErrorResponse('Forbidden — requires ADMIN or OWNER role to delete sales', 403)
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return createErrorResponse('Missing id parameter', 400)
    }

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName: 'System' }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId)
      
      // Find sale with tenant isolation
      const sale = await tenantPrisma.order.findFirst({ 
        where: { id }
      })
      
      if (!sale) {
        return createErrorResponse('Sale not found', 404)
      }

      const softDelete = await shouldUseSoftDeleteRestoreV2(tenantId)
      if (softDelete) {
        await archiveOrder({
          tenantId,
          orderId: id,
          actorUserId: userId,
          actorName: session?.user?.email || 'Unknown',
          actorRole: role,
          reason: 'Deleted from sales',
          source: 'sales-delete',
          expectedUpdatedAt: searchParams.get('expectedUpdatedAt') || undefined,
        })
      } else {
        // Legacy behavior remains behind the off-by-default feature flag.
        await tenantPrisma.order.delete({ where: { id } })

        try {
          await logDelete(request, 'sale', id, `Sale #${sale.orderId}`, sale)
        } catch (auditError) {
          console.error('Failed to log audit trail:', auditError)
        }
      }

      return createSuccessResponse(
        softDelete ? { archived: true } : null,
        softDelete ? 'Sale archived successfully' : 'Sale deleted successfully',
      )
    })
  } catch (error) {
    if (error instanceof OrderArchiveError) {
      return createErrorResponse(error.message, error.status)
    }
    return handleApiError(error)
  }
}
