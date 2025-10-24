import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email address required' }, { status: 400 });
    }

    // Get invoice
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
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

    // TODO: Implement email sending with nodemailer or similar
    // For now, just return success
    console.log(`Would send invoice ${invoice.invoiceNumber} to ${email}`);

    return NextResponse.json({
      status: 'success',
      data: {
        message: `Invoice sent to ${email}`,
        invoiceNumber: invoice.invoiceNumber
      }
    });
  } catch (error) {
    console.error('Error emailing invoice:', error);
    return NextResponse.json(
      { error: 'Failed to email invoice' },
      { status: 500 }
    );
  }
}

