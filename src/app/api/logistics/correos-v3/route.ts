import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { encrypt } from '@/lib/encryption';
import { V3_DB_KEYS, parseV3Environment, resolveV3Config } from '@/lib/correos/v3/config';
import { CorreosV3Service } from '@/lib/correos/v3/service';
import { __resetV3SelectCache } from '@/lib/correos/v3/select';
import { CorreosV3Client, resolveV3BaseUrl } from '@/lib/correos/v3/client';
import { getLiveToken } from '@/lib/live-token';

/** Changing the platform Correos account / switch is super-admin only (SecureDog AUTH-61). */
async function superAdminId(req: NextRequest): Promise<string | null> {
  const token = await getLiveToken({ req, secret: process.env.NEXTAUTH_SECRET || '' });
  if (!token?.sub) return null;
  const u = await prisma.user.findUnique({ where: { id: token.sub }, select: { isSuperAdmin: true } });
  return u?.isSuperAdmin ? token.sub : null;
}

const maskCedula = (v: string) => (v ? `•••${v.replace(/\D/g, '').slice(-3)}` : '');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Correos API v3 platform settings (logistics admins only).
 * GET    → masked settings + status
 * PATCH  → save (password encrypted; empty password keeps the stored one)
 * POST   → connection test: login + provincias + sucursales (read-only)
 */

async function readKeys(): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM lm_carrier_configs WHERE key LIKE 'correos_v3_%'
  `;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function upsert(key: string, value: string, description: string) {
  await prisma.$executeRaw`
    INSERT INTO lm_carrier_configs (carrier, key, value, description)
    VALUES ('correos', ${key}, ${value}, ${description})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;
  try {
    const db = await readKeys();
    const resolved = await resolveV3Config();
    const environment = parseV3Environment(db[V3_DB_KEYS.environment]);
    return NextResponse.json({
      enabled: db[V3_DB_KEYS.enabled] === '1',
      environment,
      username: db[V3_DB_KEYS.username] || '',
      hasPassword: !!db[V3_DB_KEYS.password],
      codCliente: db[V3_DB_KEYS.codCliente] || '',
      servicioId: db[V3_DB_KEYS.servicioId] || '',
      usuarioId: db[V3_DB_KEYS.usuarioId] || '',
      pickupCedula: maskCedula(db[V3_DB_KEYS.pickupCedula] || ''),
      hasPickupCedula: !!db[V3_DB_KEYS.pickupCedula],
      tenants: db[V3_DB_KEYS.tenants] || '',
      pickupEmail: db[V3_DB_KEYS.pickupEmail] || '',
      baseUrl: resolveV3BaseUrl(resolved?.config.environment ?? environment),
      status: {
        configured: !!resolved,
        source: resolved?.source ?? null,
        activeEnvironment: resolved?.config.environment ?? null,
        enabled: !!resolved?.enabled,
      },
    });
  } catch (e) {
    console.error('[logistics/correos-v3 GET]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo leer la configuración' }, { status: 500 });
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

