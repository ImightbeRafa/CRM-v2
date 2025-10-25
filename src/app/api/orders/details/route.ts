import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { getToken } from 'next-auth/jwt';

export async function GET(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    const userId = (token as any)?.sub || (auth as any).userId
    const userName = (token as any)?.name || (token as any)?.email || 'System'

    // Get order ID from query parameters
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('id')
    
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    return await withTenantContext({ tenantId, userId, role: (token as any)?.membershipRole, userRole: (token as any)?.membershipRole, userName }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId)
      
      // Fetch full order details with all fields
      const order = await tenantPrisma.order.findFirst({
        where: { 
          tenantId,
          id: orderId
        }
      })
      
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      
      return NextResponse.json({
        status: 'success',
        data: order
      })
    })
  } catch (error) {
    console.error('Error fetching order details:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order details' },
      { status: 500 }
    )
  }
}
