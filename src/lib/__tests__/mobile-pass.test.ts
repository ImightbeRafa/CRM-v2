import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { columnLabels, rowCellLabels } from '@/lib/mobile-table-labels';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

describe('mobile table card labels', () => {
  it('expands header colspans into one label per column', () => {
    assert.deepEqual(
      columnLabels([
        { text: '  ', colSpan: 1 },
        { text: 'Cliente\n  ', colSpan: 1 },
        { text: 'Monto total', colSpan: 2 },
      ]),
      ['', 'Cliente', 'Monto total', 'Monto total'],
    );
  });

  it('maps body cells to their column label; wide cells get none', () => {
    const labels = ['', 'Cliente', 'Producto', 'Total'];
    assert.deepEqual(rowCellLabels(labels, [1, 1, 1, 1]), ['', 'Cliente', 'Producto', 'Total']);
    assert.deepEqual(rowCellLabels(labels, [4]), ['']);
    assert.deepEqual(rowCellLabels(labels, [1, 2, 1]), ['', '', 'Total']);
    assert.deepEqual(rowCellLabels(labels, [1, 1, 1, 1, 1]), ['', 'Cliente', 'Producto', 'Total', '']);
  });
});

describe('mobile pass wiring', () => {
  it('root viewport lets safe-area insets work', () => {
    assert.match(read('src/app/layout.tsx'), /viewportFit: 'cover'/);
  });

  it('phone fields are 16px so iOS never zooms on focus', () => {
    assert.match(read('src/app/globals-mobile.css'), /textarea \{\n\s+font-size: 16px !important;/);
  });

  it('phone-only rules are screen-only so desktop printouts keep tables and sizes', () => {
    const mobile = read('src/app/globals-mobile.css');
    const block = mobile.slice(mobile.indexOf('@media screen and (max-width: 767px)'));
    assert.ok(block.length > 0 && block.includes('table.m-cards thead'), 'm-cards lives in the screen-only block');
    assert.match(block, /table\.m-cards td\.hidden \{ display: none !important; \}/);
    assert.match(read('src/app/logistics/logistics-styles.ts'), /@media screen and \(max-width: 768px\) \{\n\s+\.lm-mobile-menu-btn/);
  });

  it('logistics layout keeps table labels and the phone CSS', () => {
    const layout = read('src/app/logistics/layout.tsx');
    assert.match(layout, /<LogisticsTableLabels \/>/);
    assert.match(layout, /<style>\{LOGISTICS_CSS\}<\/style>/);
    const css = read('src/app/logistics/logistics-styles.ts');
    assert.match(css, /\.lm-main table:not\(\.lm-keep-table\) thead \{ display: none !important; \}/);
    assert.match(css, /content: attr\(data-label\)/);
    assert.match(css, /\.lm-main \.lm-grid-2/);
  });

  it('carriers board only drag-pans with a mouse (touch scrolls natively)', () => {
    assert.match(read('src/app/logistics/carriers/page.tsx'), /e\.pointerType !== 'mouse'/);
  });
});
