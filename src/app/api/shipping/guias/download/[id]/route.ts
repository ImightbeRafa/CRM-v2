import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (token as any).tenantId as string;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    const userRole = (token as any)?.membershipRole;

    const guiaId = params.id;

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      // Get guía with PDF data
      const guia = await prisma.shippingGuia.findFirst({
        where: {
          id: guiaId,
          tenantId: tenantId
        },
        select: {
          id: true,
          pdfData: true,
          pdfFileName: true,
          orderId: true,
          guiaNumber: true
        }
      });

      if (!guia) {
        return NextResponse.json({ error: 'Guía not found' }, { status: 404 });
      }

      if (!guia.pdfData) {
        return NextResponse.json({ error: 'PDF not available for this guía' }, { status: 404 });
      }

      // Return PDF as downloadable file
      const fileName = guia.pdfFileName || `guia-${guia.guiaNumber}.pdf`;
      
      return new NextResponse(guia.pdfData, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': guia.pdfData.length.toString()
        }
      });
    });
  } catch (error) {
    console.error('Error downloading PDF:', error);
    return NextResponse.json(
      { error: 'Failed to download PDF' },
      { status: 500 }
    );
  }
}
