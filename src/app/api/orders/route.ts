import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPI } from '@/lib/auth-helpers'
import { withTenantContext } from '@/lib/tenantContext'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { logCreate } from '@/lib/auditLogger'
import { ORDER_COMMENT_FIELD_ALIASES, resolveOrderComment } from '@/lib/order-comments'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Function to update inventory when an order is created (optimized)
async function updateInventoryForOrder(order: any, tenantPrisma: any) {
  // Only log in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Inventory] Updating for order:', order.orderId)
  }

  // Try to use detailed product information first
  if (order.productDetails) {
    try {
      const productDetails = JSON.parse(order.productDetails)
      // Process inventory updates in parallel for speed
      await Promise.all(
        productDetails.map((product: any) => 
          updateInventoryForProduct(product, tenantPrisma).catch(err => {
            console.error('[Inventory] Failed to update:', err)
          })
        )
      )
      return
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[Inventory] Failed to parse product details:', error)
      }
    }
  }

  // Fallback to old method if productDetails is not available
  if (!order.product || !order.quantity) {
    return
  }

  // Parse products from the comma-separated string
  const productTypes = order.product.split(',')
    .map((p: string) => p.trim())
    .filter(Boolean)
  
  // Process inventory updates in parallel for speed
  await Promise.all(
    productTypes.map((productType: string) => 
      updateInventoryForProduct({
        type: productType,
        cantidad: 1,
        color: '',
        tamano: '',
        productCost: 0
      }, tenantPrisma).catch(err => {
        console.error('[Inventory] Failed to update:', err)
      })
    )
  )
}

