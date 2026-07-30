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

const PAGE_WIDTH = 300;
const PAGE_HEIGHT = 520;
const MARGIN_X = 22;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const PURPLE = rgb(0.42, 0.18, 0.72);
const GREEN = rgb(0.05, 0.55, 0.28);
const ORANGE = rgb(0.9, 0.45, 0.1);
const GRAY = rgb(0.35, 0.35, 0.35);
const BLACK = rgb(0.08, 0.08, 0.08);
const LIGHT_BORDER = rgb(0.78, 0.78, 0.78);

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
 * Examples: "PEND. SINPE", "SINPE", "EFECTIVO", "PREPAGO"
 */
export function paymentHighlightLabel(data: {
  isContraEntrega?: boolean;
  paymentCollected?: boolean;
  paymentMethod?: RetiroReceiptPaymentMethod;
  comments?: string | null;
}): string {
  const comments = String(data.comments || '').toLowerCase();
  const inferredFromComments = (() => {
    if (/\befectivo\b/.test(comments)) return 'efectivo' as const;
    if (/\bsinpe\b/.test(comments)) return 'sinpe' as const;
    return null;
  })();
  const method = data.paymentMethod || inferredFromComments;

  if (!data.isContraEntrega) return 'PREPAGO';

  if (data.paymentCollected) {
    if (method === 'efectivo') return 'EFECTIVO';
    if (method === 'sinpe') return 'SINPE';
    return 'PAGO OK';
  }

  if (method === 'efectivo') return 'PEND. EFECTIVO';
  return 'PEND. SINPE';
}

function formatMoneyCrc(amount: number): string {
  const n = Number(amount) || 0;
  // StandardFonts cannot draw ₡ — use CRC prefix for WinAnsi safety.
  return `CRC ${n.toLocaleString('es-CR')}`;
}

