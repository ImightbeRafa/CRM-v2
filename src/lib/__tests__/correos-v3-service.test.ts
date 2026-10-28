import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __resetV3TokenCache, CorreosV3Error } from '../correos/v3/client';
import { __resetV3GeoCache, matchByName } from '../correos/v3/geo';
import { CorreosV3Service } from '../correos/v3/service';
import { selectV3Config } from '../correos/v3/config';
import { decideCorreosApi, tenantWantsV3 } from '../correos/v3/select';
import { classifyStatus, nextCheckDelayMs, normalizeTracking, toGrams, toPhone8, toZip5 } from '../correos/v3/mappers';
import { FIXTURES, TEST_CONFIG, fakeCorreos } from './correos-v3-fixtures';

const noSleep = { sleep: async () => {} };

function service(over?: Parameters<typeof fakeCorreos>[0]) {
  const fake = fakeCorreos(over);
  return { fake, svc: new CorreosV3Service(TEST_CONFIG, { fetchImpl: fake.impl, ...noSleep }) };
}

const SENDER = { name: 'Tienda', phone: '2222-3333', address: 'San José centro', zip: '10101' };

describe('Correos v3 mappers', () => {
  it('normalizes Costa Rica phones to 8 digits', () => {
    assert.equal(toPhone8('+506 8888-7777'), '88887777');
    assert.equal(toPhone8('50688887777'), '88887777');
    assert.equal(toPhone8('8888 7777'), '88887777');
    assert.equal(toPhone8('00000000'), null);
    assert.equal(toPhone8('1234'), null);
    assert.equal(toPhone8(null), null);
  });

  it('checks zips and grams', () => {
    assert.equal(toZip5('10101'), '10101');
    assert.equal(toZip5('1010'), null);
    assert.equal(toGrams('750.4'), 750);
    assert.equal(toGrams(0), 500);
    assert.equal(toGrams(99_999), 30_000);
  });

  it('classifies Correos status words', () => {
    assert.equal(classifyStatus('EN TRANSITO'), 'in_transit');
    assert.equal(classifyStatus('ENTREGADO'), 'delivered');
    assert.equal(classifyStatus('DEVUELTO AL REMITENTE'), 'returned');
    assert.equal(classifyStatus('ENTREGADO AL REMITENTE'), 'returned');
    assert.equal(classifyStatus('DISPONIBLE PARA RETIRAR EN SUCURSAL'), 'at_branch');
    assert.equal(classifyStatus('EN REPARTO'), 'out_for_delivery');
    assert.equal(classifyStatus('', '2026-06-05T10:00:00'), 'delivered');
    assert.equal(classifyStatus(''), 'unknown');
  });

  it('normalizes a tracking answer and drops 0,0 coordinates', () => {
    const t = normalizeTracking('X', {
      ...FIXTURES.rastreo.datos,
      eventos: [...FIXTURES.rastreo.datos.eventos, { fecha: '2026-06-05T08:00:00', ubicacion: 'CTP', codigo: 'EMC', descripcion: 'EN TRANSITO', recibidoPor: '', latitud: 0, longitud: 0 }],
    } as any);
    assert.equal(t.guiaNumber, 'PY002036568CR');
    assert.equal(t.status, 'in_transit');
    assert.equal(t.events.length, 2);
    assert.equal(t.events[1].lat, null);
    assert.equal(t.events[0].lat, 9.9325);
  });

  it('schedules tracking checks and stops on closed', () => {
    assert.equal(nextCheckDelayMs('delivered', 0), null);
    assert.equal(nextCheckDelayMs('in_transit', 40 * 24 * 3_600_000), null);
    assert.ok((nextCheckDelayMs('in_transit', 0) ?? 0) > 0);
  });

  it('matches names with or without accents', () => {
    const items = [{ nombre: 'Escazú' }, { nombre: 'San José' }];
    assert.equal(matchByName(items, 'escazu')?.nombre, 'Escazú');
    assert.equal(matchByName(items, 'SAN JOSE')?.nombre, 'San José');
    assert.equal(matchByName(items, 'Heredia'), null);
  });
});