// Helper function to update inventory for a single product
async function updateInventoryForProduct(product: any, tenantPrisma: any) {
  const { type, cantidad, color, tamano } = product
  
  try {
    const productType = type.toLowerCase()

    // Query DB with filters instead of loading all items into memory
    const matchingItems = await tenantPrisma.inventoryItem.findMany({
      where: {
        isActive: true,
        OR: [
          { sku: { contains: productType, mode: 'insensitive' } },
          { category: { contains: productType, mode: 'insensitive' } },
          { name: { contains: productType, mode: 'insensitive' } },
          { description: { contains: productType, mode: 'insensitive' } },
        ],
      },
    })

    let finalMatches = matchingItems

    // Update the first matching item
    if (finalMatches.length > 0) {
      const item = finalMatches[0]
      const quantityToDeduct = cantidad || 1
      const newStock = Math.max(0, item.currentStock - quantityToDeduct)
      
      await tenantPrisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          currentStock: newStock,
          totalSold: item.totalSold + quantityToDeduct,
          lastSold: new Date(),
          lastUpdated: new Date()
        }
      })
      
      console.log(`✅ Updated inventory for ${type}: ${item.currentStock} -> ${newStock} (deducted ${quantityToDeduct})`)
    } else {
      console.warn(`No inventory match for product type: ${type}`)
    }
  } catch (error) {
    console.error(`Failed to update inventory for product type ${type}:`, error)
  }
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId, userId, role } = auth

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName: 'System' }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId)

      // Get query parameters for pagination and filtering
      const { searchParams } = new URL(request.url)
      const page = parseInt(searchParams.get('page') || '1')
      const limitParam = searchParams.get('limit')
      const limit = limitParam === 'all' ? 5000 : Math.min(parseInt(limitParam || '100'), 500)
      const skip = limit ? (page - 1) * limit : 0
      const status = searchParams.get('status')
      const orderType = searchParams.get('orderType')
      const search = searchParams.get('search')
      const dateFrom = searchParams.get('dateFrom')
      const dateTo = searchParams.get('dateTo')

      console.log(`[GET /api/orders] Tenant ${tenantId}`, { status, orderType, search })
      
      // Build where clause for filtering (tenant filter auto-injected by middleware)
      const whereClause: any = {}
      if (status && status !== 'all') whereClause.status = status
      if (orderType && orderType !== 'all') whereClause.orderType = orderType
      
      // Add search filter
      if (search) {
        whereClause.OR = [
          { customerName: { contains: search, mode: 'insensitive' } },
          { orderId: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { product: { contains: search, mode: 'insensitive' } },
        ]
      }
      
      // Add date range filter
      if (dateFrom || dateTo) {
        whereClause.timestamp = {}
        if (dateFrom) whereClause.timestamp.gte = new Date(dateFrom)
        if (dateTo) whereClause.timestamp.lte = new Date(dateTo)
      }
      
      // Get total count for pagination - using tenant-isolated client
      const totalCount = await tenantPrisma.order.count({ where: whereClause })
      
      // Fetch only essential fields to reduce payload - using tenant-isolated client
      const orders = await tenantPrisma.order.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        skip,
        ...(limit && { take: limit }), // Only add take if limit is defined
        select: {
          id: true,
          orderId: true,
          orderType: true,
          status: true,
          timestamp: true,
          customerName: true,
          username: true, // Social media username for customer
          phone: true,
          email: true,
          business: true,
          product: true,
          quantity: true,
          size: true,
          color: true,
          packaging: true,
          customization: true,
          comments: true,
          total: true,
          iva: true,
          shippingCost: true,
          productCost: true,
          address: true,
          province: true,
          canton: true,
          district: true,
          courier: true,
          expectedDate: true,
          funnel: true,
          agreedDate: true,
          pickupDate: true,
          saleDate: true,
          seller: true,
          delivery: true,
          customFields: true, // Custom fields JSON data
          contraEntrega: true,
          cePaymentConfirmed: true,
          tenantId: true, // Include for security verification
          // Exclude only the heaviest field: productDetails (can be loaded separately if needed)
        }
    })
    
    // Security logging - verify all orders belong to this tenant
    if (process.env.NODE_ENV !== 'production') {
      const wrongTenantOrders = orders.filter((o: any) => o.tenantId !== tenantId);
      if (wrongTenantOrders.length > 0) {
        console.error('🚨 CRITICAL TENANT ISOLATION BREACH in /api/orders:', {
          requestedTenant: tenantId,
          breachedOrders: wrongTenantOrders.map((o: any) => ({ 
            orderId: o.orderId, 
            tenantId: o.tenantId,
            customerName: o.customerName 
          }))
        });
      }
    }
    
    console.log(`[GET /api/orders] Returning ${orders.length} orders for tenant ${tenantId}`)
      
      // Return orders with pagination metadata - NO CACHE HEADERS
      const response = NextResponse.json({
        status: 'success',
        data: orders,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: limit ? Math.ceil(totalCount / limit) : 1,
          hasMore: skip + orders.length < totalCount
        }
      })
      
      // DISABLE caching to ensure fresh data
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      response.headers.set('Pragma', 'no-cache')
      response.headers.set('Expires', '0')
      
      return response
    })
  } catch (error) {
    console.error('[GET /api/orders] Error:', error)
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId, userId, role } = auth
    const userName = auth.session?.user?.name || auth.session?.user?.email || userId || 'System'
    const tenantPrisma = getTenantPrisma(tenantId)
    const body = await request.json()

    // Separate known order fields from dynamic custom fields
    const knownKeys = new Set([
      'orderId','orderType','status','delivery','customerName','username','phone','email','business','product','quantity','size','color','packaging','customization','comments','total','iva','shippingCost','productCost','funnel','address','province','canton','district','courier','expectedDate','saleDate','agreedDate','pickupDate','seller','productDetails','timestamp','customFields','contraEntrega','cePaymentConfirmed',
      ...ORDER_COMMENT_FIELD_ALIASES
    ])
    const customFields: Record<string, any> = {}
    for (const [k,v] of Object.entries(body)) {
      if (!knownKeys.has(k)) {
        customFields[k] = v
      }
    }

    // If client sent a customFields object, merge it in
    if (body?.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)) {
      for (const [k, v] of Object.entries(body.customFields as any)) {
        customFields[k] = v
      }
    }

     // Minimal logging for production performance
     if (process.env.NODE_ENV === 'development') {
       console.log('[Order.create] Creating order:', body.orderId)
     }

     // Map seller/order comments into the canonical Order.comments column.
     const commentValue = resolveOrderComment(body, customFields)

    // Calculate total on server side to ensure accuracy
    const productCost = Number(body.productCost || 0);
    const shippingCost = Number(body.shippingCost || 0);
    const iva = Number(body.iva || 0);
    const calculatedTotal = productCost + shippingCost + iva;
    
    // Use calculated total if client didn't provide one or sent 0
    const finalTotal = (body.total && Number(body.total) > 0) 
      ? Number(body.total) 
      : calculatedTotal;
    
    // Create a new order with explicit tenantId
    console.log('[POST /api/orders] Creating order:', {
      orderId: body.orderId || `ORDER-${Date.now()}`,
      customerName: body.customerName,
      tenantId,
      sessionUserId: userId,
      sessionUserName: userName
    });
    
    // Additional security check - log if user email doesn't match seller
    if (body.seller && userName && body.seller !== userName) {
      console.warn('[POST /api/orders] ⚠️ Seller name mismatch:', {
        sessionUser: userName,
        orderSeller: body.seller,
        orderId: body.orderId
      });
    }
    
    const order = await tenantPrisma.order.create({
      data: ({
        tenantId,
        orderId: body.orderId || `ORDER-${Date.now()}`,
        orderType: body.orderType || 'EA',
        status: body.status || 'Pendiente',
        delivery: body.delivery || 'Pendiente',
        customerName: body.customerName || 'Cliente sin nombre',
        username: body.username || '',
        phone: body.phone || '',
        email: body.email || '',
        business: body.business || '',
        product: body.product || '',
        quantity: Number(body.quantity || 0),
        size: body.size || '',
        color: body.color || '',
        packaging: body.packaging || '',
        customization: body.customization || '',
        comments: commentValue || '',
        total: finalTotal, // Use server-calculated total
        iva: iva,
        shippingCost: shippingCost,
        productCost: productCost,
        funnel: body.funnel || '',
        address: body.address || '',
        province: body.province || '',
        canton: body.canton || '',
        district: body.district || '',
        courier: body.courier || '',
        expectedDate: body.expectedDate || '',
        saleDate: body.saleDate ? new Date(body.saleDate).toISOString() : new Date().toISOString(),
        agreedDate: body.agreedDate || '',
        pickupDate: body.pickupDate || '',
        seller: body.seller || '',
        productDetails: body.productDetails || '',
        timestamp: new Date(),
        customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
        contraEntrega: body.contraEntrega === true,
        cePaymentConfirmed: false,
      } as any)
    })
    
    console.log('[POST /api/orders] ✅ Order created successfully:', {
      orderId: order.orderId,
      id: order.id,
      customerName: order.customerName,
      tenantId: order.tenantId
    });

    // Update inventory and audit log in parallel (non-blocking, fire-and-forget)
    // Don't await - let these run in background to speed up response
    setImmediate(() => {
      Promise.all([
        updateInventoryForOrder(order, tenantPrisma).catch(err => {
          console.error('Failed to update inventory:', err)
        }),
        logCreate(request, 'order', order.id, `Order #${order.orderId}`, order).catch(err => {
          console.error('Failed to log audit trail:', err)
        })
      ]).catch(() => {}) // Ignore errors, don't block response
    })

    return createSuccessResponse(order, 'Order created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}
