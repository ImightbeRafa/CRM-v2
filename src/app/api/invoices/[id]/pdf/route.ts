import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { escapeHtml } from '@/lib/validation';
import { PII_NO_STORE_HEADERS } from '@/lib/security';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Helper to get Puppeteer browser
async function getBrowser() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Production: use puppeteer-core with @sparticuz/chromium
    const chromium = await import('@sparticuz/chromium');
    const puppeteer = await import('puppeteer-core');
    
    return puppeteer.default.launch({
      args: chromium.default.args,
      defaultViewport: { width: 1200, height: 800 },
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });
  } else {
    // Development: use regular puppeteer
    const puppeteer = await import('puppeteer');
    return puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let browser = null;
  const { id: invoiceId } = await params;
  
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Prefer session current tenant over memberships[0] (multi-tenant users)
    const sessionTenantId =
      (token as { tenantId?: string }).tenantId ||
      (token as { currentTenant?: { id?: string } }).currentTenant?.id;

    if (!sessionTenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const tenantId = sessionTenantId;

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

    // Generate HTML for PDF
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

    const items = (Array.isArray(invoice.items) ? invoice.items : []) as Array<{
      description?: unknown;
      quantity?: unknown;
      unitPrice?: number;
      total?: number;
    }>;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Factura ${escapeHtml(invoice.invoiceNumber)}</title>
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
    <div class="company-name">${escapeHtml(invoice.tenant.name)}</div>
    <div class="invoice-number">FACTURA ${escapeHtml(invoice.invoiceNumber)}</div>
  </div>

  <div class="info-section">
    <div class="info-row">
      <div>
        <div class="label">Cliente:</div>
        <div>${escapeHtml(invoice.customerName)}</div>
        ${invoice.customerIdNumber ? `<div>Cédula: ${escapeHtml(invoice.customerIdNumber)}</div>` : ''}
        ${invoice.customerEmail ? `<div>Email: ${escapeHtml(invoice.customerEmail)}</div>` : ''}
        ${invoice.customerPhone ? `<div>Tel: ${escapeHtml(invoice.customerPhone)}</div>` : ''}
        ${invoice.customerAddress ? `<div>${escapeHtml(invoice.customerAddress)}</div>` : ''}
      </div>
      <div style="text-align: right;">
        <div><span class="label">Fecha:</span> ${escapeHtml(formatDate(invoice.createdAt))}</div>
        ${invoice.dueDate ? `<div><span class="label">Vencimiento:</span> ${escapeHtml(formatDate(invoice.dueDate))}</div>` : ''}
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
          <td>${escapeHtml(String(item.description ?? ''))}</td>
          <td style="text-align: center;">${escapeHtml(String(item.quantity ?? ''))}</td>
          <td style="text-align: right;">${escapeHtml(formatCurrency(Number(item.unitPrice) || 0))}</td>
          <td style="text-align: right;">${escapeHtml(formatCurrency(Number(item.total) || 0))}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row">
      <div>Subtotal:</div>
      <div>${escapeHtml(formatCurrency(invoice.subtotal))}</div>
    </div>
    ${invoice.tax > 0 ? `
      <div class="total-row">
        <div>IVA (13%):</div>
        <div>${escapeHtml(formatCurrency(invoice.tax))}</div>
      </div>
    ` : ''}
    ${invoice.discount > 0 ? `
      <div class="total-row">
        <div>Descuento:</div>
        <div>-${escapeHtml(formatCurrency(invoice.discount))}</div>
      </div>
    ` : ''}
    <div class="total-row total-final">
      <div>TOTAL:</div>
      <div>${escapeHtml(formatCurrency(invoice.total))}</div>
    </div>
  </div>

  <div style="clear: both;"></div>

  ${invoice.notes ? `
    <div class="notes">
      <div class="label">Notas:</div>
      <div>${escapeHtml(invoice.notes)}</div>
    </div>
  ` : ''}

  <div style="margin-top: 80px; text-align: center; color: #999; font-size: 12px;">
    Generado por Betsy CRM
  </div>
</body>
</html>
    `;

    // Generate PDF using Puppeteer
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);

    // Set content and wait for it to load
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });
    
    await browser.close();
    browser = null;
    
    // Return PDF response - convert Uint8Array to Buffer for NextResponse
    const safeFilename = invoice.invoiceNumber.replace(/[^\w.\-]+/g, '_');
    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="factura-${safeFilename}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
        ...PII_NO_STORE_HEADERS,
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
  }
}

