import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { extractOrderLines } from '@/lib/retiro-stock-utils';

export type RetiroReceiptPaymentMethod = 'sinpe' | 'efectivo' | null;

export interface RetiroReceiptData {
  orderRef: string;
  customerName: string;
  phone?: string | null;
  product?: string | null;
  quantity?: number | null;
  productDetails?: string | null;
  total: number;
  seller?: string | null;
  comments?: string | null;
  status?: string | null;
  agreedDate?: string | null;
  pickupDate?: string | null;
  scheduledAt?: string | null;
  createdAt?: string | Date | null;
  isContraEntrega?: boolean;
  paymentCollected?: boolean;
  paymentMethod?: RetiroReceiptPaymentMethod;
  pickupLocationLabel?: string | null;
  handedByName?: string | null;
}

// ── Design tokens (warehouse dispatch ticket) ─────────────────
const PAGE_WIDTH = 300;
const MARGIN_X = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CR_TZ = 'America/Costa_Rica';
const HEADER_H = 92;
const FOOTER_H = 64;
const MIN_PAGE_HEIGHT = HEADER_H + FOOTER_H + 140;
const MAX_PAGE_HEIGHT = 560;

const INK = rgb(0.114, 0.098, 0.125); // #1D1920
const ACCENT = rgb(0.357, 0.165, 0.431); // #5B2A6E
const ACCENT_TINT = rgb(0.953, 0.929, 0.961); // #F3EDF5
const MUTED = rgb(0.435, 0.408, 0.451); // #6F6873
const RULE = rgb(0.867, 0.843, 0.875); // #DDD7DF
const WHITE = rgb(1, 1, 1);
const PANEL = rgb(0.965, 0.957, 0.973);

/**
 * Last 5 digits of the order ref for warehouse highlighting.
 * e.g. BOT-1785197334716 → 34716
 */
export function lastFiveOrderDigits(orderRef: string): string {
  const digits = String(orderRef || '').replace(/\D/g, '');
  if (digits.length >= 5) return digits.slice(-5);
  if (digits.length > 0) return digits.padStart(5, '0');
  const cleaned = String(orderRef || '').replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(-5).toUpperCase() || '-----';
}

/**
 * Big footer payment highlight matching logistics pickup slips.
 * Only uses structured payment method — never infers from free-text comments.
 */
export function paymentHighlightLabel(data: {
  isContraEntrega?: boolean;
  paymentCollected?: boolean;
  paymentMethod?: RetiroReceiptPaymentMethod;
  comments?: string | null;
}): string {
  const method = data.paymentMethod === 'sinpe' || data.paymentMethod === 'efectivo'
    ? data.paymentMethod
    : null;

  if (!data.isContraEntrega) return 'PREPAGO';

  if (data.paymentCollected) {
    if (method === 'efectivo') return 'EFECTIVO';
    if (method === 'sinpe') return 'SINPE';
    return 'PAGO OK';
  }

  if (method === 'efectivo') return 'PEND. EFECTIVO';
  if (method === 'sinpe') return 'PEND. SINPE';
  return 'PAGO PEND.';
}

function formatMoneyCrc(amount: number): string {
  const n = Number(amount) || 0;
  // StandardFonts cannot draw ₡ — use CRC prefix for WinAnsi safety.
  return `CRC ${n.toLocaleString('es-CR')}`;
}

/** Exported for tests — formats appointment times in Costa Rica. */
export function formatAgreedDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';

  // Date-only: avoid UTC midnight shifting into the previous CR day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString('es-CR', {
      timeZone: CR_TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  return s;
}

function hoursSinceCreated(createdAt?: string | Date | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const hours = Math.max(0, Math.floor((Date.now() - d.getTime()) / 3600000));
  return `${hours}h`;
}

/** WinAnsi-safe + strip controls that crash pdf-lib (C0/C1, tabs, newlines, etc.). */
export function toPdfText(value: string): string {
  return String(value || '')
    .replace(/₡/g, '')
    // C0 + DEL + C1 controls are not reliably encodable in WinAnsi
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[^\u0000-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const safe = toPdfText(text);
  if (!safe) return '';
  if (maxWidth <= 0) return '';
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let t = safe;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t ? `${t}...` : '';
}

function splitOversizedToken(
  token: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (font.widthOfTextAtSize(token, size) <= maxWidth) return [token];
  const parts: string[] = [];
  let chunk = '';
  for (const ch of token) {
    const next = chunk + ch;
    if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
      parts.push(chunk);
      chunk = ch;
    } else {
      chunk = next;
    }
  }
  if (chunk) parts.push(chunk);
  return parts;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines = 4,
): string[] {
  const safe = toPdfText(text);
  if (!safe) return [];
  const words = safe.split(/\s+/).filter(Boolean).flatMap((w) =>
    splitOversizedToken(w, font, size, maxWidth),
  );
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    lines[maxLines - 1] = truncateText(lines[maxLines - 1], font, size, maxWidth);
  }
  return lines;
}

