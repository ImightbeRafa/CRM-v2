/**
 * A tiny fake Correos v3 server (shapes copied from the official Swagger,
 * servicios.correos.go.cr:459/swagger/v3/swagger.json) for unit tests.
 */
export type FakeCall = { path: string; method: string; body?: any };

const ok = <T>(datos: T) => ({ exito: true, mensaje: 'Consulta realizada correctamente', datos, errores: null });

export const FIXTURES = {
  provincias: ok([
    { codigo: '1', nombre: 'San José' },
    { codigo: '2', nombre: 'Alajuela' },
  ]),
  cantones: {
    '1': ok([
      { codigo: '01', nombre: 'San José' },
      { codigo: '02', nombre: 'Escazú' },
    ]),
    '2': ok([{ codigo: '01', nombre: 'Alajuela' }]),
  } as Record<string, unknown>,
  distritos: {
    '1|01': ok([
      { codigo: '01', nombre: 'Carmen', codigoPostal: '10101', poseeSucursal: 'S' },
      { codigo: '02', nombre: 'Merced', codigoPostal: '10102', poseeSucursal: 'N' },
    ]),
    '1|02': ok([{ codigo: '01', nombre: 'Escazú', codigoPostal: '10201', poseeSucursal: 'S' }]),
    '2|01': ok([{ codigo: '01', nombre: 'Alajuela', codigoPostal: '20101', poseeSucursal: 'S' }]),
  } as Record<string, unknown>,
  barrios: {
    '1|01|01': ok([
      { codigo: '', nombre: 'BARRIO AMON', zonaRestringida: 'N' },
      { codigo: '', nombre: 'BARRIO PELIGRO', zonaRestringida: 'S' },
    ]),
  } as Record<string, unknown>,
  sucursales: {
    '1|01': ok([
      { codigo: 'SJ01', nombre: 'Sucursal Central', correo: 'central@correos.go.cr', direccion: 'San José Centro', horario: 'L-V 8:00-17:00', latitud: 9.9325, longitud: -84.0796 },
    ]),
  } as Record<string, unknown>,
  tarifa: ok({ monto: 2600, descuento: 100, impuesto: 338 }),
  guia: ok({ envioId: 'PY002036568CR', pdfBase64: Buffer.from('%PDF-1.7 fake').toString('base64'), zpl: '^XA^FDtest^FS^XZ' }),
  rastreo: ok({
    envio: {
      envioId: 'PY002036568CR', unidadOrigen: 'Sucursal Zapote', latitudUnidadOrigen: 9.9325, longitudUnidadOrigen: -84.0796,
      envioReferencia: '', nombreDestinatario: 'CARLOS FONSECA', fechaEntrega: null, personaEntrega: '', codigoEstado: 'AC',
      estado: 'EN TRANSITO', fechaRecepcion: '2026-06-04T15:48:27', codigoServicio: 1564, servicio: 'PYMEXPRES',
      telefono: '888888888', direccion: 'Prueba guia', codigoPostal: '20302',
    },
    eventos: [
      { fecha: '2026-06-04T15:48:27', ubicacion: 'Sucursal Zapote', codigo: 'EMA', descripcion: 'TU PAQUETE FUE RECIBIDO POR CORREOS DE COSTA RICA', recibidoPor: '', latitud: 9.9325, longitud: -84.0796 },
    ],
  }),
};

export function fakeCorreos(overrides: Partial<Record<string, (c: FakeCall) => Response | undefined>> = {}) {
  const calls: FakeCall[] = [];
  const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const impl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^.*\/api\/v3/, '');
    const call: FakeCall = { path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const o = overrides[path]?.(call);
    if (o) return o;
    const q = (k: string) => u.searchParams.get(k) ?? '';
    switch (path) {
      case '/auth/login': return res(200, { accessToken: 'tok', expiresIn: 3600, refreshToken: 'ref' });
      case '/ubicaciones/provincias': return res(200, FIXTURES.provincias);
      case '/ubicaciones/cantones': return res(200, FIXTURES.cantones[q('provincia')] ?? ok([]));
      case '/ubicaciones/distritos': return res(200, FIXTURES.distritos[`${q('provincia')}|${q('canton')}`] ?? ok([]));
      case '/ubicaciones/barrios': return res(200, FIXTURES.barrios[`${q('provincia')}|${q('canton')}|${q('distrito')}`] ?? ok([]));
      case '/ubicaciones/sucursales': return res(200, FIXTURES.sucursales[`${q('provincia')}|${q('canton')}`] ?? ok([]));
      case '/tarifas/calcular': return res(200, FIXTURES.tarifa);
      case '/guiasweb/registrar': return res(200, FIXTURES.guia);
      case '/envios/rastreo': return res(200, FIXTURES.rastreo);
      case '/recolecciones/solicitar': return res(200, { exito: true, mensaje: 'Recolección registrada correctamente', datos: null, errores: null });
      default: return res(404, 'not found');
    }
  };
  return { calls, impl };
}

export const TEST_CONFIG = {
  environment: 'test' as const,
  username: 'u',
  password: 'p',
  codCliente: 7362097,
  servicioId: 1564,
  baseUrl: 'https://correos.fake/api/v3',
};
