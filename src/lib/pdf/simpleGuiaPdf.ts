import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface SimpleGuiaData {
  guiaNumber: string;
  orderId: string;
  phone?: string;
  customerName?: string;
  product?: string;
  quantity?: number | string;
  province?: string;
  canton?: string;
  district?: string;
  address?: string;
  comments?: string;
}

/**
 * Generate a simple shipping-label PDF matching the layout from the
 * Producción > Guías "Imprimir" feature (see GuiaGenerator.tsx handlePrint).
 *
 * Uses pdf-lib (no browser/Puppeteer required) so it runs in any server
 * environment including serverless.
 */
export async function generateSimpleGuiaPdf(
  data: SimpleGuiaData,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { height } = page.getSize();

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const marginX = 50;
  const contentWidth = 595.28 - marginX * 2;
  let y = height - 60;

  const black = rgb(0, 0, 0);
  const borderColor = rgb(0, 0, 0);

  // ── Outer border ──────────────────────────────────────────
  const boxTop = height - 40;
  const boxHeight = 460;
  page.drawRectangle({
    x: marginX - 10,
    y: boxTop - boxHeight,
    width: contentWidth + 20,
    height: boxHeight,
    borderColor,
    borderWidth: 2,
  });

  // ── Header ────────────────────────────────────────────────
  const title = 'Guia de Envio';
  const titleWidth = fontBold.widthOfTextAtSize(title, 20);
  page.drawText(title, {
    x: marginX + (contentWidth - titleWidth) / 2,
    y,
    size: 20,
    font: fontBold,
    color: black,
  });

  y -= 24;
  const subtitle = `Numero de Guia: ${data.guiaNumber}`;
  const subtitleWidth = fontBold.widthOfTextAtSize(subtitle, 14);
  page.drawText(subtitle, {
    x: marginX + (contentWidth - subtitleWidth) / 2,
    y,
    size: 14,
    font: fontBold,
    color: black,
  });

  y -= 16;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: marginX + contentWidth, y },
    thickness: 2,
    color: black,
  });

  y -= 24;

  // ── Info rows ─────────────────────────────────────────────
  const rows: [string, string][] = [
    ['Orden:', data.orderId],
    ['Telefono:', data.phone || ''],
    ['Cliente:', data.customerName || ''],
    ['Producto:', data.product || ''],
    ['Cantidad:', String(data.quantity ?? '')],
    ['Provincia:', data.province || 'N/A'],
    ['Canton:', data.canton || 'N/A'],
    ['Distrito:', data.district || 'N/A'],
    ['Direccion:', data.address || ''],
    ['Comentarios:', data.comments || ''],
  ];

  const labelSize = 11;
  const valueSize = 11;
  const rowSpacing = 26;

  for (const [label, value] of rows) {
    page.drawText(label, {
      x: marginX,
      y,
      size: labelSize,
      font: fontBold,
      color: black,
    });

    const labelW = fontBold.widthOfTextAtSize(label, labelSize);
    const maxValueWidth = contentWidth - labelW - 10;
    const truncated = truncateText(value, fontRegular, valueSize, maxValueWidth);

    page.drawText(truncated, {
      x: marginX + labelW + 8,
      y,
      size: valueSize,
      font: fontRegular,
      color: black,
    });

    y -= rowSpacing;
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

function truncateText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string {
  if (!text) return '';
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t + '...', size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '...';
}