function fitFontSize(
  text: string,
  font: PDFFont,
  preferred: number,
  min: number,
  maxWidth: number,
): number {
  const safe = toPdfText(text);
  let size = preferred;
  while (size > min && font.widthOfTextAtSize(safe, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function drawCentered(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const safe = toPdfText(text);
  const width = font.widthOfTextAtSize(safe, size);
  page.drawText(safe, {
    x: Math.max(MARGIN_X, (PAGE_WIDTH - width) / 2),
    y,
    size,
    font,
    color,
  });
}

function sectionLabel(
  page: PDFPage,
  label: string,
  y: number,
  font: PDFFont,
): number {
  page.drawText(toPdfText(label).toUpperCase(), {
    x: MARGIN_X,
    y,
    size: 7.5,
    font,
    color: MUTED,
  });
  return y - 12;
}

/**
 * Compact retiro / pickup slip PDF — warehouse dispatch ticket.
 * Highlights last 5 order digits (header) and payment status (footer band).
 */
export async function generateRetiroReceiptPdf(data: RetiroReceiptData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const shortId = lastFiveOrderDigits(data.orderRef);
  const paymentLabel = paymentHighlightLabel(data);
  const status = toPdfText(data.status || 'Pendiente') || 'Pendiente';
  const ageLabel = hoursSinceCreated(data.createdAt);
  const orderLines = extractOrderLines(data).slice(0, 8);
  const agreed = formatAgreedDisplay(data.scheduledAt || data.agreedDate || data.pickupDate);
  const customer = toPdfText(data.customerName || 'Cliente') || 'Cliente';
  const phone = data.phone ? toPdfText(String(data.phone)) : '';

  const metaRows: Array<[string, string]> = [];
  if (data.seller) metaRows.push(['Vendedor', toPdfText(String(data.seller))]);
  if (agreed) metaRows.push(['Acordado', toPdfText(agreed)]);
  if (data.pickupLocationLabel) metaRows.push(['Lugar', toPdfText(String(data.pickupLocationLabel))]);
  if (data.handedByName) metaRows.push(['Entrego', toPdfText(String(data.handedByName))]);

  const commentLines = data.comments
    ? wrapText(String(data.comments), fontRegular, 9, CONTENT_WIDTH - 16, 4)
    : [];

  // Measure body height so the page hugs content (no dead void above footer).
  let bodyH = 0;
  bodyH += 18; // top padding under header
  bodyH += 16; // customer
  if (phone) bodyH += 14;
  bodyH += 18; // gap + ARTICULOS label
  bodyH += Math.max(1, orderLines.length) * 14 + 8;
  if (metaRows.length) bodyH += 14 + metaRows.length * 13 + 8;
  bodyH += 28; // total block
  if (commentLines.length) bodyH += 14 + 10 + commentLines.length * 12 + 14;
  bodyH += 10; // bottom padding before footer

  const pageHeight = Math.min(
    MAX_PAGE_HEIGHT,
    Math.max(MIN_PAGE_HEIGHT, HEADER_H + bodyH + FOOTER_H),
  );

  const page = doc.addPage([PAGE_WIDTH, pageHeight]);

  // ── Header band ─────────────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: pageHeight - HEADER_H,
    width: PAGE_WIDTH,
    height: HEADER_H,
    color: ACCENT_TINT,
  });
  // Accent bar on top edge
  page.drawRectangle({
    x: 0,
    y: pageHeight - 4,
    width: PAGE_WIDTH,
    height: 4,
    color: ACCENT,
  });

  page.drawText('RETIRO', {
    x: MARGIN_X,
    y: pageHeight - 22,
    size: 8,
    font: fontBold,
    color: ACCENT,
  });

  const shortLabel = `# ${shortId}`;
  const shortSize = fitFontSize(shortLabel, fontBold, 44, 28, CONTENT_WIDTH);
  const shortW = fontBold.widthOfTextAtSize(shortLabel, shortSize);
  page.drawText(shortLabel, {
    x: (PAGE_WIDTH - shortW) / 2,
    y: pageHeight - 62,
    size: shortSize,
    font: fontBold,
    color: ACCENT,
  });

  const orderRef = truncateText(`#${data.orderRef}`, fontBold, 8.5, CONTENT_WIDTH * 0.55);
  const statusMeta = truncateText(
    ageLabel ? `${status.toUpperCase()} · ${ageLabel}` : status.toUpperCase(),
    fontRegular,
    8,
    CONTENT_WIDTH * 0.42,
  );
  page.drawText(orderRef, {
    x: MARGIN_X,
    y: pageHeight - HEADER_H + 12,
    size: 8.5,
    font: fontBold,
    color: INK,
  });
  const statusW = fontRegular.widthOfTextAtSize(statusMeta, 8);
  page.drawText(statusMeta, {
    x: PAGE_WIDTH - MARGIN_X - statusW,
    y: pageHeight - HEADER_H + 12,
    size: 8,
    font: fontRegular,
    color: MUTED,
  });

  // ── Body ────────────────────────────────────────────────────
  let y = pageHeight - HEADER_H - 20;

  // Customer
  page.drawText(truncateText(customer, fontBold, 14, CONTENT_WIDTH), {
    x: MARGIN_X,
    y,
    size: 14,
    font: fontBold,
    color: INK,
  });
  y -= 16;

  if (phone) {
    page.drawText(truncateText(phone, fontRegular, 10, CONTENT_WIDTH), {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: MUTED,
    });
    y -= 14;
  }

  y -= 6;
  y = sectionLabel(page, 'Articulos', y, fontBold);

  if (orderLines.length === 0) {
    page.drawText('Producto', {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: INK,
    });
    y -= 14;
  } else {
    for (const line of orderLines) {
      const qty = `x${line.qty}`;
      const qtyW = fontBold.widthOfTextAtSize(qty, 10);
      const nameMax = CONTENT_WIDTH - qtyW - 10;
      const name = truncateText(line.rawName, fontRegular, 10, nameMax);
      page.drawText(name, {
        x: MARGIN_X,
        y,
        size: 10,
        font: fontRegular,
        color: INK,
      });
      page.drawText(qty, {
        x: MARGIN_X + CONTENT_WIDTH - qtyW,
        y,
        size: 10,
        font: fontBold,
        color: INK,
      });
      y -= 14;
    }
  }

  y -= 4;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: MARGIN_X + CONTENT_WIDTH, y },
    thickness: 0.6,
    color: RULE,
  });
  y -= 14;

  // Operational metadata
  if (metaRows.length) {
    y = sectionLabel(page, 'Detalle', y, fontBold);
    for (const [label, value] of metaRows) {
      const labelText = `${label}:`;
      page.drawText(labelText, {
        x: MARGIN_X,
        y,
        size: 9,
        font: fontBold,
        color: MUTED,
      });
      const labelW = fontBold.widthOfTextAtSize(labelText, 9);
      page.drawText(truncateText(value, fontRegular, 9, CONTENT_WIDTH - labelW - 8), {
        x: MARGIN_X + labelW + 6,
        y,
        size: 9,
        font: fontRegular,
        color: INK,
      });
      y -= 13;
    }
    y -= 4;
  }

  // Total row
  page.drawRectangle({
    x: MARGIN_X - 4,
    y: y - 8,
    width: CONTENT_WIDTH + 8,
    height: 26,
    color: PANEL,
  });
  page.drawText('Total', {
    x: MARGIN_X,
    y: y,
    size: 11,
    font: fontBold,
    color: INK,
  });
  const totalText = formatMoneyCrc(data.total);
  const totalW = fontBold.widthOfTextAtSize(totalText, 13);
  page.drawText(totalText, {
    x: MARGIN_X + CONTENT_WIDTH - totalW,
    y,
    size: 13,
    font: fontBold,
    color: ACCENT,
  });
  y -= 34;

  // Comments panel
  if (commentLines.length) {
    y = sectionLabel(page, 'Comentarios', y, fontBold);
    const panelH = commentLines.length * 12 + 12;
    page.drawRectangle({
      x: MARGIN_X - 4,
      y: y - panelH + 10,
      width: CONTENT_WIDTH + 8,
      height: panelH,
      color: ACCENT_TINT,
    });
    let cy = y;
    for (const line of commentLines) {
      page.drawText(line, {
        x: MARGIN_X + 4,
        y: cy,
        size: 9,
        font: fontRegular,
        color: INK,
      });
      cy -= 12;
    }
    y = cy - 6;
  }

  // ── Payment footer band ─────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: FOOTER_H,
    color: ACCENT,
  });

  page.drawText('ESTADO DE PAGO', {
    x: MARGIN_X,
    y: FOOTER_H - 16,
    size: 7.5,
    font: fontBold,
    color: rgb(0.85, 0.78, 0.92),
  });

  const paySize = fitFontSize(paymentLabel, fontBold, 26, 16, CONTENT_WIDTH);
  // Optical vertical center in the lower portion of the band
  const payY = 16;
  drawCentered(page, paymentLabel, payY, paySize, fontBold, WHITE);

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
