import { getTenantPrisma } from './prisma-tenant';
import { ExternalOrderData } from '@/types/integration';
import { shouldUseOrderLifecycleV2 } from '@/lib/feature-flags';
import { createLifecycleOrder } from '@/lib/order-lifecycle';
import { mapWebsiteOrderCreate } from '@/lib/website-order-map';
import { websiteProductDetails } from '@/lib/orders/exact-item';
import { parseWebsiteItems, websiteItemsDetails } from '@/lib/orders/website-items';

export async function createExternalOrder(tenantId: string, orderData: ExternalOrderData) {
  console.log(`[createExternalOrder] Starting for tenant ${tenantId}, order ${orderData.orderId}`);

  try {
    // Use tenant-isolated Prisma client for security
    const tenantPrisma = getTenantPrisma(tenantId);
    const mapped = mapWebsiteOrderCreate(orderData);
    // A cart of 2+ items wins over the single-item SKU details.
    const productDetails = websiteCartDetails(orderData) ?? await websiteExactDetails(tenantId, orderData);
    const customFields = {
      external: true,
      source: orderData.source,
      originalData: orderData.metadata,
      paymentMethod: orderData.payment?.method,
      paymentStatus: orderData.payment?.status,
      paymentTransactionId: orderData.payment?.transactionId,
      paymentDate: orderData.payment?.date,
    };

    if (await shouldUseOrderLifecycleV2(tenantId, 'website')) {
      const lifecycle = await createLifecycleOrder({
        tenantId,
        userId: 'website-integration',
        adapter: 'website',
        idempotencyKey: `website:create:${orderData.orderId}`,
        data: {
          tenantId,
          orderId: orderData.orderId,
          customerName: orderData.customer.name,
          phone: orderData.customer.phone,
          email: orderData.customer.email || '',
          product: orderData.product.name,
          quantity: orderData.product.quantity,
          ...(productDetails ? { productDetails } : {}),
          productCost: mapped.productCost,
          total: mapped.total,
          shippingCost: mapped.shippingCost,
          province: mapped.province,
          canton: mapped.canton,
          district: mapped.district,
          address: mapped.address,
          courier: mapped.courier,
          salesChannel: orderData.salesChannel,
          seller: orderData.seller,
          orderType: mapped.orderType,
          pickupDate: mapped.pickupDate,
          agreedDate: mapped.agreedDate,
          status: 'Pendiente',
          saleDate: new Date().toISOString().split('T')[0],
          comments: mapped.comments,
          customFields,
        },
      });
      return {
        id: lifecycle.order.id,
        orderId: lifecycle.order.orderId,
        customerName: lifecycle.order.customerName,
      };
    }

    // Map external order data to internal Order model
    const order = await tenantPrisma.order.create({
      data: {
        tenantId,
        orderId: orderData.orderId,
        customerName: orderData.customer.name,
        phone: orderData.customer.phone,
        email: orderData.customer.email,
        product: orderData.product.name,
        quantity: orderData.product.quantity,
        ...(productDetails ? { productDetails } : {}),
        productCost: mapped.productCost,
        total: mapped.total,
        shippingCost: mapped.shippingCost,
        province: mapped.province,
        canton: mapped.canton,
        district: mapped.district,
        address: mapped.address,
        courier: mapped.courier,
        salesChannel: orderData.salesChannel,
        seller: orderData.seller,
        orderType: mapped.orderType,
        pickupDate: mapped.pickupDate,
        agreedDate: mapped.agreedDate,
        status: 'Pendiente',
        saleDate: new Date().toISOString().split('T')[0],
        comments: mapped.comments,
        customFields,
      },
      select: {
        id: true,
        orderId: true,
        customerName: true,
      }
    });

    console.log(`[createExternalOrder] Order created successfully: ${order.id}`);
    return order;
  } catch (error) {
    console.error(`[createExternalOrder] Failed to create order:`, error);
    throw error;
  }
}

