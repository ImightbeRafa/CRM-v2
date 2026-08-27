import { Resend } from 'resend';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function deliverInvoiceEmail(input: {
  invoiceNumber: string;
  tenantName: string;
  customerName: string;
  recipient: string;
  total: number;
  currency: string;
  subtotal: number;
  tax: number;
  items: Array<{ description?: unknown; quantity?: unknown; unitPrice?: unknown; total?: unknown }>;
}) {
  if (process.env.NODE_ENV === 'test' || process.env.SUPPRESS_EXTERNAL_MESSAGES === 'true') {
    throw new Error('External email delivery is suppressed in this environment');
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'development-placeholder') throw new Error('Resend is not configured');

  const resend = new Resend(apiKey);
  const currency = (amount: number) => new Intl.NumberFormat('es-CR', {
    style: 'currency', currency: input.currency || 'CRC', minimumFractionDigits: 0,
  }).format(amount);
  const rows = input.items.map(item => `<tr>
    <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(item.description)}</td>
    <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center">${escapeHtml(item.quantity)}</td>
    <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${escapeHtml(currency(Number(item.total) || 0))}</td>
  </tr>`).join('');
  const response = await resend.emails.send({
    from: process.env.INVOICE_FROM_EMAIL || 'BetsyCRM <noreply@betsycrm.com>',
    to: input.recipient,
    subject: `Factura ${input.invoiceNumber} — ${input.tenantName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto">
      <h2>Factura ${escapeHtml(input.invoiceNumber)}</h2>
      <p>Hola ${escapeHtml(input.customerName)},</p>
      <p>${escapeHtml(input.tenantName)} te envió la siguiente factura.</p>
      <table style="width:100%;border-collapse:collapse"><thead><tr>
        <th style="padding:8px;text-align:left">Descripción</th><th style="padding:8px">Cantidad</th><th style="padding:8px;text-align:right">Total</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <div style="margin-top:18px;text-align:right">
        <div>Subtotal: ${escapeHtml(currency(input.subtotal))}</div>
        <div>IVA incluido: ${escapeHtml(currency(input.tax))}</div>
        <div style="font-size:20px;font-weight:bold;margin-top:6px">Total: ${escapeHtml(currency(input.total))}</div>
      </div>
      <p style="color:#666;font-size:12px">El IVA mostrado ya está incluido en el total; no se agregó nuevamente.</p>
    </div>`,
  });
  if (response.error || !response.data?.id) throw new Error(response.error?.message || 'Resend did not confirm delivery');
  return { providerId: response.data.id };
}
