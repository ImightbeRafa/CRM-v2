import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { authenticateAPI } from '@/lib/auth-helpers';
import { hasPermission } from '@/lib/rbac';
import { createRedisLimiter, rateLimitAsync } from '@/lib/rate-limit';
import { getCorreosV3ForRead, getCorreosV3ForWrite } from '@/lib/correos/v3/select';
import { CorreosV3Error } from '@/lib/correos/v3/client';
import { SHIPMENT_STATUS_LABEL } from '@/lib/correos/v3/mappers';
import { claimPickup, ensureTracked, finishPickup, getEvents, getGuiaExtras, pickupStatus, recentPickupLoad, recentPickups, saveTracking } from '@/lib/correos/v3/store';
import { loadTenantCorreosSettings, tenantOrigin, tenantOwnsGuias } from '@/lib/correos/v3/tenant';
import { resolveV3Config } from '@/lib/correos/v3/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Correos v3 helpers for the store UI and guía flow (tenant-scoped).
 *
 * GET  geo?level=provincias|cantones|distritos|barrios&provincia=&canton=&distrito=
 * GET  branches?province=&canton=&district=          (names or codes)
 * POST check-address { province, canton, district, barrio? }
 * POST quote { dest: {province,canton,district}, pesoG?, dims? }   (origin = store settings)
 * GET  track?guia=XX                                   (store-owned guías only)
 * GET  extras?guias=A,B                                (v3 data for the history list)
 * POST pickup { guias: string[], address, contactName?, phone?, idempotencyKey }
 * GET  pickups
 *
 * Reads need view_production or view_sales; pickup needs update_production.
 */

