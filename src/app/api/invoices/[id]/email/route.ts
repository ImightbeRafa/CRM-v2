import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { deliverInvoiceEmail } from '@/lib/invoice-email';
import { z } from 'zod';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response;
    const { tenantId } = auth;

    const emailResult = z.string().email().safeParse((await request.json()).email);

    if (!emailResult.success) {
      return NextResponse.json({ error: 'Valid email address required' }, { status: 400 });
    }
    const email = emailResult.data;

    // Get invoice
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId: tenantId
      },
      include: {
        tenant: {
          select: {
            name: true
          }
        }
      }
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    await prisma.invoice.updateMany({
      where: { id: invoice.id, tenantId },
      data: { emailStatus: 'sending', emailError: null },
    });
    try {
      const delivery = await deliverInvoiceEmail({
        invoiceNumber: invoice.invoiceNumber,
        tenantName: invoice.tenant.name,
        customerName: invoice.customerName,
        recipient: email,
        total: invoice.total,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        items: Array.isArray(invoice.items)
          ? invoice.items.map(item => {
              const row = item && typeof item === 'object' && !Array.isArray(item)
                ? item as Record<string, unknown>
                : {};
              return { description: row.description, quantity: row.quantity, unitPrice: row.unitPrice, total: row.total };
            })
          : [],
      });
      await prisma.invoice.updateMany({
        where: { id: invoice.id, tenantId },
        data: { emailStatus: 'sent', emailProviderId: delivery.providerId, emailedAt: new Date(), emailError: null },
      });
      return NextResponse.json({ status: 'success', delivery: 'sent', providerId: delivery.providerId });
    } catch (deliveryError) {
      const message = deliveryError instanceof Error ? deliveryError.message : 'Email delivery failed';
      await prisma.invoice.updateMany({
        where: { id: invoice.id, tenantId },
        data: { emailStatus: 'failed', emailError: message.slice(0, 500) },
      });
      return NextResponse.json({ status: 'error', code: 'email_not_sent', error: message }, { status: 502 });
    }
  } catch (error) {
    console.error('Error emailing invoice:', error);
    return NextResponse.json(
      { error: 'Failed to email invoice' },
      { status: 500 }
    );
  }
}