describe('Correos v3 config + selection', () => {
  it('prefers a complete DB set, decrypts the password, never mixes sources', () => {
    const r = selectV3Config({
      db: { correos_v3_username: 'db', correos_v3_password: 'enc:x', correos_v3_cod_cliente: '1', correos_v3_servicio_id: '1564', correos_v3_env: 'prod', correos_v3_enabled: '1' },
      env: { CORREOS_V3_USER: 'env', CORREOS_V3_PASSWORD: 'envp' },
      decrypt: (v) => (v === 'enc:x' ? 'plain' : v),
    });
    assert.equal(r?.source, 'logistics_db');
    assert.equal(r?.config.password, 'plain');
    assert.equal(r?.config.environment, 'prod');
    assert.equal(r?.enabled, true);

    const half = selectV3Config({ db: { correos_v3_username: 'db' }, env: {} });
    assert.equal(half, null);
  });

  it('reads test env vars when CORREOS_V3_ENV is test (default)', () => {
    const r = selectV3Config({
      db: {},
      env: { CORREOS_V3_TEST_USER: 'tu', CORREOS_V3_TEST_PASSWORD: 'tp', CORREOS_V3_TEST_COD_CLIENTE: '7362097', CORREOS_V3_TEST_SERVICIO: '1564' },
    });
    assert.equal(r?.config.environment, 'test');
    assert.equal(r?.source, 'environment');
    assert.equal(r?.enabled, false);
  });

  it('uses SOAP unless switched on; writes also need the store opt-in', () => {
    assert.equal(decideCorreosApi({ resolved: null, purpose: 'read' }), 'soap');
    assert.equal(decideCorreosApi({ resolved: { enabled: false }, purpose: 'read' }), 'soap');
    assert.equal(decideCorreosApi({ resolved: { enabled: true }, purpose: 'read' }), 'v3');
    assert.equal(decideCorreosApi({ resolved: { enabled: true }, purpose: 'write', tenantSettings: {} }), 'soap');
    assert.equal(decideCorreosApi({ resolved: { enabled: true }, purpose: 'write', tenantSettings: { correos_api: 'v3' } }), 'v3');
    assert.equal(tenantWantsV3(null), false);
  });
});

