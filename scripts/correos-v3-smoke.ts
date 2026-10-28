/**
 * Live smoke test for the Correos v3 API.
 *
 *   npx tsx --import ./scripts/shim-server-only.mjs scripts/correos-v3-smoke.ts            # read-only
 *   npx tsx --import ./scripts/shim-server-only.mjs scripts/correos-v3-smoke.ts --register # ALSO one test guía (test env only,
 *                                                  # needs CORREOS_V3_SMOKE_ALLOW_WRITE=1)
 *
 * Reads CORREOS_V3_TEST_* (or CORREOS_V3_* with CORREOS_V3_ENV=prod) from the environment / .env.local.
 * Prints shapes and timings, never credentials or tokens.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CorreosV3Service } from '../src/lib/correos/v3/service';
import { selectV3Config } from '../src/lib/correos/v3/config';

function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadDotEnv('.env.local');
loadDotEnv('.env');

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const t = Date.now();
  try {
    const v = await fn();
    const preview = JSON.stringify(v, (_k, val) => (typeof val === 'string' && val.length > 80 ? `${val.slice(0, 40)}…(${val.length})` : val));
    console.log(`✔ ${name} ${Date.now() - t}ms ${preview?.slice(0, 400)}`);
    return v;
  } catch (e) {
    console.log(`✖ ${name} ${Date.now() - t}ms ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function main() {
  const resolved = selectV3Config({ db: {}, env: process.env });
  if (!resolved) {
    console.error('No CORREOS_V3_TEST_* / CORREOS_V3_* credentials found.');
    process.exit(2);
  }
  const { config } = resolved;
  const svc = new CorreosV3Service(config);
  console.log(`Correos v3 ${config.environment} → ${svc.client.baseUrl}`);

  if (!(await step('login', () => svc.client.getToken().then((t) => ({ tokenLength: t.length }))))) process.exit(1);
  const provs = await step('provincias', () => svc.geo.provincias());
  const cants = await step('cantones(1)', () => svc.geo.cantones(provs?.[0]?.codigo ?? '1'));
  await step('distritos(1,01)', () => svc.geo.distritos('1', cants?.[0]?.codigo ?? '01'));
  await step('barrios(1,01,01)', () => svc.geo.barrios('1', '01', '01').then((b) => ({ count: b.length, sample: b.slice(0, 3) })));
  await step('sucursales(1,01)', () => svc.geo.sucursales('1', '01'));
  await step('checkAddress San José/San José/Carmen', () => svc.checkAddress({ province: 'San José', canton: 'San José', district: 'Carmen' }));
  await step('quote SJ → Alajuela 500g', () => svc.quote({ origin: { province: 'San José', canton: 'San José', district: 'Carmen' }, dest: { province: 'Alajuela', canton: 'Alajuela', district: 'Alajuela' }, pesoG: 500 }));
  await step('quote SJ → Limón 2kg 30x40x30', () => svc.quote({ origin: { province: 'San José', canton: 'San José', district: 'Carmen' }, dest: { province: 'Limón', canton: 'Limón', district: 'Limón' }, pesoG: 2000, dims: { alto: 30, largo: 40, ancho: 30 } }));
  const guia = process.argv.find((a) => /^[A-Z]{2}\d{9}CR$/.test(a));
  if (guia) await step(`track ${guia}`, () => svc.track(guia));

  if (process.argv.includes('--register')) {
    if (config.environment !== 'test' || process.env.CORREOS_V3_SMOKE_ALLOW_WRITE !== '1') {
      console.error('Refusing to register: needs the TEST environment and CORREOS_V3_SMOKE_ALLOW_WRITE=1.');
      process.exit(3);
    }
    const r = await step('registrar (test, SUC)', async () => {
      const branches = await svc.geo.sucursales('1', '01');
      return svc.createGuia({
        dest: { name: 'PRUEBA BETSY', phone: '88888888', address: 'Prueba', province: 'San José', canton: 'San José', district: 'Carmen' },
        sender: { name: 'PRUEBA BETSY', phone: '22222222', address: 'San José', zip: '10101' },
        origin: { province: 'San José', canton: 'San José', district: 'Carmen' },
        pesoG: 500,
        tipoDestino: 'SUC',
        codigoSucursal: branches[0]?.codigo,
        observaciones: 'Prueba de integración Betsy',
      }).then((o) => (o.ok ? { guia: o.guiaNumber, pdfBytes: o.pdf?.length ?? 0, zpl: !!o.zpl, flete: o.montoFlete } : o));
    });
    const num = (r as { guia?: string } | null)?.guia;
    if (num) await step(`track ${num}`, () => svc.track(num));
  }
}

main();
