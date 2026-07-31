import assert from 'node:assert/strict';
import {
  formatAgreedDisplay,
  generateRetiroReceiptPdf,
  lastFiveOrderDigits,
  paymentHighlightLabel,
  toPdfText,
} from '../retiroReceiptPdf';

assert.equal(lastFiveOrderDigits('BOT-1785197334716'), '34716');
assert.equal(lastFiveOrderDigits('123'), '00123');
assert.equal(lastFiveOrderDigits(''), '-----');

assert.equal(
  paymentHighlightLabel({ isContraEntrega: true, paymentCollected: false }),
  'PAGO PEND.',
);
assert.equal(
  paymentHighlightLabel({
    isContraEntrega: true,
    paymentCollected: false,
    comments: 'Pago: SINPE PAGA CONTRA ENTREGA',
  }),
  'PAGO PEND.',
  'must not infer method from comments',
);
assert.equal(
  paymentHighlightLabel({
    isContraEntrega: true,
    paymentCollected: false,
    paymentMethod: 'sinpe',
  }),
  'PEND. SINPE',
);
assert.equal(
  paymentHighlightLabel({
    isContraEntrega: true,
    paymentCollected: true,
    paymentMethod: 'efectivo',
  }),
  'EFECTIVO',
);
assert.equal(paymentHighlightLabel({ isContraEntrega: false }), 'PREPAGO');

assert.equal(formatAgreedDisplay('2024-07-29'), '29/07/2024');
{
  // 16:00 UTC = 10:00 America/Costa_Rica
  const formatted = formatAgreedDisplay('2024-07-29T16:00:00.000Z');
  assert.match(formatted, /29\/07\/2024/);
  assert.match(formatted, /10:00/i);
}

assert.equal(toPdfText('Paola\nGamboa\tHernández'), 'Paola Gamboa Hernández');
assert.equal(toPdfText('Total ₡19.800'), 'Total 19.800');
assert.ok(!toPdfText('line1\nline2').includes('\n'));
assert.equal(toPdfText(`Paola\u0085Gamboa`), 'Paola Gamboa');
assert.ok(!toPdfText('a\u009F b').includes('\u009F'));

const pdfWithNewline = await generateRetiroReceiptPdf({
  orderRef: 'BOT-1785197334716',
  customerName: 'Paola\nGamboa\u0085Hernández',
  phone: '8832\t8787',
  product: 'StressPatchWithoutSpacesThatIsVeryLongAndCouldOverflowTheReceiptWidth',
  quantity: 2,
  total: 19800,
  seller: 'Laura',
  comments: 'Pago: SINPE\nPAGA CONTRA ENTREGA',
  status: 'Pendiente',
  agreedDate: '2024-07-29T16:00:00.000Z',
  createdAt: new Date(Date.now() - 22 * 3600000).toISOString(),
  isContraEntrega: true,
  paymentCollected: false,
});
assert.ok(pdfWithNewline.length > 500);
assert.equal(pdfWithNewline.subarray(0, 4).toString('latin1'), '%PDF');

const pdfPendingUnknown = await generateRetiroReceiptPdf({
  orderRef: 'RA-99',
  customerName: 'Cliente',
  total: 1000,
  isContraEntrega: true,
  paymentCollected: false,
});
assert.ok(pdfPendingUnknown.length > 500);

{
  const { PDFDocument } = await import('pdf-lib');
  const loaded = await PDFDocument.load(pdfWithNewline);
  assert.equal(loaded.getPageCount(), 1);
  const page = loaded.getPage(0);
  const { width, height } = page.getSize();
  assert.equal(width, 300);
  assert.ok(height >= 280 && height <= 560, `unexpected height ${height}`);

  // Dense content with full Detalle rows (regression: Entrego was clipped by Total)
  const dense = await generateRetiroReceiptPdf({
    orderRef: 'ORDER-1785443864236',
    customerName: 'Hernaldo Sanchez Calvo',
    phone: '72937749',
    productDetails: JSON.stringify([
      { type: 'Sleeping patches', cantidad: 2 },
    ]),
    total: 19800,
    seller: 'Bloom',
    comments: 'RETIRO TREJOS: Hoy a las 7:30p.m SINPE CONFIRMADO',
    status: 'Entregado',
    agreedDate: '2026-07-30T21:00:00.000Z',
    createdAt: new Date(Date.now() - 13 * 3600000).toISOString(),
    isContraEntrega: false,
    pickupLocationLabel: 'Laura Escazu',
    handedByName: 'Laura',
  });
  assert.ok(dense.length > 500);
  const loadedDense = await PDFDocument.load(dense);
  const denseSize = loadedDense.getPage(0).getSize();
  assert.equal(denseSize.width, 300);
  assert.ok(denseSize.height >= 280 && denseSize.height <= 560);

  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/retiro-receipt-no-clip.pdf', dense);
}

console.log('retiroReceiptPdf tests passed');
