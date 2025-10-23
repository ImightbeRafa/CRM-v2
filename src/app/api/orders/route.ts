import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPI } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { logCreate } from '@/lib/auditLogger'

// Function to update inventory when an order is created
async function updateInventoryForOrder(order: any, tenantPrisma: any) {
  console.log('Updating inventory for order:', {
    orderId: order.orderId,
    product: order.product,
    quantity: order.quantity,
    productDetails: order.productDetails
  })

  // Try to use detailed product information first
  if (order.productDetails) {
    try {
      const productDetails = JSON.parse(order.productDetails)
      console.log('Parsed product details:', productDetails)
      
      for (const product of productDetails) {
        await updateInventoryForProduct(product, tenantPrisma)
      }
      return
    } catch (error) {
      console.error('Failed to parse product details:', error)
    }
  }

  // Fallback to old method if productDetails is not available
  if (!order.product || !order.quantity) {
    console.log('No products or quantity to update inventory for')
    return
  }

  // Parse products from the comma-separated string (these are product types)
  const productTypes = order.product.split(',').map((p: string) => p.trim())
  
  for (let i = 0; i < productTypes.length; i++) {
    const productType = productTypes[i]
    if (!productType) continue

    await updateInventoryForProduct({
      type: productType,
      cantidad: 1, // Default to 1 if we don't have detailed info
      color: '',
      tamano: '',
      productCost: 0
    }, tenantPrisma)
  }
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
      
      console.log(`Checking match for "${productType}" vs SKU:"${itemSku}" Category:"${itemCategory}" Name:"${itemName}" Desc:"${itemDesc}": sku=${skuMatch}, category=${categoryMatch}, name=${nameMatch}, desc=${descMatch}`)
      
      return skuMatch || categoryMatch || nameMatch || descMatch
    })

    console.log(`Found ${matchingItems.length} matching items for product type: ${type}`)
    
    // If no exact matches, try fuzzy matching for common product types
    let finalMatches = matchingItems
    if (matchingItems.length === 0) {
      console.log('No exact matches found, trying fuzzy matching...')
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
        console.log(`Found ${fuzzyMatches.length} fuzzy matches`)
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
      console.log('Available inventory items:', inventoryItems.map(item => ({ 
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
    const tenantPrisma = getTenantPrisma(tenantId)
    
    // Get orders (automatically filtered by tenantId!)
    const orders = await tenantPrisma.order.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100 // Limit to last 100 orders
    })

    return createSuccessResponse(orders)
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request)
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const tenantPrisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    
    // Create a new order (tenantId auto-injected!)
    const order = await tenantPrisma.order.create({
      data: {
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
        comments: body.comments || '',
        total: Number(body.total || 0),
        iva: Number(body.iva || 0),
        shippingCost: Number(body.shippingCost || 0),
        productCost: Number(body.productCost || 0),
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
        timestamp: new Date()
      }
    })

    // Update inventory stock for products in the order
    try {
      await updateInventoryForOrder(order, tenantPrisma)
    } catch (inventoryError) {
      console.error('Failed to update inventory:', inventoryError)
      // Don't fail the order creation if inventory update fails
    }

    // Log audit trail
    try {
      await logCreate(request, 'order', order.id, `Order #${order.orderId}`, order)
    } catch (auditError) {
      console.error('Failed to log audit trail:', auditError)
    }

    return createSuccessResponse(order, 'Order created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}
