import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type CorreosGamStampZone = 'gam' | 'outside_gam';

const STAMP_COPY: Record<CorreosGamStampZone, string> = {
  gam: 'GAM',
  outside_gam: 'FUERA GAM',
};

const STAMP_STYLE: Record<CorreosGamStampZone, { fill: ReturnType<typeof rgb>; text: ReturnType<typeof rgb>; border: ReturnType<typeof rgb> }> = {
  gam: {
    fill: rgb(0.86, 0.97, 0.9),
    text: rgb(0.03, 0.36, 0.17),
    border: rgb(0.05, 0.55, 0.24),
  },
  outside_gam: {
    fill: rgb(1, 0.92, 0.84),
    text: rgb(0.56, 0.2, 0.02),
    border: rgb(0.9, 0.38, 0.03),
  },
};

export async function stampCorreosGamZoneOnPdf(
  pdfBuffer: Uint8Array,
  zone: CorreosGamStampZone | null | undefined
): Promise<Uint8Array> {
  if (!zone) return pdfBuffer;

  const label = STAMP_COPY[zone];
  const style = STAMP_STYLE[zone];
  if (!label || !style) return pdfBuffer;

  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const fontSize = 13;
    const paddingX = 11;
    const stampHeight = 28;
    const stampWidth = Math.max(58, font.widthOfTextAtSize(label, fontSize) + paddingX * 2);
    const x = Math.max(12, width - stampWidth - 16);
    const y = Math.max(12, height - stampHeight - 16);

    page.drawRectangle({
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      color: style.fill,
      borderColor: style.border,
      borderWidth: 1.5,
      opacity: 0.96,
    });

    const textWidth = font.widthOfTextAtSize(label, fontSize);
    page.drawText(label, {
      x: x + (stampWidth - textWidth) / 2,
      y: y + 8,
      size: fontSize,
      font,
      color: style.text,
    });
  }

  return doc.save();
}