function formatAgreed(data: RetiroReceiptData): string {
  const raw = data.scheduledAt || data.agreedDate || data.pickupDate;
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString('es-CR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  return String(raw);
}

function hoursSinceCreated(createdAt?: string | Date | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const hours = Math.max(0, Math.floor((Date.now() - d.getTime()) / 3600000));
  return `${hours}h`;
}

function toPdfText(value: string): string {
  // WinAnsi-safe: keep Latin-1, drop unsupported symbols (₡ etc.)
  return String(value || '')
    .replace(/₡/g, '')
    .replace(/[^\u0000-\u00FF]/g, '')
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
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let t = safe;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
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
  const words = safe.split(/\s+/).filter(Boolean);
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

  if (words.length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (font.widthOfTextAtSize(last, size) > maxWidth || words.join(' ').length > lines.join(' ').length) {
      lines[maxLines - 1] = truncateText(last, font, size, maxWidth);
    }
  }
  return lines;
}

function drawCentered(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  font: PDFFont,
  color = BLACK,
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

/**
 * Compact retiro / pickup slip PDF.
 * Highlights last 5 order digits (top) and payment status (bottom) like warehouse marker notes.
 */
export async function generateRetiroReceiptPdf(data: RetiroReceiptData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const shortId = lastFiveOrderDigits(data.orderRef);
  const paymentLabel = paymentHighlightLabel(data);
  const status = toPdfText(data.status || 'Pendiente') || 'Pendiente';
  const ageLabel = hoursSinceCreated(data.createdAt);
  const lines = extractOrderLines(data);
  const itemsText = lines.map((l) => `${l.rawName} x${l.qty}`).join(', ');
  const totalQty = lines.reduce((sum, l) => sum + (l.qty || 0), 0) || Number(data.quantity) || 0;
  const agreed = formatAgreed(data);

  let y = PAGE_HEIGHT - 36;

  // Outer receipt border
  page.drawRectangle({
    x: 10,
    y: 10,
    width: PAGE_WIDTH - 20,
    height: PAGE_HEIGHT - 20,
    borderColor: LIGHT_BORDER,
    borderWidth: 1.2,
  });

  // ── Big last-5 digits (warehouse highlight) ─────────────────
  drawCentered(page, `# ${shortId}`, y, 36, fontBold, PURPLE);
  y -= 28;

  // Full order ref + status badge
  const orderLine = `#${toPdfText(data.orderRef)}`;
  page.drawText(orderLine, {
    x: MARGIN_X,
    y,
    size: 10,
    font: fontBold,
    color: BLACK,
  });

  const badgeText = status.length > 12 ? truncateText(status, fontBold, 8, 70) : status;
  const badgePadX = 6;
  const badgeW = fontBold.widthOfTextAtSize(badgeText, 8) + badgePadX * 2;
  const badgeH = 14;
  const badgeX = PAGE_WIDTH - MARGIN_X - badgeW;
  page.drawRectangle({
    x: badgeX,
    y: y - 3,
    width: badgeW,
    height: badgeH,
    borderColor: ORANGE,
    borderWidth: 1,
    color: rgb(1, 0.96, 0.9),
  });
  page.drawText(badgeText, {
    x: badgeX + badgePadX,
    y: y + 1,
    size: 8,
    font: fontBold,
    color: ORANGE,
  });
  y -= 16;

  if (ageLabel) {
    page.drawText(ageLabel, {
      x: MARGIN_X,
      y,
      size: 9,
      font: fontRegular,
      color: GRAY,
    });
  }
  y -= 14;

  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: MARGIN_X + CONTENT_WIDTH, y },
    thickness: 0.8,
    color: LIGHT_BORDER,
  });
  y -= 18;

  // Customer
  page.drawText(truncateText(data.customerName || 'Cliente', fontBold, 13, CONTENT_WIDTH), {
    x: MARGIN_X,
    y,
    size: 13,
    font: fontBold,
    color: BLACK,
  });
  y -= 16;

  if (data.phone) {
    page.drawText(toPdfText(String(data.phone)), {
      x: MARGIN_X,
      y,
      size: 11,
      font: fontRegular,
      color: GRAY,
    });
    y -= 16;
  }

  // Items
  const itemLines = wrapText(itemsText || toPdfText(data.product || 'Producto'), fontRegular, 10, CONTENT_WIDTH, 3);
  for (const line of itemLines) {
    page.drawText(line, {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: BLACK,
    });
    y -= 13;
  }

  page.drawText(`Cant: ${totalQty}`, {
    x: MARGIN_X,
    y,
    size: 10,
    font: fontBold,
    color: BLACK,
  });
  y -= 14;

  if (data.seller) {
    page.drawText(truncateText(`Vendedor: ${data.seller}`, fontRegular, 10, CONTENT_WIDTH), {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: GRAY,
    });
    y -= 14;
  }

  if (agreed) {
    page.drawText(truncateText(`Acordado: ${agreed}`, fontRegular, 10, CONTENT_WIDTH), {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: GRAY,
    });
    y -= 14;
  }

  if (data.pickupLocationLabel) {
    page.drawText(truncateText(`Lugar: ${data.pickupLocationLabel}`, fontRegular, 10, CONTENT_WIDTH), {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: GRAY,
    });
    y -= 14;
  }

  if (data.handedByName) {
    page.drawText(truncateText(`Entrego: ${data.handedByName}`, fontRegular, 10, CONTENT_WIDTH), {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontRegular,
      color: GRAY,
    });
    y -= 14;
  }

  y -= 4;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: MARGIN_X + CONTENT_WIDTH, y },
    thickness: 0.8,
    color: LIGHT_BORDER,
  });
  y -= 18;

  // Total row
  page.drawText('Total:', {
    x: MARGIN_X,
    y,
    size: 12,
    font: fontBold,
    color: BLACK,
  });
  const totalText = formatMoneyCrc(data.total);
  const totalW = fontBold.widthOfTextAtSize(totalText, 13);
  page.drawText(totalText, {
    x: MARGIN_X + CONTENT_WIDTH - totalW,
    y,
    size: 13,
    font: fontBold,
    color: GREEN,
  });
  y -= 20;

  // Comments
  if (data.comments) {
    page.drawText('Comentarios:', {
      x: MARGIN_X,
      y,
      size: 9,
      font: fontBold,
      color: GRAY,
    });
    y -= 12;
    const commentLines = wrapText(String(data.comments), fontRegular, 9, CONTENT_WIDTH, 5);
    for (const line of commentLines) {
      page.drawText(line, {
        x: MARGIN_X,
        y,
        size: 9,
        font: fontRegular,
        color: BLACK,
      });
      y -= 11;
    }
  }

  // ── Big payment status (warehouse highlight) ────────────────
  const paySize = paymentLabel.length > 12 ? 22 : 26;
  const payY = 42;
  const payW = fontBold.widthOfTextAtSize(toPdfText(paymentLabel), paySize);
  page.drawRectangle({
    x: Math.max(16, (PAGE_WIDTH - payW) / 2 - 8),
    y: payY - 6,
    width: Math.min(PAGE_WIDTH - 32, payW + 16),
    height: paySize + 10,
    color: rgb(0.94, 0.9, 0.98),
    borderColor: PURPLE,
    borderWidth: 1,
  });
  drawCentered(page, paymentLabel, payY, paySize, fontBold, PURPLE);

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
