import { PDFDocument, PageSizes } from 'pdf-lib';

type OutputOrientation = 'portrait' | 'landscape';

interface LayoutCandidate {
  rows: number;
  cols: number;
  orientation: OutputOrientation;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  slots: number;
  utilization: number;
}

interface PackOptions {
  minScale?: number;
  margin?: number;
  gutter?: number;
}

const [A4_WIDTH, A4_HEIGHT] = PageSizes.A4;

const OUTPUT_CANDIDATES: Array<Pick<LayoutCandidate, 'rows' | 'cols' | 'orientation'>> = [
  { rows: 2, cols: 2, orientation: 'landscape' },
  { rows: 2, cols: 2, orientation: 'portrait' },
  { rows: 1, cols: 2, orientation: 'landscape' },
  { rows: 2, cols: 1, orientation: 'portrait' },
  { rows: 1, cols: 1, orientation: 'portrait' },
  { rows: 1, cols: 1, orientation: 'landscape' },
];

function resolvePageSize(orientation: OutputOrientation) {
  return orientation === 'portrait'
    ? { pageWidth: A4_WIDTH, pageHeight: A4_HEIGHT }
    : { pageWidth: A4_HEIGHT, pageHeight: A4_WIDTH };
}

function evaluateCandidate(
  sourceWidth: number,
  sourceHeight: number,
  rows: number,
  cols: number,
  orientation: OutputOrientation,
  margin: number,
  gutter: number
): LayoutCandidate {
  const { pageWidth, pageHeight } = resolvePageSize(orientation);
  const usableWidth = pageWidth - margin * 2 - gutter * (cols - 1);
  const usableHeight = pageHeight - margin * 2 - gutter * (rows - 1);
  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;
  const scale = Math.min(cellWidth / sourceWidth, cellHeight / sourceHeight);
  const slots = rows * cols;
  const utilization = ((sourceWidth * scale) * (sourceHeight * scale) * slots) / (pageWidth * pageHeight);

  return {
    rows,
    cols,
    orientation,
    pageWidth,
    pageHeight,
    scale,
    slots,
    utilization,
  };
}

function chooseBestLayout(
  sourceWidth: number,
  sourceHeight: number,
  minScale: number,
  margin: number,
  gutter: number
): LayoutCandidate {
  const candidates = OUTPUT_CANDIDATES.map((candidate) =>
    evaluateCandidate(
      sourceWidth,
      sourceHeight,
      candidate.rows,
      candidate.cols,
      candidate.orientation,
      margin,
      gutter
    )
  );

  const feasible = candidates.filter((candidate) => candidate.scale >= minScale);
  const pool = feasible.length > 0 ? feasible : candidates;

  return pool.sort((a, b) => {
    if (b.slots !== a.slots) return b.slots - a.slots;
    if (b.utilization !== a.utilization) return b.utilization - a.utilization;
    return b.scale - a.scale;
  })[0];
}

function getCellFrame(
  pageWidth: number,
  pageHeight: number,
  rows: number,
  cols: number,
  margin: number,
  gutter: number,
  index: number
) {
  const usableWidth = pageWidth - margin * 2 - gutter * (cols - 1);
  const usableHeight = pageHeight - margin * 2 - gutter * (rows - 1);
  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const x = margin + col * (cellWidth + gutter);
  const y = pageHeight - margin - (row + 1) * cellHeight - row * gutter;

  return { x, y, width: cellWidth, height: cellHeight };
}

export async function packPdfBuffersToA4(
  pdfBuffers: Uint8Array[],
  options: PackOptions = {}
): Promise<Uint8Array> {
  const minScale = options.minScale ?? 0.55;
  const margin = options.margin ?? 18;
  const gutter = options.gutter ?? 10;

  const sourceDocs = await Promise.all(
    pdfBuffers.map((buffer) => PDFDocument.load(buffer))
  );

  const sourcePages = sourceDocs.flatMap((doc) =>
    doc.getPages().map((page, pageIndex) => ({
      doc,
      pageIndex,
      width: page.getWidth(),
      height: page.getHeight(),
    }))
  );

  if (sourcePages.length === 0) {
    throw new Error('No PDF pages available to pack');
  }

  const layout = chooseBestLayout(
    sourcePages[0].width,
    sourcePages[0].height,
    minScale,
    margin,
    gutter
  );

  const output = await PDFDocument.create();

  for (let start = 0; start < sourcePages.length; start += layout.slots) {
    const chunk = sourcePages.slice(start, start + layout.slots);
    const outputPage = output.addPage([layout.pageWidth, layout.pageHeight]);

    for (let index = 0; index < chunk.length; index += 1) {
      const source = chunk[index];
      const sourcePage = source.doc.getPage(source.pageIndex);
      const embeddedPage = await output.embedPage(sourcePage);
      const frame = getCellFrame(
        layout.pageWidth,
        layout.pageHeight,
        layout.rows,
        layout.cols,
        margin,
        gutter,
        index
      );
      const drawScale = Math.min(frame.width / source.width, frame.height / source.height);
      const drawWidth = source.width * drawScale;
      const drawHeight = source.height * drawScale;
      const drawX = frame.x + (frame.width - drawWidth) / 2;
      const drawY = frame.y + (frame.height - drawHeight) / 2;

      outputPage.drawPage(embeddedPage, {
        x: drawX,
        y: drawY,
        xScale: drawScale,
        yScale: drawScale,
      });
    }
  }

  return output.save();
}
