import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCrcAmount,
  parseCrcProductAmount,
  parseCrcShippingAmount,
  CrcMoneyError,
} from '@/lib/crc-money';

describe('crc-money', () => {
  it('parses Costa Rican thousands dots and commas', () => {
    assert.equal(parseCrcAmount('₡3.000'), 3000);
    assert.equal(parseCrcAmount('₡3,000'), 3000);
    assert.equal(parseCrcAmount('CRC 20.900'), 20900);
    assert.equal(parseCrcAmount('11 500'), 11500);
    assert.equal(parseCrcAmount('₡9.900'), 9900);
  });

  it('treats gratis as zero shipping and rejects zero product prices', () => {
    assert.equal(parseCrcShippingAmount('GRATIS', 'Envío'), 0);
    assert.equal(parseCrcShippingAmount('free', 'Envío'), 0);
    assert.throws(() => parseCrcProductAmount('gratis', 'Precio'), CrcMoneyError);
    assert.throws(() => parseCrcProductAmount('0', 'Precio'), /mayor a/);
  });

  it('rejects malformed monetary payloads instead of silently returning 3', () => {
    assert.equal(parseCrcAmount('abc'), undefined);
    assert.throws(() => parseCrcProductAmount('no-precio', 'Total'), CrcMoneyError);
  });
});
