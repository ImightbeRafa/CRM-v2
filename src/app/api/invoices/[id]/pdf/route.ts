import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function GET(
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

    // Generate simple HTML invoice (for now, can be upgraded to use puppeteer later)
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: invoice.currency || 'CRC',
        minimumFractionDigits: 0
      }).format(amount);
    };

    const formatDate = (date: Date | null) => {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('es-CR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const items = invoice.items as any[];

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Factura ${invoice.invoiceNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    .header { text-align: center; margin-bottom: 30px; }
    .invoice-number { font-size: 24px; font-weight: bold; color: #333; }
    .company-name { font-size: 20px; color: #666; margin-bottom: 10px; }
    .info-section { margin: 30px 0; }
    .info-row { display: flex; justify-content: space-between; margin: 5px 0; }
    .label { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin: 30px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f5f5f5; font-weight: bold; }
    .totals { margin-top: 30px; float: right; width: 300px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; }
    .total-final { font-size: 20px; font-weight: bold; border-top: 2px solid #333; padding-top: 12px; margin-top: 12px; }
    .notes { margin-top: 50px; padding: 15px; background-color: #f9f9f9; border-left: 3px solid #666; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-name">${invoice.tenant.name}</div>
    <div class="invoice-number">FACTURA ${invoice.invoiceNumber}</div>
  </div>

  <div class="info-section">
    <div class="info-row">
      <div>
        <div class="label">Cliente:</div>
        <div>${invoice.customerName}</div>
        ${invoice.customerIdNumber ? `<div>Cédula: ${invoice.customerIdNumber}</div>` : ''}
        ${invoice.customerEmail ? `<div>Email: ${invoice.customerEmail}</div>` : ''}
        ${invoice.customerPhone ? `<div>Tel: ${invoice.customerPhone}</div>` : ''}
        ${invoice.customerAddress ? `<div>${invoice.customerAddress}</div>` : ''}
      </div>
      <div style="text-align: right;">
        <div><span class="label">Fecha:</span> ${formatDate(invoice.createdAt)}</div>
        ${invoice.dueDate ? `<div><span class="label">Vencimiento:</span> ${formatDate(invoice.dueDate)}</div>` : ''}
        <div><span class="label">Estado:</span> ${invoice.paymentStatus === 'paid' ? 'Pagada' : 'Pendiente'}</div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Descripción</th>
        <th style="text-align: center;">Cantidad</th>
        <th style="text-align: right;">Precio Unitario</th>
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td>${item.description}</td>
          <td style="text-align: center;">${item.quantity}</td>
          <td style="text-align: right;">${formatCurrency(item.unitPrice)}</td>
          <td style="text-align: right;">${formatCurrency(item.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row">
      <div>Subtotal:</div>
      <div>${formatCurrency(invoice.subtotal)}</div>
    </div>
    ${invoice.tax > 0 ? `
      <div class="total-row">
        <div>IVA (13%):</div>
        <div>${formatCurrency(invoice.tax)}</div>
      </div>
    ` : ''}
    ${invoice.discount > 0 ? `
      <div class="total-row">
        <div>Descuento:</div>
        <div>-${formatCurrency(invoice.discount)}</div>
      </div>
    ` : ''}
    <div class="total-row total-final">
      <div>TOTAL:</div>
      <div>${formatCurrency(invoice.total)}</div>
    </div>
  </div>

  <div style="clear: both;"></div>

  ${invoice.notes ? `
    <div class="notes">
      <div class="label">Notas:</div>
      <div>${invoice.notes}</div>
    </div>
  ` : ''}

  <div style="margin-top: 80px; text-align: center; color: #999; font-size: 12px;">
    Generado por Betsy CRM
  </div>
</body>
</html>
    `;

    // Return HTML response (can be converted to PDF using browser's print function)
    // TODO: Use puppeteer to generate actual PDF
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="factura-${invoice.invoiceNumber}.html"`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}