export async function PATCH(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;
  const adminId = await superAdminId(req);
  if (!adminId) return NextResponse.json({ error: 'Solo un super admin puede cambiar la cuenta de Correos.' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const errors: string[] = [];
  const codCliente = str(body.codCliente, 20);
  const servicioId = str(body.servicioId, 10);
  if (codCliente && !/^\d{1,15}$/.test(codCliente)) errors.push('Código de cliente: solo números.');
  if (servicioId && !/^\d{1,6}$/.test(servicioId)) errors.push('Código de servicio: solo números.');
  const email = str(body.pickupEmail, 150);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Correo de recolección inválido.');
  if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 400 });

  const tenants = typeof body.tenants === 'string' ? body.tenants.trim().slice(0, 4000) : undefined;
  if (tenants !== undefined && tenants !== '*' && tenants !== '' && !/^[A-Za-z0-9_\-,\s]+$/.test(tenants)) {
    return NextResponse.json({ error: 'Tiendas: IDs separados por coma, o * para todas.' }, { status: 400 });
  }
  const before = await resolveV3Config();
  const changed: string[] = [];
  try {
    if (typeof body.enabled === 'boolean') await upsert(V3_DB_KEYS.enabled, body.enabled ? '1' : '0', 'Correos API v3 platform switch');
    if (body.environment !== undefined) await upsert(V3_DB_KEYS.environment, parseV3Environment(String(body.environment)), 'Correos API v3 environment (test|prod)');
    const username = str(body.username, 50);
    if (username !== undefined && username) await upsert(V3_DB_KEYS.username, username, 'Correos API v3 user');
    const password = typeof body.password === 'string' ? body.password.slice(0, 100) : '';
    if (password) await upsert(V3_DB_KEYS.password, encrypt(password), 'Correos API v3 password (encrypted)');
    if (codCliente !== undefined && codCliente) await upsert(V3_DB_KEYS.codCliente, codCliente, 'Correos API v3 client code');
    if (servicioId !== undefined && servicioId) await upsert(V3_DB_KEYS.servicioId, servicioId, 'Correos API v3 service code');
    const usuarioId = str(body.usuarioId, 20);
    if (usuarioId !== undefined) await upsert(V3_DB_KEYS.usuarioId, usuarioId, 'Correos API v3 usuarioId');
    const cedula = str(body.pickupCedula, 20);
    if (cedula !== undefined && !cedula.startsWith('•')) await upsert(V3_DB_KEYS.pickupCedula, cedula, 'Cédula for Correos pickup requests');
    if (email !== undefined) await upsert(V3_DB_KEYS.pickupEmail, email, 'Email for Correos pickup requests');
    if (tenants !== undefined) await upsert(V3_DB_KEYS.tenants, tenants, 'Stores allowed to write through Correos API v3 (* = all)');
    for (const k of ['enabled', 'environment', 'username', 'password', 'codCliente', 'servicioId', 'usuarioId', 'pickupCedula', 'pickupEmail', 'tenants']) {
      if (body[k] !== undefined && body[k] !== '') changed.push(k);
    }
    __resetV3SelectCache();
    // Credentials / environment changed: revoke the old refresh token (best effort).
    if (before && (changed.includes('password') || changed.includes('username') || changed.includes('environment'))) {
      await new CorreosV3Client(before.config).revoke().catch(() => {});
    }
    // Audit: who changed which keys (never the values). Platform-level, so it goes to the server log.
    console.info('[audit] correos-v3 settings changed', JSON.stringify({ userId: adminId, keys: changed, at: new Date().toISOString() }));
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[logistics/correos-v3 PATCH]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;
  const resolved = await resolveV3Config();
  if (!resolved) return NextResponse.json({ ok: false, results: [], diagnosis: 'Faltan credenciales v3 (usuario, contraseña, código de cliente y servicio).' });
  const svc = new CorreosV3Service(resolved.config, { timeoutMs: 12_000 });
  const results: { step: string; ok: boolean; ms: number; detail?: string }[] = [];
  const run = async (step: string, fn: () => Promise<string>) => {
    const t = Date.now();
    try {
      results.push({ step, ok: true, ms: Date.now() - t, detail: await fn() });
      results[results.length - 1].ms = Date.now() - t;
      return true;
    } catch (e) {
      results.push({ step, ok: false, ms: Date.now() - t, detail: e instanceof Error ? e.message : 'Error' });
      return false;
    }
  };
  const loggedIn = await run('login', async () => {
    await svc.client.getToken();
    return `Autenticado en ${resolved.config.environment === 'prod' ? 'producción' : 'pruebas'}`;
  });
  if (loggedIn) {
    await run('provincias', async () => `${(await svc.geo.provincias()).length} provincias`);
    await run('sucursales', async () => `${(await svc.geo.sucursales('1', '01')).length} sucursales en San José centro`);
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({
    ok,
    environment: resolved.config.environment,
    results,
    diagnosis: ok ? 'Conexión v3 correcta.' : loggedIn ? 'Login correcto, pero una consulta falló.' : 'Correos rechazó el login v3. Revisá usuario/contraseña o pedí a Correos que active la cuenta.',
  });
}
