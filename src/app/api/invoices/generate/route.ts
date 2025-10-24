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

    const invoiceData = await request.json();

    // Validate required fields
    if (!invoiceData.customerName || !invoiceData.items || invoiceData.items.length === 0) {
      return NextResponse.json(
        { error: 'Customer name and items are required' },
        { status: 400 }
      );
    }

    // Generate invoice number
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

    const invoiceNumber = `INV-${currentYear}${currentMonth}-${String(invoiceCount + 1).padStart(4, '0')}`;

    // Create invoice
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
        paymentStatus: invoiceData.paymentMethod || 'pending',
        paymentMethod: invoiceData.paymentMethod || null,
        notes: invoiceData.notes || null,
        dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : null,
        currency: invoiceData.currency || 'CRC',
        createdBy: token.sub as string
      }
    });

    return NextResponse.json({
      status: 'success',
      data: invoice
    });
  } catch (error) {
    console.error('Error generating invoice:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoice' },
      { status: 500 }
    );
  }
}