describe('Correos v3 service', () => {
  beforeEach(() => {
    __resetV3TokenCache();
    __resetV3GeoCache();
  });

  it('checks an address: postal code, branch flag, restricted barrio', async () => {
    const { svc } = service();
    const okRes = await svc.checkAddress({ province: 'San Jose', canton: 'san josé', district: 'Carmen', barrio: 'Barrio Amón' });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.codigoPostal, '10101');
    assert.equal(okRes.poseeSucursal, true);
    assert.equal(okRes.districtHasRestricted, true);
    const bad = await svc.checkAddress({ province: 'San José', canton: 'San José', district: 'Carmen', barrio: 'barrio peligro' });
    assert.equal(bad.ok, false);
    assert.equal(bad.restricted, true);
    const unknown = await svc.checkAddress({ province: 'San José', canton: 'San José', district: 'Nowhere' });
    assert.equal(unknown.ok, false);
  });

  it('caches geography between calls', async () => {
    const { fake, svc } = service();
    await svc.checkAddress({ province: '1', canton: '01', district: '01' });
    await svc.checkAddress({ province: '1', canton: '01', district: '02' });
    assert.equal(fake.calls.filter((c) => c.path === '/ubicaciones/provincias').length, 1);
  });

  it('quotes with codes resolved from names and returns the total', async () => {
    const { fake, svc } = service();
    const q = await svc.quote({ origin: { province: 'San José', canton: 'San José', district: 'Carmen' }, dest: { province: 'Alajuela', canton: 'Alajuela', district: 'Alajuela' }, pesoG: 1200, dims: { alto: 10, largo: 20, ancho: 15 } });
    assert.deepEqual(q, { monto: 2600, descuento: 100, impuesto: 338, total: 2838 });
    const body = fake.calls.find((c) => c.path === '/tarifas/calcular')!.body;
    assert.equal(body.codProvinciaDestino, '2');
    assert.equal(body.peso, 1200);
    assert.equal(body.largo, 20);
    assert.equal(body.codCliente, 7362097);
  });

  it('blocks bad data before calling registrar', async () => {
    const { fake, svc } = service();
    const r1 = await svc.createGuia({ dest: { name: 'Ana', phone: '123', address: 'x', province: 'San José', canton: 'San José', district: 'Carmen' }, sender: SENDER, tipoDestino: 'DOM' });
    assert.equal(r1.ok, false);
    assert.equal(!r1.ok && r1.sent, false);
    const r2 = await svc.createGuia({ dest: { name: 'Ana', phone: '88887777', address: 'x', province: 'San José', canton: 'San José', district: 'Carmen' }, sender: SENDER, tipoDestino: 'SUC' });
    assert.equal(!r2.ok && r2.field, 'codigoSucursal');
    const r3 = await svc.createGuia({ dest: { name: 'Ana', phone: '88887777', address: 'x', province: 'San José', canton: 'San José', district: 'Carmen', barrio: 'Barrio Peligro' }, sender: SENDER, tipoDestino: 'DOM' });
    assert.equal(!r3.ok && r3.field, 'dest.barrio');
    assert.equal(fake.calls.filter((c) => c.path === '/guiasweb/registrar').length, 0);
  });

  it('registers a home guía with postal code, quoted freight, PDF and ZPL', async () => {
    const { fake, svc } = service();
    const r = await svc.createGuia({
      dest: { name: 'Ana Mora', phone: '+506 8888-7777', address: '100 m norte del parque', province: 'San José', canton: 'San José', district: 'Merced' },
      sender: SENDER,
      origin: { province: 'San José', canton: 'San José', district: 'Carmen' },
      pesoG: 800,
      tipoDestino: 'DOM',
      observaciones: 'Pedido #123',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.guiaNumber, 'PY002036568CR');
    assert.ok(r.pdf?.toString().startsWith('%PDF'));
    assert.equal(r.zpl, '^XA^FDtest^FS^XZ');
    assert.equal(r.montoFlete, 2838);
    const body = fake.calls.find((c) => c.path === '/guiasweb/registrar')!.body;
    assert.equal(body.destTelefono, '88887777');
    assert.equal(body.destZip, '10102');
    assert.equal(body.tipoDestino, 'DOM');
    assert.equal(body.envioId, '');
    assert.equal(body.peso, 800);
    assert.ok(!('codigoSucursal' in body));
  });

  it('registers a branch guía without a home address', async () => {
    const { fake, svc } = service();
    const r = await svc.createGuia({ dest: { name: 'Ana', phone: '88887777', address: '', province: '', canton: '', district: '' }, sender: SENDER, tipoDestino: 'SUC', codigoSucursal: 'SJ01', montoFlete: 1800 });
    assert.equal(r.ok, true);
    const body = fake.calls.find((c) => c.path === '/guiasweb/registrar')!.body;
    assert.equal(body.codigoSucursal, 'SJ01');
    assert.equal(body.montoFlete, 1800);
    assert.ok(!('destZip' in body));
  });

  it('marks a timeout after sending as unknown (never safe to retry)', async () => {
    const { svc } = service({ '/guiasweb/registrar': () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); } });
    const r = await svc.createGuia({ dest: { name: 'Ana', phone: '88887777', address: 'x', province: '1', canton: '01', district: '01' }, sender: SENDER, tipoDestino: 'SUC', codigoSucursal: 'SJ01', montoFlete: 0 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.sent, true);
    assert.equal(!r.ok && r.unknown, true);
  });

  it('a Correos 400 is a clean refusal (sent, not unknown)', async () => {
    const { svc } = service({ '/guiasweb/registrar': () => new Response(JSON.stringify({ exito: false, mensaje: 'Sucursal inválida', datos: null, errores: [] }), { status: 400 }) });
    const r = await svc.createGuia({ dest: { name: 'Ana', phone: '88887777', address: 'x', province: '1', canton: '01', district: '01' }, sender: SENDER, tipoDestino: 'SUC', codigoSucursal: 'ZZ', montoFlete: 0 });
    assert.equal(!r.ok && r.unknown, false);
    assert.equal(!r.ok && r.error, 'Sucursal inválida');
  });

  it('a rejected login is "not sent"', async () => {
    const { svc } = service({ '/auth/login': () => new Response('Credenciales no válidas', { status: 401 }) });
    const r = await svc.createGuia({ dest: { name: 'Ana', phone: '88887777', address: 'x', province: '1', canton: '01', district: '01' }, sender: SENDER, tipoDestino: 'SUC', codigoSucursal: 'SJ01', montoFlete: 0 });
    assert.equal(!r.ok && r.sent, false);
  });

  it('lists branches by names', async () => {
    const { svc } = service();
    const r = await svc.branchesFor({ province: 'San José', canton: 'San José', district: 'Carmen' });
    assert.equal(r.branches[0].codigo, 'SJ01');
    assert.equal(r.place?.codigoPostal, '10101');
  });

  it('requests a pickup with codes and validates input', async () => {
    const { fake, svc } = service();
    await assert.rejects(svc.requestPickup({ cedula: '1', nombre: 'A', apellidos: 'B', place: { province: '1', canton: '01', district: '01' }, direccion: 'x', telefono: '88887777', correo: 'a@b.co', envios: ['PY1CR00'] }), CorreosV3Error);
    const r = await svc.requestPickup({ cedula: '1-1111-1111', nombre: 'Ana', apellidos: 'Mora', place: { province: 'San José', canton: 'San José', district: 'Carmen' }, direccion: 'Bodega', telefono: '8888-7777', correo: 'ana@tienda.cr', envios: ['PY1CR00', 'PY1CR00', ' PY2CR00 '] });
    assert.deepEqual(r.envios, ['PY1CR00', 'PY2CR00']);
    const body = fake.calls.find((c) => c.path === '/recolecciones/solicitar')!.body;
    assert.equal(body.provincia, '1');
    assert.equal(body.codigoPostal, '10101');
    assert.equal(body.cedula, '111111111');
  });
});

describe('Correos v3 boundary', () => {
  it('the staff bot never imports the v3 layer', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of [...walk('src/lib/bot'), ...walk('src/app/api/bot')]) {
      assert.ok(!/correos\/v3/.test(readFileSync(f, 'utf8')), `${f} imports correos/v3`);
    }
  });
});
