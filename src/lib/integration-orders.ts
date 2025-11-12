import { prisma } from './db';
import { ExternalOrderData } from '@/types/integration';

export async function createExternalOrder(tenantId: string, orderData: ExternalOrderData) {
  // Use comments from metadata if provided, otherwise leave empty
  const comments = orderData.metadata?.comments || '';

  // Map external order data to internal Order model
  const order = await prisma.order.create({
    data: {
      tenantId,
      orderId: orderData.orderId,
      customerName: orderData.customer.name,
      phone: orderData.customer.phone,
      email: orderData.customer.email,
      product: orderData.product.name,
      quantity: orderData.product.quantity,
      productCost: parsePrice(orderData.product.unitPrice),
      total: parsePrice(orderData.total),
      shippingCost: parsePrice(orderData.shipping.cost),
      province: orderData.shipping.address.province,
      canton: orderData.shipping.address.canton,
      district: orderData.shipping.address.district,
      address: orderData.shipping.address.fullAddress,
      orderType: 'EA', // External orders are typically shipping orders
      status: 'Pendiente', // Default status for new orders (order fulfillment status)
      saleDate: new Date().toISOString().split('T')[0],
      comments: comments,
      // Store original external data as custom fields
      customFields: {
        external: true,
        source: orderData.source,
        originalData: orderData.metadata,
        paymentMethod: orderData.payment.method,
        paymentStatus: orderData.payment.status,
        paymentTransactionId: orderData.payment.transactionId,
        paymentDate: orderData.payment.date,
      },
    },
  });

  return order;
}

export async function checkDuplicateOrder(tenantId: string, orderId: string): Promise<boolean> {
  const existing = await prisma.order.findFirst({
    where: {
      tenantId,
      orderId,
    },
  });

  return !!existing;
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

  return prisma.order.findMany({
    where,
    orderBy: {
      timestamp: 'desc',
    },
    take: limit,
    skip: offset,
  });
}

// Helper function to parse price strings like "₡9.900" or "GRATIS"
function parsePrice(priceStr: string): number {
  if (priceStr.toLowerCase() === 'gratis' || priceStr.toLowerCase() === 'free') {
    return 0;
  }

  // Remove currency symbols and spaces, then parse
  const cleanPrice = priceStr.replace(/[₡$,\s]/g, '');
  const parsed = parseFloat(cleanPrice);
  
  return isNaN(parsed) ? 0 : parsed;
}

export async function updateExternalOrderStatus(
  tenantId: string,
  orderId: string,
  status: string
): Promise<boolean> {
  try {
    await prisma.order.updateMany({
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
