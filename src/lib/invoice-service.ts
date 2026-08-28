import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { calculateIncludedIva } from '@/lib/invoice-calculation';
import { deliverInvoiceEmail } from '@/lib/invoice-email';

function invoiceItemsFromOrder(order: { product: string | null; productDetails: string | null; quantity: number; total: number }) {
  try {
    const details = JSON.parse(order.productDetails || '[]');
    if (Array.isArray(details) && details.length > 0) {
      const totalQuantity = details.reduce((sum, item) => sum + Math.max(1, Number(item?.cantidad || item?.quantity || 1)), 0);
      return details.map(item => {
        const quantity = Math.max(1, Number(item?.cantidad || item?.quantity || 1));
        const unitPrice = totalQuantity > 0 ? order.total / totalQuantity : order.total;
        return {
          description: String(item?.type || item?.name || order.product || 'Producto'),
          quantity,
          unitPrice,
          total: unitPrice * quantity,
        };
      });
    }
  } catch {
    // Legacy text product falls through to one conservative line.
  }
  const quantity = Math.max(1, order.quantity || 1);
  return [{
    description: order.product || 'Producto',
    quantity,
    unitPrice: order.total / quantity,
    total: order.total,
  }];
}

export async function createInvoiceForOrder(input: {
  tenantId: string;
  userId: string;
  orderReference: string;
  sourceOperationKey: string;
  sendEmail: boolean;
}) {
  const replay = await prisma.invoice.findFirst({
    where: { tenantId: input.tenantId, sourceOperationKey: input.sourceOperationKey },
    include: { tenant: { select: { name: true } } },
  });
  if (replay) {
    if (!input.sendEmail || replay.emailStatus === 'sent') {
      return { invoice: replay, idempotentReplay: true, delivery: replay.emailStatus };
    }
    if (!replay.customerEmail) {
      await prisma.invoice.updateMany({
        where: { id: replay.id, tenantId: input.tenantId },
        data: { emailStatus: 'failed', emailError: 'Customer email is missing' },
      });
      return { invoice: replay, idempotentReplay: true, delivery: 'failed', emailError: 'customer_email_missing' };
    }
    await prisma.invoice.updateMany({
      where: { id: replay.id, tenantId: input.tenantId },
      data: { emailStatus: 'sending', emailError: null },
    });
    try {
      const replayItems = Array.isArray(replay.items)
        ? replay.items.map(item => {
            const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
            return { description: row.description, quantity: row.quantity, unitPrice: row.unitPrice, total: row.total };
          })
        : [];
      const delivery = await deliverInvoiceEmail({
        invoiceNumber: replay.invoiceNumber,
        tenantName: replay.tenant.name,
        customerName: replay.customerName,
        recipient: replay.customerEmail,
        total: replay.total,
        currency: replay.currency,
        subtotal: replay.subtotal,
        tax: replay.tax,
        items: replayItems,
        idempotencyKey: `invoice:${input.tenantId}:${replay.id}:email`,
      });
      await prisma.invoice.updateMany({
        where: { id: replay.id, tenantId: input.tenantId },
        data: { emailStatus: 'sent', emailProviderId: delivery.providerId, emailedAt: new Date(), emailError: null },
      });
      return { invoice: replay, idempotentReplay: true, delivery: 'sent', providerId: delivery.providerId };
    } catch {
      await prisma.invoice.updateMany({
        where: { id: replay.id, tenantId: input.tenantId },
        data: { emailStatus: 'failed', emailError: 'Email delivery failed' },
      });
      return { invoice: replay, idempotentReplay: true, delivery: 'failed', emailError: 'provider_delivery_failed' };
    }
  }

  const order = await prisma.order.findFirst({
    where: {
      tenantId: input.tenantId,
      OR: [{ id: input.orderReference }, { orderId: input.orderReference }],
    },
    select: {
      id: true, orderId: true, customerName: true, email: true, phone: true,
      address: true, product: true, productDetails: true, quantity: true, total: true,
    },
  });
  if (!order) throw new Error('ORDER_NOT_FOUND');

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { name: true },
  });
  if (!tenant) throw new Error('TENANT_NOT_FOUND');
  const items = invoiceItemsFromOrder(order);
  const calculation = calculateIncludedIva(order.total, 0);
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const baseCount = await prisma.invoice.count({
    where: { tenantId: input.tenantId, createdAt: { gte: startOfMonth } },
  });

  let invoice: Awaited<ReturnType<typeof prisma.invoice.create>> | null = null;
  for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
    try {
      invoice = await prisma.invoice.create({
        data: {
          tenantId: input.tenantId,
          orderId: order.id,
          invoiceNumber: `${prefix}-${String(baseCount + attempt + 1).padStart(4, '0')}`,
          customerName: order.customerName,
          customerEmail: order.email || null,
          customerPhone: order.phone || null,
          customerAddress: order.address || null,
          items,
          subtotal: calculation.subtotal,
          tax: calculation.tax,
          discount: calculation.discount,
          total: calculation.total,
          calculationVersion: calculation.calculationVersion,
          currency: 'CRC',
          createdBy: input.userId,
          sourceOperationKey: input.sourceOperationKey,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.invoice.findFirst({
          where: { tenantId: input.tenantId, sourceOperationKey: input.sourceOperationKey },
        });
        if (raced) invoice = raced;
        else if (attempt === 4) throw error;
      } else {
        throw error;
      }
    }
  }
  if (!invoice) throw new Error('INVOICE_CREATE_FAILED');

  if (!input.sendEmail) return { invoice, idempotentReplay: false, delivery: 'not_requested' };
  if (!order.email) {
    await prisma.invoice.updateMany({
      where: { id: invoice.id, tenantId: input.tenantId },
      data: { emailStatus: 'failed', emailError: 'Customer email is missing' },
    });
    return { invoice, idempotentReplay: false, delivery: 'failed', emailError: 'customer_email_missing' };
  }

  await prisma.invoice.updateMany({
    where: { id: invoice.id, tenantId: input.tenantId },
    data: { emailStatus: 'sending', emailError: null },
  });
  try {
    const delivery = await deliverInvoiceEmail({
      invoiceNumber: invoice.invoiceNumber,
      tenantName: tenant.name,
      customerName: invoice.customerName,
      recipient: order.email,
      total: invoice.total,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      items,
      idempotencyKey: `invoice:${input.tenantId}:${invoice.id}:email`,
    });
    await prisma.invoice.updateMany({
      where: { id: invoice.id, tenantId: input.tenantId },
      data: { emailStatus: 'sent', emailProviderId: delivery.providerId, emailedAt: new Date(), emailError: null },
    });
    return { invoice, idempotentReplay: false, delivery: 'sent', providerId: delivery.providerId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email delivery failed';
    await prisma.invoice.updateMany({
      where: { id: invoice.id, tenantId: input.tenantId },
      data: { emailStatus: 'failed', emailError: message.slice(0, 500) },
    });
    return { invoice, idempotentReplay: false, delivery: 'failed', emailError: 'provider_delivery_failed' };
  }
}
