import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const tenantId = user.memberships[0].tenantId;

    const { invoices: invoicesData } = await request.json();

    if (!invoicesData || !Array.isArray(invoicesData) || invoicesData.length === 0) {
      return NextResponse.json(
        { error: 'Invoices array is required' },
        { status: 400 }
      );
    }

    // Generate invoice numbers
    const currentYear = new Date().getFullYear();
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get count of invoices this month for this tenant
    const startOfMonth = new Date(currentYear, new Date().getMonth(), 1);
    const invoiceCount = await prisma.invoice.count({
      where: {
        tenantId,
        createdAt: {
          gte: startOfMonth
        }
      }
    });

    // Create invoices in batch
    const createdInvoices = [];
    for (let i = 0; i < invoicesData.length; i++) {
      const invoiceData = invoicesData[i];
      const invoiceNumber = `INV-${currentYear}${currentMonth}-${String(invoiceCount + i + 1).padStart(4, '0')}`;

      try {
        const invoice = await prisma.invoice.create({
          data: {
            tenantId,
            invoiceNumber,
            orderId: invoiceData.orderId || null,
            customerName: invoiceData.customerName,
            customerEmail: invoiceData.customerEmail || null,
            customerPhone: invoiceData.customerPhone || null,
            customerAddress: invoiceData.customerAddress || null,
            customerIdNumber: invoiceData.customerIdNumber || null,
            items: invoiceData.items,
            subtotal: invoiceData.subtotal,
            tax: invoiceData.tax,
            discount: invoiceData.discount || 0,
            total: invoiceData.total,
            paymentStatus: 'pending',
            paymentMethod: invoiceData.paymentMethod || null,
            notes: invoiceData.notes || null,
            dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : null,
            currency: invoiceData.currency || 'CRC',
            createdBy: token.sub as string
          }
        });
        createdInvoices.push(invoice);
      } catch (error) {
        console.error(`Error creating invoice ${i}:`, error);
      }
    }

    return NextResponse.json({
      status: 'success',
      data: createdInvoices,
      summary: {
        total: invoicesData.length,
        successful: createdInvoices.length,
        failed: invoicesData.length - createdInvoices.length
      }
    });
  } catch (error) {
    console.error('Error generating invoices:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoices' },
      { status: 500 }
    );
  }
}

