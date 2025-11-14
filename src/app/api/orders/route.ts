import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPI } from '@/lib/auth-helpers'
import { withTenantContext } from '@/lib/tenantContext'
import { getToken } from 'next-auth/jwt'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { logCreate } from '@/lib/auditLogger'
import { checkOrderLimit } from '@/lib/plan-enforcement'

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
    // Find inventory items that match this product type (tenant-filtered automatically!)
    const inventoryItems = await tenantPrisma.inventoryItem.findMany({
      where: {
        isActive: true
      }
    })
    
    // Filter by SKU/código match first, then fallback to name/description/category
    const matchingItems = inventoryItems.filter((item: any) => {
      const itemSku = item.sku?.toLowerCase() || ''
      const itemName = item.name.toLowerCase()
      const itemDesc = item.description?.toLowerCase() || ''
      const itemCategory = item.category?.toLowerCase() || ''
      const productType = type.toLowerCase()
      
      // First try: Match by SKU/código (most reliable)
      const skuMatch = itemSku.includes(productType) || productType.includes(itemSku)
      
      // Second try: Match by category (very reliable for product types)
      const categoryMatch = itemCategory.includes(productType) || productType.includes(itemCategory)
      
      // Third try: Match by name
      const nameMatch = itemName.includes(productType) || productType.includes(itemName)
      
      // Fourth try: Match by description
      const descMatch = itemDesc.includes(productType) || productType.includes(itemDesc)
      
      return skuMatch || categoryMatch || nameMatch || descMatch
    })
    
    // If no exact matches, try fuzzy matching for common product types
    let finalMatches = matchingItems
    if (matchingItems.length === 0) {
      const fuzzyMatches = inventoryItems.filter((item: any) => {
        const itemName = item.name.toLowerCase()
        const itemDesc = item.description?.toLowerCase() || ''
        const productType = type.toLowerCase()
        
        // Common product type mappings
        const typeMappings = {
          'tumblr': ['termo', 'taza', 'mug', 'vaso'],
          'camiseta': ['camiseta', 'shirt', 'playera'],
          'pantalon': ['pantalón', 'pants', 'jean'],
          'vestido': ['vestido', 'dress'],
          'zapatos': ['zapatos', 'shoes', 'zapato']
        }
        
        // Check if any mapped terms match
        const mappedTerms = (typeMappings as any)[productType] || []
        return mappedTerms.some((term: string) => 
          itemName.includes(term) || itemDesc.includes(term) ||
          term.includes(itemName) || term.includes(itemDesc)
        )
      })
      
      if (fuzzyMatches.length > 0) {
        finalMatches = fuzzyMatches
      }
    }

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
      console.warn(`❌ No inventory item found for product type: ${type}`)
      console.log('Available inventory items:', inventoryItems.map((item: any) => ({ 
        name: item.name, 
        description: item.description,
        currentStock: item.currentStock 
      })))
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
    
    const { tenantId } = auth
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    const userId = (token as any)?.sub as string | undefined
    const userName = (token as any)?.name || (token as any)?.email || 'System'

    return await withTenantContext({ tenantId, userId, role: (token as any)?.membershipRole, userRole: (token as any)?.membershipRole, userName }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId)

      // Get query parameters for pagination and filtering
      const { searchParams } = new URL(request.url)
      const page = parseInt(searchParams.get('page') || '1')
      const limitParam = searchParams.get('limit')
      const limit = limitParam === 'all' ? undefined : Math.min(parseInt(limitParam || '100'), 500) // Support 'all' for unlimited results
      const skip = limit ? (page - 1) * limit : 0
      const status = searchParams.get('status')
      const orderType = searchParams.get('orderType')
      const search = searchParams.get('search')
      const dateFrom = searchParams.get('dateFrom')
      const dateTo = searchParams.get('dateTo')

      console.log('[GET /api/orders] Fetching orders for tenant:', tenantId, { status, orderType, search })
      
      // Build where clause for filtering (tenantId will be auto-injected by middleware)
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
          // Exclude only the heaviest field: productDetails (can be loaded separately if needed)
        }
    })
    
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
    
    const { tenantId } = auth
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    const userId = (token as any)?.sub || (auth as any).userId
    const userName = (token as any)?.name || (token as any)?.email || 'System'
    const tenantPrisma = getTenantPrisma(tenantId)
    const body = await request.json()

    // Separate known order fields from dynamic custom fields
    const knownKeys = new Set([
      'orderId','orderType','status','delivery','customerName','username','phone','email','business','product','quantity','size','color','packaging','customization','comments','total','iva','shippingCost','productCost','funnel','address','province','canton','district','courier','expectedDate','saleDate','agreedDate','pickupDate','seller','productDetails','timestamp','customFields'
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

     // Map comments from dynamic custom fields
     const commentKeywords = ['comentario','comentarios','comment','comments','observacion','observaciones','nota','notas','note','notes','descripcion','description']
     let commentValue: string | undefined
     
     for (const k of Object.keys(customFields)) {
       if (commentKeywords.some(w => k.toLowerCase().includes(w))) {
         const v = (customFields as any)[k]
         if (v !== undefined && v !== null && String(v).trim() !== '') { 
           commentValue = String(v).trim()
           break 
         }
       }
     }

    // Check plan limits (soft enforcement with clear messaging)
    const limitCheck = await checkOrderLimit(tenantId)
    if (!limitCheck.allowed) {
      return NextResponse.json({
        status: 'error',
        error: limitCheck.message,
        needsUpgrade: true,
        currentPlan: limitCheck.currentPlan,
        currentCount: limitCheck.currentCount,
        limit: limitCheck.limit
      }, { status: 402 }) // 402 Payment Required
    }
    
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
        customFields: Object.keys(customFields).length > 0 ? customFields : undefined
      } as any)
    })

     // Order created successfully

    // Update inventory and audit log in parallel (non-blocking)
    Promise.all([
      updateInventoryForOrder(order, tenantPrisma).catch(err => {
        console.error('Failed to update inventory:', err)
      }),
      logCreate(request, 'order', order.id, `Order #${order.orderId}`, order).catch(err => {
        console.error('Failed to log audit trail:', err)
      })
    ]).catch(() => {}) // Ignore errors, don't block response

    return createSuccessResponse(order, 'Order created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}
