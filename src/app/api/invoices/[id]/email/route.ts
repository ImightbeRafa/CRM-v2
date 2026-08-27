import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response;
    const { tenantId } = auth;

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email address required' }, { status: 400 });
    }

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

    return NextResponse.json({
      status: 'error',
      code: 'email_not_sent',
      error: 'El envío de facturas por correo aún no está disponible.',
      invoiceNumber: invoice.invoiceNumber,
    }, { status: 501 });
  } catch (error) {
    console.error('Error emailing invoice:', error);
    return NextResponse.json(
      { error: 'Failed to email invoice' },
      { status: 500 }
    );
  }
}

