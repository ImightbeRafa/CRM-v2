/**
 * Lane J — short order numbers (#1042, SQL 062). Pure helpers, the pre-062 fallback, tenant scoping of every raw
 * query, search wiring and the shape of 062 itself. Real-Postgres proof (concurrency, trigger seed, backfill,
 * self-heal): scripts/test-order-number-pg.ts (npm run test:order-number-pg, needs a local Postgres).
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeOrderNo, orderLabel, orderLabelHash, orderSecondaryId, parseOrderNoQuery } from '../orders/order-label';
import { planOrderNumbers } from '../orders/order-number-backfill';
import { searchPedidos, type PedidoRow } from '../pedidos-aurora';

const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

describe('orderLabel / parseOrderNoQuery', () => {
  it('shows #N when the order has a number, else the long id', () => {
    assert.equal(orderLabel({ orderId: 'ORDER-1792711884367', orderNo: 1042 }), '#1042');
    assert.equal(orderLabel({ orderId: 'ORDER-1792711884367', orderNo: null }), 'ORDER-1792711884367');
    assert.equal(orderLabel({ orderId: 'ORDER-1792711884367' }), 'ORDER-1792711884367');
    assert.equal(orderLabel({ orderId: 'ORDER-1', orderNo: '7' }), '#7');
    assert.equal(orderLabel(null), '');
  });
  it('never shows an invalid number', () => {
    for (const bad of [0, -3, 1.5, Number.NaN, 'abc', '', 10_000_000]) {
      assert.equal(orderLabel({ orderId: 'ORDER-9', orderNo: bad as number }), 'ORDER-9', String(bad));
    }
  });
  it('hash variant and secondary id', () => {
    assert.equal(orderLabelHash({ orderId: 'ORDER-9' }), '#ORDER-9');
    assert.equal(orderLabelHash({ orderId: 'ORDER-9', orderNo: 3 }), '#3');
    assert.equal(orderSecondaryId({ orderId: 'ORDER-9', orderNo: 3 }), 'ORDER-9');
    assert.equal(orderSecondaryId({ orderId: 'ORDER-9' }), null);
  });
  it('parses what people type', () => {
    for (const [input, want] of [
      ['#1042', 1042], ['1042', 1042], ['# 1042', 1042], ['  #12 ', 12], ['pedido 1042', 1042], ['Pedido #8', 8],
      ['n° 15', 15], ['orden 3', 3], ['9999999', 9_999_999],
    ] as const) {
      assert.equal(parseOrderNoQuery(input), want, input);
    }
    for (const input of ['', '#', '0', '#0', '12345678', '8888-1234', 'ORDER-1792711884367', 'Ana', '12a', '1.5', null, undefined]) {
      assert.equal(parseOrderNoQuery(input as string), null, String(input));
    }
  });
  it('normalizeOrderNo bounds', () => {
    assert.equal(normalizeOrderNo(1), 1);
    assert.equal(normalizeOrderNo('42'), 42);
    assert.equal(normalizeOrderNo(9_999_999), 9_999_999);
    assert.equal(normalizeOrderNo(10_000_000), null);
  });
});

describe('client search (Pedidos list)', () => {
  const rows = [
    { orderId: 'ORDER-1700000000001', orderNo: 1042, orderType: 'EA', status: 'Pendiente', total: 1, customerName: 'Ana', phone: '88881111' },
    { orderId: 'ORDER-1700000000002', orderNo: 7, orderType: 'EA', status: 'Pendiente', total: 1, customerName: 'Beto', phone: '88882222' },
    { orderId: 'ORDER-1700000000003', orderType: 'EA', status: 'Pendiente', total: 1, customerName: 'Caro', phone: '88883333' },
  ] as PedidoRow[];
  it('finds by #1042 or 1042', () => {
    assert.deepEqual(searchPedidos(rows, '#1042').map((r) => r.customerName), ['Ana']);
    assert.deepEqual(searchPedidos(rows, '1042').map((r) => r.customerName), ['Ana']);
    assert.deepEqual(searchPedidos(rows, '#7').map((r) => r.customerName), ['Beto']);
  });
  it('still finds by name, phone and long id', () => {
    assert.deepEqual(searchPedidos(rows, 'caro').map((r) => r.customerName), ['Caro']);
    assert.deepEqual(searchPedidos(rows, '88882222').map((r) => r.customerName), ['Beto']);
    assert.deepEqual(searchPedidos(rows, '0000000003').map((r) => r.customerName), ['Caro']);
  });
});

describe('backfill plan', () => {
  it('numbers old orders 1..N in creation order', () => {
    assert.deepEqual(planOrderNumbers([], ['a', 'b', 'c']), [
      { id: 'a', orderNo: 1 }, { id: 'b', orderNo: 2 }, { id: 'c', orderNo: 3 },
    ]);
  });
  it('skips numbers already taken (orders created after 062 keep theirs)', () => {
    assert.deepEqual(planOrderNumbers([6, 7, 2], ['a', 'b', 'c', 'd', 'e', 'f']).map((p) => p.orderNo), [1, 3, 4, 5, 8, 9]);
  });
  it('is a no-op with nothing to number', () => {
    assert.deepEqual(planOrderNumbers([1, 2, 3], []), []);
  });
});

describe('server reads: pre-062 fallback + tenant scoping (fake prisma)', () => {
  type Call = { sql: string; values: unknown[] };
  const calls: Call[] = [];
  let behaviour: (call: Call) => unknown = () => [];
  let server: typeof import('../orders/order-number-server');

  before(async () => {
    const fake: Record<string, unknown> = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const call = { sql: strings.join('?'), values };
        calls.push(call);
        return behaviour(call);
      },
    };
    fake.$extends = () => fake;
    (globalThis as { prisma?: unknown }).prisma = fake;
    server = await import('../orders/order-number-server');
  });
  beforeEach(() => {
    calls.length = 0;
    server.resetOrderNoColumnCache();
  });

  it('column missing (42703, before 062): empty, no throw, and no re-query for a minute', async () => {
    behaviour = () => {
      throw Object.assign(new Error('column "orderNo" does not exist'), { code: 'P2010', meta: { code: '42703' } });
    };
    assert.equal((await server.loadOrderNos('t1', ['a'])).size, 0);
    assert.equal(await server.findOrderIdByNo('t1', 5), null);
    assert.equal(await server.orderIdForSearch('t1', '#5'), null);
    assert.equal(calls.length, 1, 'second and third calls are served by the cached "missing" state');
  });

  it('any other read error degrades to "no number" (never fails a list or a create response)', async () => {
    behaviour = () => {
      throw Object.assign(new Error('connection reset'), { code: 'P1001' });
    };
    assert.equal(await server.loadOrderNo('t1', 'a'), null);
  });

  it('every raw read is scoped to the caller tenant', async () => {
    behaviour = (call) => (call.sql.includes('"orderNo" =') ? [{ id: 'o1' }] : [{ id: 'a', orderNo: 12 }]);
    const nos = await server.loadOrderNos('tenant-A', ['a', 'a', '']);
    assert.equal(nos.get('a'), 12);
    assert.equal(await server.findOrderIdByNo('tenant-A', 12), 'o1');
    await server.orderIdsForSearchInTenants(['tenant-A', 'tenant-B'], '12');
    for (const call of calls) assert.match(call.sql, /"tenantId" = /, call.sql);
    assert.deepEqual(calls[0].values[0], 'tenant-A');
    assert.deepEqual(calls[0].values[1], ['a'], 'ids deduplicated, empty ids dropped');
    assert.deepEqual(calls[1].values, ['tenant-A', 12]);
    assert.deepEqual(calls[2].values[0], ['tenant-A', 'tenant-B']);
  });

  it('Logística groups rows by their own tenant (never looks a number up under another business)', async () => {
    behaviour = (call) => (call.values[0] === 't1' ? [{ id: 'x', orderNo: 1 }] : [{ id: 'y', orderNo: 1 }]);
    const nos = await server.loadOrderNosByTenant([{ id: 'x', tenantId: 't1' }, { id: 'y', tenantId: 't2' }]);
    assert.equal(nos.get('x'), 1);
    assert.equal(nos.get('y'), 1);
    assert.deepEqual(calls.map((c) => [c.values[0], c.values[1]]).sort(), [['t1', ['x']], ['t2', ['y']]]);
  });

  it('no tenant / no ids / not a number → no query at all', async () => {
    assert.equal((await server.loadOrderNos('', ['a'])).size, 0);
    assert.equal((await server.loadOrderNos('t', [])).size, 0);
    assert.equal(await server.orderIdForSearch('t', 'Ana'), null);
    assert.deepEqual(await server.orderIdsForSearchInTenants([], '#3'), []);
    assert.equal(calls.length, 0);
  });
});

describe('SQL 062 shape', () => {
  const sql = src('supabase/migrations/062_order_number.sql');
  const code = sql.replace(/--.*$/gm, '');
  it('is additive, transactional and never names lm_* or drops anything', () => {
    assert.match(code, /BEGIN;[\s\S]*COMMIT;/);
    assert.match(code, /SET LOCAL lock_timeout = '3s'/);
    assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b/i);
    assert.doesNotMatch(code, /\blm_/i);
    assert.match(code, /ADD COLUMN IF NOT EXISTS "orderNo" integer NULL/);
  });
  it('per-tenant uniqueness, positive check, counter with RLS', () => {
    assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS "Order_tenantId_orderNo_key"\s+ON public\."Order"\("tenantId", "orderNo"\)\s+WHERE "orderNo" IS NOT NULL/);
    assert.match(code, /CHECK \("orderNo" IS NULL OR "orderNo" > 0\) NOT VALID/);
    assert.match(code, /CREATE TABLE IF NOT EXISTS public\."OrderNumberCounter"[\s\S]*"tenantId" text PRIMARY KEY/);
    assert.match(code, /ALTER TABLE public\."OrderNumberCounter" ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(code, /CREATE POLICY/);
  });
  it('trigger: UPDATE first (row lock), self-healing GREATEST with max, count seed only for the first order', () => {
    const fn = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION'), code.indexOf('CREATE OR REPLACE TRIGGER'));
    assert.match(fn, /SET search_path = public/);
    assert.doesNotMatch(fn, /SECURITY DEFINER/);
    assert.match(fn, /IF NEW\."orderNo" IS NOT NULL THEN\s+RETURN NEW;/);
    const update = fn.indexOf('UPDATE public."OrderNumberCounter"');
    const insert = fn.indexOf('INSERT INTO public."OrderNumberCounter"');
    assert.ok(update > 0 && insert > update, 'UPDATE runs before the seeding INSERT');
    assert.match(fn.slice(update, insert), /GREATEST\(\s*c\."lastNo",\s*COALESCE\(\(SELECT max\(o\."orderNo"\) FROM public\."Order" o WHERE o\."tenantId" = NEW\."tenantId"\), 0\)/);
    assert.doesNotMatch(fn.slice(update, insert), /count\(\*\)/);
    assert.match(fn.slice(insert), /IF NOT FOUND|count\(\*\)/);
    assert.match(fn, /ON CONFLICT \("tenantId"\) DO UPDATE/);
    assert.match(code, /CREATE OR REPLACE TRIGGER "Order_orderNo_trg"\s+BEFORE INSERT ON public\."Order"\s+FOR EACH ROW/);
  });
  it('is registered for the gated apply/verify scripts and kept out of schema.prisma', () => {
    const manifest = src('scripts/lib/betsy-v2-additive-manifest.mjs');
    assert.match(manifest, /'062': '062_order_number\.sql'/);
    assert.match(manifest, /'062': \['OrderNumberCounter'\]/);
    assert.match(manifest, /\['Order', 'orderNo'\]/);
    assert.doesNotMatch(manifest, /DEFAULT_APPLY_FILES = '[^']*062/);
    assert.doesNotMatch(src('prisma/schema.prisma'), /orderNo\b/);
  });
  it('the counter travels with the hot Order backup', () => {
    assert.match(src('src/lib/backups/config.ts'), /'OrderNumberCounter'/);
  });
});

describe('search wiring (tenant-scoped id lookups only)', () => {
  it('Pedidos, Producción, chat attach and Logística add the short-number match', () => {
    assert.match(src('src/app/api/orders/route.ts'), /const idForNo = await orderIdForSearch\(tenantId, search\)[\s\S]*\.\.\.\(idForNo \? \[\{ id: idForNo \}\] : \[\]\)/);
    assert.match(src('src/app/api/production/orders/route.ts'), /searchOrderNoId: await orderIdForSearch\(auth\.tenantId, input\.search\)/);
    assert.match(src('src/lib/production-query.ts'), /\.\.\.\(args\.searchOrderNoId \? \[\{ id: args\.searchOrderNoId \}\] : \[\]\)/);
    assert.match(src('src/app/api/chat/conversations/[id]/orders/route.ts'), /orderIdForSearch\(tenantId, search\.text\)/);
    const logistics = src('src/app/api/logistics/orders/route.ts');
    assert.match(logistics, /orderIdsForSearchInTenants\(tenantIds, search\)/);
    assert.match(logistics, /loadOrderNosByTenant\(orders\)/);
  });
  it('the long orderId stays the key: URLs, guías and mutations never use orderNo', () => {
    const table = src('src/components/aurora/pedidos/PedidosTable.tsx');
    assert.match(table, /onOpen\(o\.orderId\)/);
    assert.match(table, /\{orderLabel\(o\)\}/);
    const drawer = src('src/components/aurora/pedidos/PedidoDetailDrawer.tsx');
    assert.match(drawer, /encodeURIComponent\(sale\.orderId\)/);
    assert.match(drawer, /orderSecondaryId\(sale\)/, 'the long id stays visible in the detail for support');
  });
});

describe('review fixes (Verifier / SecureDog)', () => {
  it('parseOrder keeps orderNo, so Pedidos / Producción / chat panel get "#1042" (was dropped)', async () => {
    const { parseOrder } = await import('../../app/hooks/useSalesStream');
    const sale = parseOrder({ id: 'o1', orderId: 'ORDER-1792711884367', orderNo: 1042, orderType: 'EA' });
    assert.equal(sale?.orderNo, 1042);
    assert.equal(orderLabel(sale), '#1042');
    assert.equal(parseOrder({ id: 'o2', orderId: 'ORDER-2', orderType: 'EA' })?.orderNo, null);
    assert.equal(parseOrder({ id: 'o3', orderId: 'ORDER-3', orderNo: 'x', orderType: 'EA' })?.orderNo, null);
  });
  it('INFRA-26: long search input never reaches the regex (no quadratic backtracking)', () => {
    const evil = `n${' '.repeat(16_000)}a`;
    const start = performance.now();
    assert.equal(parseOrderNoQuery(evil), null);
    assert.equal(parseOrderNoQuery(`#${' '.repeat(16_000)}1`), null);
    assert.ok(performance.now() - start < 5, 'returns in < 5 ms');
    assert.equal(parseOrderNoQuery('pedido # 9999999'), 9_999_999);
  });
  it('orderNo is never stored as a custom field on create or edit', () => {
    assert.match(src('src/app/api/orders/update/route.ts'), /'itemLines',[\s\S]{0,160}'orderNo',/);
    assert.match(src('src/app/api/orders/route.ts'), /'contraEntrega','cePaymentConfirmed',[\s\S]{0,140}'orderNo',/);
  });
  it('customer guía caption keeps the long id until the agent lookup understands #N (DATA-66)', () => {
    assert.match(src('src/lib/shipping/send-guia-to-chat.ts'), /orderNumber: order\.orderId/);
  });
  it('backfill raises the counter in a short transaction, then numbers in batches with timeouts', () => {
    const backfill = src('src/lib/orders/order-number-backfill.ts');
    assert.match(backfill, /SET LOCAL lock_timeout = '3s'/);
    assert.match(backfill, /SET LOCAL statement_timeout/);
    assert.match(backfill, /if \(top > counterAfter\)/);
    assert.match(backfill, /AND o\."orderNo" IS NULL/);
  });
  it('062 has no table-scanning VALIDATE (all NULL; NOT VALID still checks new rows)', () => {
    const code = src('supabase/migrations/062_order_number.sql').replace(/--.*$/gm, '');
    assert.doesNotMatch(code, /VALIDATE CONSTRAINT/);
  });
});
