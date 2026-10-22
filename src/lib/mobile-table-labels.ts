/**
 * Phone layout for plain <table>s: CSS hides the header and stacks each row as a
 * card, so every cell needs its column name in `data-label` (shown via ::before).
 * These helpers compute and apply those labels from the table's own header row,
 * so pages keep their markup unchanged.
 */

export type HeaderCell = { text: string; colSpan: number };

/** One label per column, expanding colspans ("Cliente" spanning 2 → 2 entries). */
export function columnLabels(headers: HeaderCell[]): string[] {
  const labels: string[] = [];
  for (const header of headers) {
    const text = header.text.replace(/\s+/g, ' ').trim();
    const span = Math.max(1, Math.trunc(header.colSpan) || 1);
    for (let i = 0; i < span; i += 1) labels.push(text);
  }
  return labels;
}

/** Labels for a body row's cells, given each cell's colspan. */
export function rowCellLabels(labels: string[], cellSpans: number[]): string[] {
  const out: string[] = [];
  let column = 0;
  for (const rawSpan of cellSpans) {
    const span = Math.max(1, Math.trunc(rawSpan) || 1);
    // A cell spanning several columns is a note/footer row: no single label fits.
    out.push(span > 1 ? '' : labels[column] ?? '');
    column += span;
  }
  return out;
}

/** Writes data-label on every body cell of `table` (no-op without a header row). */
export function applyTableCardLabels(table: HTMLTableElement): void {
  const headerRow = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!headerRow) return;
  const labels = columnLabels(
    Array.from(headerRow.cells).map((cell) => ({ text: cell.textContent ?? '', colSpan: cell.colSpan })),
  );
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      const cells = Array.from(row.cells);
      const cellLabels = rowCellLabels(labels, cells.map((cell) => cell.colSpan));
      cells.forEach((cell, index) => {
        if (cell.getAttribute('data-label') !== cellLabels[index]) cell.setAttribute('data-label', cellLabels[index]);
      });
    }
  }
}