/** Display-only rows for a website cart (stock keeps reading the product text; see website-items.ts). */
function websiteCartDetails(orderData: ExternalOrderData): string | null {
  const items = parseWebsiteItems(orderData.items) ?? parseWebsiteItems(orderData.lineItems) ?? parseWebsiteItems(orderData.products);
  return websiteItemsDetails(orderData.product.name, items);
}

/**
 * Optional `product.sku` from the store → the exact inventory item of THIS business (one active match only),
 * stored for display next to the site's own name. No sku, no match or ambiguous → no productDetails (as before).
 */
async function websiteExactDetails(tenantId: string, orderData: ExternalOrderData): Promise<string | null> {
  const sku = orderData.product.sku?.trim();
  if (!sku) return null;
  try {
    // Case-insensitive equals may become ILIKE: escape % _ \ so a sku is never a wildcard (INT-237), and
    // re-check the exact match here.
    const escaped = sku.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await getTenantPrisma(tenantId).inventoryItem.findMany({
      where: { tenantId, isActive: true, sku: { equals: escaped, mode: 'insensitive' } },
      select: { id: true, name: true, sku: true },
      take: 2,
    });
    const matches = rows.filter((row) => row.sku.toLowerCase() === sku.toLowerCase());
    return websiteProductDetails(orderData.product, matches.length === 1 && rows.length === 1 ? matches[0] : null);
  } catch (error) {
    console.warn('[createExternalOrder] sku lookup skipped', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function checkDuplicateOrder(tenantId: string, orderId: string): Promise<boolean> {
  console.log(`[checkDuplicateOrder] Checking for order ${orderId} in tenant ${tenantId}`);
  
  try {
    // Use tenant-isolated Prisma client for security
    const tenantPrisma = getTenantPrisma(tenantId);
    
    const existing = await tenantPrisma.order.findFirst({
      where: {
        tenantId,
        orderId,
      },
      select: {
        id: true,
      }
    });

    const isDuplicate = !!existing;
    console.log(`[checkDuplicateOrder] Result: ${isDuplicate ? 'duplicate found' : 'no duplicate'}`);
    return isDuplicate;
  } catch (error) {
    console.error(`[checkDuplicateOrder] Error checking duplicate:`, error);
    throw error;
  }
}

export async function findExternalOrderByOrderId(tenantId: string, orderId: string) {
  const tenantPrisma = getTenantPrisma(tenantId);
  return tenantPrisma.order.findFirst({
    where: { tenantId, orderId },
    select: { id: true, orderId: true },
  });
}

/** Durable, cross-instance cap for successful website writes. Upstash also
 * limits attempts, while this DB check prevents serverless write amplification
 * if Redis is temporarily unavailable or not configured. */
export async function countRecentExternalOrders(tenantId: string, since: Date) {
  const tenantPrisma = getTenantPrisma(tenantId);
  return tenantPrisma.order.count({
    where: {
      tenantId,
      timestamp: { gte: since },
      customFields: { path: ['external'], equals: true },
    },
  });
}

export async function getExternalOrders(
  tenantId: string,
  options: {
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}
) {
  const { limit = 50, offset = 0, startDate, endDate } = options;

  // Use tenant-isolated Prisma client for security
  const tenantPrisma = getTenantPrisma(tenantId);

  const where: any = {
    tenantId,
    // Filter for external orders using customFields
    customFields: {
      path: ['external'],
      equals: true,
    },
  };

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = startDate;
    if (endDate) where.timestamp.lte = endDate;
  }

  return tenantPrisma.order.findMany({
    where,
    orderBy: {
      timestamp: 'desc',
    },
    take: limit,
    skip: offset,
  });
}

export async function updateExternalOrderStatus(
  tenantId: string,
  orderId: string,
  status: string
): Promise<boolean> {
  try {
    // Use tenant-isolated Prisma client for security
    const tenantPrisma = getTenantPrisma(tenantId);
    
    await tenantPrisma.order.updateMany({
      where: {
        tenantId,
        orderId,
        customFields: {
          path: ['external'],
          equals: true,
        },
      },
      data: {
        status,
      },
    });
    return true;
  } catch (error) {
    console.error('Error updating external order status:', error);
    return false;
  }
}
