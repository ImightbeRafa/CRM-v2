import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPI } from '@/lib/auth-helpers';
import { withTenantContext } from '@/lib/tenantContext';
import { calculateIncludedIva, invoiceGrossFromItems } from '@/lib/invoice-calculation';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';

    return await withTenantContext({ tenantId, userId, role: (token as any)?.membershipRole, userRole: (token as any)?.membershipRole, userName }, async () => {
      // SECURITY: Always use tenant-isolated client
      const prisma = getTenantPrisma(tenantId);

      const invoiceData = await request.json();

      // Validate required fields
      if (!invoiceData.customerName || !invoiceData.items || invoiceData.items.length === 0) {
        return NextResponse.json(
          { error: 'Customer name and items are required' },
          { status: 400 }
        );
      }

      // CRITICAL: Validate orderId exists and belongs to this tenant
      let linkedOrder: { id: string; tenantId: string; total: number } | null = null;
      if (invoiceData.orderId) {
        linkedOrder = await prisma.order.findUnique({
          where: { id: invoiceData.orderId },
          select: { id: true, tenantId: true, total: true }
        });

        if (!linkedOrder) {
          console.error(`[Invoice Generate] Order not found: ${invoiceData.orderId}`);
          return NextResponse.json(
            { error: 'Order not found. Please ensure the order exists.' },
            { status: 400 }
          );
        }

        if (linkedOrder.tenantId !== tenantId) {
          console.error(`[Invoice Generate] Tenant isolation breach attempt for order ${invoiceData.orderId}`);
          return NextResponse.json(
            { error: 'Order not found' },
            { status: 404 }
          );
        }
      }

      // Generate invoice number
      const currentYear = new Date().getFullYear();
      const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
      
      // Get count of invoices this month for this tenant
      const startOfMonth = new Date(currentYear, new Date().getMonth(), 1);
      const invoiceCount = await prisma.invoice.count({
        where: {
          createdAt: {
            gte: startOfMonth
          }
        }
      });

      const invoiceNumber = `INV-${currentYear}${currentMonth}-${String(invoiceCount + 1).padStart(4, '0')}`;

      const calculation = calculateIncludedIva(
        linkedOrder?.total ?? invoiceGrossFromItems(invoiceData.items),
        invoiceData.discount || 0,
      );

      // Create invoice with server-owned, IVA-inclusive arithmetic.
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          ...(invoiceData.orderId && {
            order: { connect: { id: invoiceData.orderId } }
          }),
          customerName: invoiceData.customerName,
          customerEmail: invoiceData.customerEmail || null,
          customerPhone: invoiceData.customerPhone || null,
          customerAddress: invoiceData.customerAddress || null,
          customerIdNumber: invoiceData.customerIdNumber || null,
          items: invoiceData.items,
          subtotal: calculation.subtotal,
          tax: calculation.tax,
          discount: calculation.discount,
          total: calculation.total,
          calculationVersion: calculation.calculationVersion,
          paymentStatus: invoiceData.paymentStatus || 'pending',
          paymentMethod: invoiceData.paymentMethod || null,
          notes: invoiceData.notes || null,
          dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : null,
          currency: invoiceData.currency || 'CRC',
          createdBy: userId || 'system',
          tenant: {
            connect: { id: tenantId }
          }
        }
      });

      console.log(`[Invoice Generate] Created invoice ${invoiceNumber} for tenant ${tenantId}`);

      return NextResponse.json({
        status: 'success',
        data: invoice
      });
    });
  } catch (error) {
    console.error('Error generating invoice:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoice' },
      { status: 500 }
    );
  }
}

