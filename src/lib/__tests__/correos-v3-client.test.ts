import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CorreosV3Client, CorreosV3Error, __resetV3TokenCache, resolveV3BaseUrl } from '../correos/v3/client';
import type { CorreosV3Config } from '../correos/v3/types';

const CONFIG: CorreosV3Config = {
  environment: 'test',
  username: 'u',
  password: 'p',
  codCliente: 7362097,
  servicioId: 1564,
  baseUrl: 'https://correos.test/api/v3',
};

type Call = { url: string; method: string; body?: any; auth?: string };

function json(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function fakeFetch(routes: Array<(c: Call) => Response | undefined | Promise<Response | undefined>>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: h.authorization,
    };
    calls.push(call);
    for (const r of routes) {
      const res = await r(call);
      if (res) return res;
    }
    return json(404, 'no route');
  };
  return { calls, impl };
}

const login = (c: Call) =>
  c.url.endsWith('/auth/login')
    ? json(200, { accessToken: 'tok-1', expiresIn: 3600, refreshToken: 'ref-1' })
    : undefined;

const noSleep = { sleep: async () => {} };

describe('Correos v3 client', () => {
  beforeEach(() => __resetV3TokenCache());

  it('logs in once and reuses the token', async () => {
    const f = fakeFetch([
      login,
      (c) => (c.url.includes('/ubicaciones/provincias') ? json(200, { exito: true, mensaje: 'ok', datos: [{ codigo: '1', nombre: 'San José' }], errores: null }) : undefined),
    ]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, ...noSleep });
    assert.deepEqual(await client.provincias(), [{ codigo: '1', nombre: 'San José' }]);
    await client.provincias();
    assert.equal(f.calls.filter((c) => c.url.endsWith('/auth/login')).length, 1);
    assert.equal(f.calls.at(-1)!.auth, 'Bearer tok-1');
    assert.deepEqual(f.calls[0].body, { usuario: 'u', password: 'p' });
  });

  it('refreshes with the refresh token when the access token expires', async () => {
    let t = 1_000_000;
    const f = fakeFetch([
      login,
      (c) => (c.url.endsWith('/auth/refresh') ? json(200, { accessToken: 'tok-2', expiresIn: 3600, refreshToken: 'ref-2' }) : undefined),
      () => json(200, { exito: true, mensaje: null, datos: [], errores: null }),
    ]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, now: () => t, ...noSleep });
    await client.provincias();
    t += 3600 * 1000;
    await client.provincias();
    const refresh = f.calls.find((c) => c.url.endsWith('/auth/refresh'));
    assert.deepEqual(refresh?.body, { refreshToken: 'ref-1' });
    assert.equal(f.calls.at(-1)!.auth, 'Bearer tok-2');
  });

  it('re-logs in once on a 401 from a protected call', async () => {
    let first = true;
    const f = fakeFetch([
      login,
      (c) => {
        if (!c.url.includes('/envios/rastreo')) return undefined;
        if (first) {
          first = false;
          return json(401, { title: 'Unauthorized', status: 401 });
        }
        return json(200, { exito: true, mensaje: null, datos: { envio: null, eventos: [] }, errores: null });
      },
    ]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, ...noSleep });
    const r = await client.rastreo('PY1CR');
    assert.deepEqual(r.eventos, []);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/auth/login')).length, 2);
  });

  it('maps a rejected login to an auth error', async () => {
    const f = fakeFetch([(c) => (c.url.endsWith('/auth/login') ? json(401, 'Credenciales no válidas') : undefined)]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, ...noSleep });
    await assert.rejects(client.provincias(), (e: unknown) => e instanceof CorreosV3Error && e.auth && /credenciales/i.test(e.message));
  });

  it('surfaces exito=false with the Correos message', async () => {
    const f = fakeFetch([
      login,
      () => json(400, { exito: false, mensaje: 'Teléfono inválido', datos: null, errores: ['destTelefono'] }),
    ]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, ...noSleep });
    await assert.rejects(
      client.registrarGuia({ fechaImposicion: 'x', envioId: '', montoFlete: 0, destNombre: 'A', destTelefono: '1', sendNombre: 'S', sendDireccion: 'D', sendTelefono: '2', sendZip: '10101', peso: 500, tipoDestino: 'DOM' }),
      (e: unknown) => e instanceof CorreosV3Error && e.message === 'Teléfono inválido' && e.status === 400,
    );
  });

  it('never retries a guía registration on network failure', async () => {
    let n = 0;
    const f = fakeFetch([
      login,
      (c) => {
        if (c.url.endsWith('/guiasweb/registrar')) {
          n++;
          throw new Error('socket hang up');
        }
        return undefined;
      },
    ]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, ...noSleep });
    await assert.rejects(
      client.registrarGuia({ fechaImposicion: 'x', envioId: '', montoFlete: 0, destNombre: 'A', destTelefono: '88888888', sendNombre: 'S', sendDireccion: 'D', sendTelefono: '22222222', sendZip: '10101', peso: 500, tipoDestino: 'DOM' }),
      CorreosV3Error,
    );
    assert.equal(n, 1);
  });

  it('retries reads on 503 and network errors', async () => {
    let n = 0;
    const f = fakeFetch([
      login,
      (c) => {
        if (!c.url.includes('/ubicaciones/sucursales')) return undefined;
        n++;
        if (n === 1) throw new Error('ECONNRESET');
        if (n === 2) return json(503, 'busy');
        return json(200, { exito: true, mensaje: null, datos: [{ codigo: 'SJ01', nombre: 'Central', correo: null, direccion: null, horario: null, latitud: 9.9, longitud: -84 }], errores: null });
      },
    ]);
    const client = new CorreosV3Client(CONFIG, { fetchImpl: f.impl, ...noSleep });
    const s = await client.sucursales('1', '01');
    assert.equal(s[0].codigo, 'SJ01');
    assert.equal(n, 3);
  });

  it('fills cliente/servicio defaults and drops undefined optional fields', async () => {
    const f = fakeFetch([
      login,
      (c) => (c.url.endsWith('/guiasweb/registrar') ? json(200, { exito: true, mensaje: 'ok', datos: { envioId: 'PY1CR', pdfBase64: 'JVBE', zpl: '^XA' }, errores: null }) : undefined),
    ]);
    const client = new CorreosV3Client({ ...CONFIG, usuarioId: '105838' }, { fetchImpl: f.impl, ...noSleep });
    const r = await client.registrarGuia({ fechaImposicion: 'x', envioId: '', montoFlete: 1800, destNombre: 'A', destTelefono: '88888888', sendNombre: 'S', sendDireccion: 'D', sendTelefono: '22222222', sendZip: '10101', peso: 500, tipoDestino: 'SUC', codigoSucursal: '2010', destDireccion: undefined });
    assert.equal(r.envioId, 'PY1CR');
    const body = f.calls.at(-1)!.body;
    assert.equal(body.codigoCliente, 7362097);
    assert.equal(body.servicioId, 1564);
    assert.equal(body.usuarioId, '105838');
    assert.ok(!('destDireccion' in body));
  });

  it('resolves base URLs for direct, override and proxy', () => {
    assert.equal(resolveV3BaseUrl('test', {}), 'https://servicios.correos.go.cr:459/api/v3');
    assert.equal(resolveV3BaseUrl('prod', {}), 'https://amistadpro.correos.go.cr:449/api/v3');
    assert.equal(resolveV3BaseUrl('prod', { CORREOS_PROXY_URL: 'https://relay.x/', CORREOS_PROXY_SECRET: 's' }), 'https://relay.x/v3/prod');
    assert.equal(resolveV3BaseUrl('test', { CORREOS_V3_TEST_BASE_URL: 'https://t/api/v3/' }), 'https://t/api/v3');
  });
});
