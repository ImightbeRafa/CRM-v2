import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPI } from '@/lib/auth-helpers';
import { withTenantContext } from '@/lib/tenantContext';

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

      const { invoices: invoicesData } = await request.json();

      if (!invoicesData || !Array.isArray(invoicesData) || invoicesData.length === 0) {
        return NextResponse.json(
          { error: 'Invoices array is required' },
          { status: 400 }
        );
      }

      // Validate all orderIds upfront (if provided)
      const orderIdsToValidate = invoicesData
        .map(inv => inv.orderId)
        .filter(Boolean);

      if (orderIdsToValidate.length > 0) {
        const validOrders = await prisma.order.findMany({
          where: {
            id: { in: orderIdsToValidate }
          },
          select: { id: true, tenantId: true }
        });

        const validOrderIds = new Set(validOrders.map(o => o.id));
        const invalidOrders = orderIdsToValidate.filter(id => !validOrderIds.has(id));

        if (invalidOrders.length > 0) {
          console.error(`[Bulk Invoice] Invalid order IDs: ${invalidOrders.join(', ')}`);
          return NextResponse.json(
            { error: `Invalid order IDs: ${invalidOrders.join(', ')}. Please ensure all orders exist.` },
            { status: 400 }
          );
        }

        // Check for tenant isolation breach
        const wrongTenantOrders = validOrders.filter(o => o.tenantId !== tenantId);
        if (wrongTenantOrders.length > 0) {
          console.error(`[Bulk Invoice] Tenant isolation breach attempt`);
          return NextResponse.json(
            { error: 'Some orders were not found' },
            { status: 404 }
          );
        }
      }

      // Generate invoice numbers
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

      // Create invoices in batch
      const createdInvoices = [];
      const errors = [];
      
      for (let i = 0; i < invoicesData.length; i++) {
        const invoiceData = invoicesData[i];
        const invoiceNumber = `INV-${currentYear}${currentMonth}-${String(invoiceCount + i + 1).padStart(4, '0')}`;

        try {
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
              subtotal: invoiceData.subtotal,
              tax: invoiceData.tax,
              discount: invoiceData.discount || 0,
              total: invoiceData.total,
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
          createdInvoices.push(invoice);
        } catch (error) {
          console.error(`Error creating invoice ${i}:`, error);
          errors.push({ index: i, error: 'Invoice generation failed' });
        }
      }

      console.log(`[Bulk Invoice] Created ${createdInvoices.length}/${invoicesData.length} invoices for tenant ${tenantId}`);

      return NextResponse.json({
        status: 'success',
        data: createdInvoices,
        summary: {
          total: invoicesData.length,
          successful: createdInvoices.length,
          failed: invoicesData.length - createdInvoices.length
        },
        ...(errors.length > 0 && { errors })
      });
    });
  } catch (error) {
    console.error('Error generating invoices:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoices' },
      { status: 500 }
    );
  }
}

