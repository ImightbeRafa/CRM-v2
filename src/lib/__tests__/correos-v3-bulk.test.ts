import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunk, generateBulkInChunks } from '../correos/bulk-client';
import { v3ClaimAction } from '../shipping/guia-service';

describe('bulk guías in chunks', () => {
  it('splits into chunks of 10', () => {
    assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
    assert.equal(chunk(Array.from({ length: 25 })).length, 3);
  });

  it('merges chunk answers and reports progress', async () => {
    const seen: number[] = [];
    const progress: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const { orders } = JSON.parse(String(init?.body));
      seen.push(orders.length);
      return new Response(JSON.stringify({ data: { results: orders.map((o: any) => ({ success: true, orderId: o.orderId })), savedGuias: [], successful: orders.length, failed: 0 } }), { status: 200 });
    }) as typeof fetch;
    const r = await generateBulkInChunks(Array.from({ length: 23 }, (_, i) => ({ orderId: `O${i}` })), { fetchImpl, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    assert.deepEqual(seen, [10, 10, 3]);
    assert.ok(!('error' in r));
    if (!('error' in r)) {
      assert.equal(r.successful, 23);
      assert.equal(r.results.length, 23);
    }
    assert.deepEqual(progress, ['0/23', '10/23', '20/23', '23/23']);
  });

  it('stops on the first failing chunk and keeps the partial result', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 2) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      return new Response(JSON.stringify({ data: { results: [{ success: true, orderId: 'a' }], savedGuias: [], successful: 1, failed: 0 } }), { status: 200 });
    }) as typeof fetch;
    const r = await generateBulkInChunks(Array.from({ length: 30 }, (_, i) => ({ orderId: `O${i}` })), { fetchImpl });
    assert.ok('error' in r);
    if ('error' in r) {
      assert.equal(r.error, 'boom');
      assert.equal(r.partial?.successful, 1);
    }
    assert.equal(n, 2);
  });
});

describe('v3 claim handling', () => {
  it('releases the claim only when nothing could have been registered', () => {
    assert.equal(v3ClaimAction({ ok: true, guiaNumber: 'X', pdf: null, zpl: null, montoFlete: 0, pesoG: 500, destZip: null }), 'complete');
    assert.equal(v3ClaimAction({ ok: false, sent: false, unknown: false, error: 'tel' }), 'release');
    assert.equal(v3ClaimAction({ ok: false, sent: true, unknown: false, error: '400' }), 'release');
    assert.equal(v3ClaimAction({ ok: false, sent: true, unknown: true, error: 'timeout' }), 'unknown');
  });

  it('every guía writer uses the same once-per-order claim key', () => {
    for (const f of ['src/lib/shipping/guia-service.ts', 'src/lib/bot/guia-service.ts']) {
      assert.match(readFileSync(f, 'utf8'), /correos-guia:\$\{order\.id\}/);
    }
    const bulk = readFileSync('src/app/api/logistics/guias/generate-bulk/route.ts', 'utf8');
    assert.match(bulk, /const claimKey = `correos-guia:\$\{dbOrder\.id\}`/);
    assert.match(bulk, /const CORREOS_PROVIDER_ADAPTER = 'correos-provider'/);
    assert.match(bulk, /operation: 'correos_guia_external_claim'/);
  });

  it('v3 checks run before the claim in the store flow', () => {
    const src = readFileSync('src/lib/shipping/guia-service.ts', 'utf8');
    const prep = src.indexOf('v3Prepared = await v3.prepareGuia(v3Input)');
    const claim = src.indexOf("operation: 'correos_guia_external_claim'");
    assert.ok(prep > 0 && claim > 0 && prep < claim);
    // No timeout wrapper around the v3 registration (a wrapper timeout would hide "unknown").
    assert.doesNotMatch(src, /withTimeout\(v3\.createGuia/);
  });
});