type Ctx = { params: Promise<{ action: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const s = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const GUIA_RE = /^[A-Za-z0-9-]{4,50}$/;
const CODE_RE = /^\d{1,2}$/;
const READ_PER_MIN = 120;
const WRITE_PER_MIN = 5;
/** Pickups a store may ask Correos for in 24 h (trucks under the platform account, INT-238). */
const PICKUPS_PER_DAY = 5;
const readLimiter = createRedisLimiter({ prefix: 'correos-v3-r', maxRequests: READ_PER_MIN, windowMs: 60_000 });
const writeLimiter = createRedisLimiter({ prefix: 'correos-v3-w', maxRequests: WRITE_PER_MIN, windowMs: 60_000 });

function v3Error(e: unknown) {
  if (e instanceof CorreosV3Error) {
    const status = e.auth ? 502 : e.status >= 400 && e.status < 500 ? 400 : 502;
    return bad(e.auth ? 'Correos rechazó las credenciales de la plataforma.' : e.message, status);
  }
  console.error('[shipping/correos]', e instanceof Error ? e.message : e);
  return bad('No se pudo consultar a Correos. Probá de nuevo.', 502);
}

async function guard(req: NextRequest, write: boolean) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return { res: auth.response } as const;
  const allowed = write
    ? hasPermission(auth.role, 'update_production')
    : hasPermission(auth.role, 'view_production') || hasPermission(auth.role, 'view_sales');
  if (!allowed) return { res: bad('Forbidden', 403) } as const;
  // Shared across containers (Upstash) so stores cannot burn the platform's Correos quota (INT-239).
  const rl = await rateLimitAsync(`${auth.tenantId}`, write ? writeLimiter : readLimiter, {
    windowMs: 60_000,
    maxRequests: write ? WRITE_PER_MIN : READ_PER_MIN,
    prefix: write ? 'correos-v3-w' : 'correos-v3-r',
  });
  if (!rl.allowed) return { res: NextResponse.json({ error: 'Demasiadas consultas, esperá un momento.' }, { status: 429, headers: rl.headers }) } as const;
  return { auth } as const;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { action } = await params;
  const g = await guard(req, false);
  if ('res' in g) return g.res;
  const { tenantId } = g.auth;
  const q = req.nextUrl.searchParams;

  if (action === 'extras') {
    const guias = s(q.get('guias'), 6000).split(',').map((x) => x.trim()).filter((x) => GUIA_RE.test(x)).slice(0, 200);
    const extras = await getGuiaExtras(tenantId, guias);
    return NextResponse.json({
      extras: Object.fromEntries([...extras].map(([k, v]) => [k, {
        api: v.api_version, environment: v.environment, tipoDestino: v.tipo_destino, sucursal: v.sucursal_nombre || v.codigo_sucursal,
        hasZpl: v.has_zpl, montoFlete: v.monto_flete, pesoG: v.peso_g, status: v.last_status,
        statusLabel: v.last_status ? SHIPMENT_STATUS_LABEL[v.last_status] : null, statusText: v.last_status_text,
        deliveredAt: v.delivered_at, receivedBy: v.received_by, lastCheckedAt: v.last_checked_at,
      }])),
    });
  }

  if (action === 'pickups') {
    const rows = await recentPickups(tenantId, 10);
    return NextResponse.json({ pickups: rows.map((r) => ({ id: String(r.id), guias: r.guia_numbers, status: r.status, error: r.error, createdAt: r.created_at })) });
  }

  const v3 = await getCorreosV3ForRead().catch(() => null);
  if (!v3) return bad('La API v3 de Correos no está activa.', 409);

  try {
    if (action === 'geo') {
      const level = q.get('level');
      const p = s(q.get('provincia'), 2);
      const c = s(q.get('canton'), 3);
      const d = s(q.get('distrito'), 3);
      if ([p, c, d].some((x) => x && !CODE_RE.test(x))) return bad('Parámetros inválidos');
      if (level === 'provincias') return NextResponse.json({ items: await v3.geo.provincias() });
      if (level === 'cantones' && p) return NextResponse.json({ items: await v3.geo.cantones(p) });
      if (level === 'distritos' && p && c) return NextResponse.json({ items: await v3.geo.distritos(p, c) });
      if (level === 'barrios' && p && c && d) return NextResponse.json({ items: await v3.geo.barrios(p, c, d) });
      return bad('Parámetros inválidos');
    }

    if (action === 'branches') {
      const r = await v3.branchesFor({ province: s(q.get('province')), canton: s(q.get('canton')), district: s(q.get('district')) });
      return NextResponse.json({ branches: r.branches, place: r.place ? { codigoPostal: r.place.codigoPostal, poseeSucursal: r.place.poseeSucursal } : null });
    }

    if (action === 'track') {
      const guia = s(q.get('guia'), 50);
      if (!GUIA_RE.test(guia)) return bad('Número de guía inválido');
      const [owned] = await tenantOwnsGuias(tenantId, [guia]);
      if (!owned) return bad('Guía no encontrada', 404);
      try {
        const t = await v3.track(guia);
        await ensureTracked({ guiaNumber: guia, tenantId, environment: v3.environment });
        await saveTracking(tenantId, t);
        // Only what the timeline shows (no recipient name / phone / address from Correos).
        return NextResponse.json({
          live: true,
          tracking: {
            guiaNumber: t.guiaNumber, status: t.status, statusLabel: SHIPMENT_STATUS_LABEL[t.status], statusText: t.statusText,
            deliveredAt: t.deliveredAt, deliveredTo: t.deliveredTo, events: t.events,
          },
        });
      } catch (e) {
        // Correos down: show what we stored.
        const events = await getEvents(tenantId, guia);
        if (events.length === 0) throw e;
        return NextResponse.json({
          live: false,
          tracking: {
            guiaNumber: guia,
            events: events.map((ev) => ({ at: ev.event_at, code: ev.codigo, description: ev.descripcion, place: ev.ubicacion, receivedBy: ev.recibido_por, lat: ev.lat, lng: ev.lng })),
          },
        });
      }
    }
  } catch (e) {
    return v3Error(e);
  }
  return bad('Acción desconocida', 404);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { action } = await params;
  const write = action === 'pickup';
  const g = await guard(req, write);
  if ('res' in g) return g.res;
  const { tenantId, userId } = g.auth;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad('JSON inválido');
  }

  const settings = await loadTenantCorreosSettings(tenantId);
  const v3 = write ? await getCorreosV3ForWrite(settings, tenantId).catch(() => null) : await getCorreosV3ForRead().catch(() => null);
  if (!v3) return bad(write ? 'Esta tienda no usa la API v3 de Correos.' : 'La API v3 de Correos no está activa.', 409);

  try {
    if (action === 'check-address') {
      const r = await v3.checkAddress({ province: s(body?.province), canton: s(body?.canton), district: s(body?.district), barrio: s(body?.barrio, 120) || null });
      return NextResponse.json({ ok: r.ok, codigoPostal: r.codigoPostal, poseeSucursal: r.poseeSucursal, restricted: r.restricted, districtHasRestricted: r.districtHasRestricted, problems: r.problems });
    }

    if (action === 'quote') {
      const origin = tenantOrigin(settings);
      if (!origin) return bad('Configurá el lugar de origen en Configuración › Envíos para cotizar.', 409);
      const d = body?.dims;
      const dims = d && typeof d === 'object' ? { alto: Number(d.alto) || 0, largo: Number(d.largo) || 0, ancho: Number(d.ancho) || 0 } : null;
      const pesoG = Number(body?.pesoG) || Number(settings.ws_default_weight_g) || 500;
      const quote = await v3.quote({ origin, dest: { province: s(body?.dest?.province), canton: s(body?.dest?.canton), district: s(body?.dest?.district) }, pesoG, dims });
      // Only the total: the platform's negotiated discount is not a store's business (DATA-78).
      return NextResponse.json({ quote: { total: quote.total }, pesoG });
    }

    if (action === 'pickup') {
      const key = s(body?.idempotencyKey, 80);
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return bad('Falta la clave de la solicitud.');
      const requested = Array.isArray(body?.guias) ? body.guias.map((x: unknown) => s(x, 50)).filter((x: string) => GUIA_RE.test(x)) : [];
      const owned = await tenantOwnsGuias(tenantId, requested);
      if (owned.length === 0) return bad('Elegí guías de esta tienda.');
      const recent = await recentPickupLoad(tenantId);
      if (recent.count >= PICKUPS_PER_DAY) return bad(`Máximo ${PICKUPS_PER_DAY} recolecciones por día. Probá mañana o llamá a Correos.`, 429);
      const guias = owned.filter((g) => !recent.guias.has(g));
      if (guias.length === 0) return bad('Esas guías ya tienen una recolección solicitada en las últimas 24 h.', 409);
      const origin = tenantOrigin(settings);
      if (!origin) return bad('Configurá el lugar de origen en Configuración › Envíos.', 409);
      const address = s(body?.address, 300) || s(settings.ws_sender_address, 300);
      if (!address) return bad('Falta la dirección de recolección.');

      const platform = await resolveV3Config();
      // Each store asks under its own cédula: never the platform's (INT-238).
      const cedula = s(settings.correos_pickup_cedula, 20);
      const correo = s(settings.correos_pickup_email, 150);
      if (!cedula || !correo) return bad('Falta la cédula y el correo para recolecciones (Configuración › Envíos).', 409);

      // Scoped per store so two stores can never collide on a key.
      const scopedKey = createHash('sha256').update(`${tenantId}\0${key}`).digest('hex').slice(0, 64);
      const claim = await claimPickup({ key: scopedKey, tenantId, userId: userId ?? null, guias, address, environment: platform?.config.environment ?? 'prod' });
      if (claim === 'duplicate') {
        const status = await pickupStatus(scopedKey);
        return NextResponse.json({ ok: status === 'sent', duplicate: true, status, guias });
      }
      if (claim === 'unavailable') return bad('Las recolecciones aún no están habilitadas (falta aplicar la base de datos).', 409);

      const fullName = s(body?.contactName, 200) || s(settings.ws_sender_name, 200);
      const [nombre, ...rest] = fullName.split(/\s+/);
      try {
        await v3.requestPickup({
          cedula,
          nombre: nombre || fullName,
          apellidos: rest.join(' '),
          place: origin,
          direccion: address,
          telefono: s(body?.phone, 20) || s(settings.ws_sender_phone, 20),
          correo,
          envios: guias,
        });
        await finishPickup(scopedKey, 'sent');
        return NextResponse.json({ ok: true, guias });
      } catch (e) {
        const known = e instanceof CorreosV3Error && e.status >= 400 && e.status < 500;
        await finishPickup(scopedKey, known ? 'failed' : 'unknown', e instanceof Error ? e.message : null);
        return v3Error(e);
      }
    }
  } catch (e) {
    return v3Error(e);
  }
  return bad('Acción desconocida', 404);
}
