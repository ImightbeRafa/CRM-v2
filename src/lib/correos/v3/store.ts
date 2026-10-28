import { prisma } from '@/lib/db';
import type { CorreosV3Environment, V3TipoDestino } from './types';
import { CLOSED_STATUSES, nextCheckDelayMs, type CorreosShipmentStatus, type NormalizedTracking } from './mappers';

/**
 * Raw-SQL store for the Correos v3 tables (supabase/migrations/065_correos_v3.sql).
 * Not in Prisma on purpose: until 065 is applied every function quietly does
 * nothing (42P01 "relation does not exist" is swallowed), so this code can ship first.
 */

export function isMissingTable(e: unknown): boolean {
  const s = e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ''}` : String(e);
  return /42P01|relation .* does not exist|lm_correos_\w+.*does not exist/i.test(s);
}

async function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTable(e)) return fallback;
    throw e;
  }
}

export interface CorreosGuiaExtra {
  guia_number: string;
  shipping_guia_id: string | null;
  crm_tenant_id: string;
  order_number: string | null;
  api_version: 'v3' | 'soap';
  environment: CorreosV3Environment;
  tipo_destino: V3TipoDestino | null;
  codigo_sucursal: string | null;
  sucursal_nombre: string | null;
  has_zpl: boolean;
  monto_flete: number | null;
  peso_g: number | null;
  last_status: CorreosShipmentStatus | null;
  last_status_text: string | null;
  delivered_at: Date | null;
  received_by: string | null;
  last_event_at: Date | null;
  last_checked_at: Date | null;
  closed: boolean;
}

export async function saveV3Guia(input: {
  guiaNumber: string;
  shippingGuiaId?: string | null;
  tenantId: string;
  crmOrderId?: string | null;
  orderNumber?: string | null;
  environment: CorreosV3Environment;
  tipoDestino: V3TipoDestino;
  codigoSucursal?: string | null;
  sucursalNombre?: string | null;
  zpl?: string | null;
  montoFlete?: number | null;
  pesoG?: number | null;
  destZip?: string | null;
}): Promise<boolean> {
  return safe(false, async () => {
    await prisma.$executeRaw`
      INSERT INTO lm_correos_guias (guia_number, shipping_guia_id, crm_tenant_id, crm_order_id, order_number, api_version,
        environment, tipo_destino, codigo_sucursal, sucursal_nombre, zpl, monto_flete, peso_g, dest_zip, last_status, next_check_at)
      VALUES (${input.guiaNumber}, ${input.shippingGuiaId ?? null}, ${input.tenantId}, ${input.crmOrderId ?? null},
        ${input.orderNumber ?? null}, 'v3', ${input.environment}, ${input.tipoDestino}, ${input.codigoSucursal ?? null},
        ${input.sucursalNombre?.slice(0, 200) ?? null}, ${input.zpl?.slice(0, 200_000) ?? null}, ${input.montoFlete ?? null},
        ${input.pesoG ?? null}, ${input.destZip ?? null}, 'created', now() + interval '2 hours')
      ON CONFLICT (guia_number) DO UPDATE SET
        shipping_guia_id = COALESCE(EXCLUDED.shipping_guia_id, lm_correos_guias.shipping_guia_id),
        zpl = COALESCE(EXCLUDED.zpl, lm_correos_guias.zpl),
        updated_at = now()
    `;
    return true;
  });
}

/** Starts tracking a guía made elsewhere (SOAP / manual) so the sync can follow it. */
export async function ensureTracked(input: { guiaNumber: string; tenantId: string; shippingGuiaId?: string | null; orderNumber?: string | null }) {
  return safe(false, async () => {
    await prisma.$executeRaw`
      INSERT INTO lm_correos_guias (guia_number, shipping_guia_id, crm_tenant_id, order_number, api_version, next_check_at)
      VALUES (${input.guiaNumber}, ${input.shippingGuiaId ?? null}, ${input.tenantId}, ${input.orderNumber ?? null}, 'soap', now())
      ON CONFLICT (guia_number) DO NOTHING
    `;
    return true;
  });
}

export async function getGuiaExtras(tenantId: string, guiaNumbers: string[]): Promise<Map<string, CorreosGuiaExtra>> {
  const list = [...new Set(guiaNumbers.filter(Boolean))].slice(0, 500);
  if (list.length === 0) return new Map();
  const rows = await safe<CorreosGuiaExtra[]>([], () =>
    prisma.$queryRaw<CorreosGuiaExtra[]>`
      SELECT guia_number, shipping_guia_id, crm_tenant_id, order_number, api_version, environment, tipo_destino,
             codigo_sucursal, sucursal_nombre, (zpl IS NOT NULL) AS has_zpl, monto_flete::float8 AS monto_flete, peso_g,
             last_status, last_status_text, delivered_at, received_by, last_event_at, last_checked_at, closed
      FROM lm_correos_guias
      WHERE crm_tenant_id = ${tenantId} AND guia_number = ANY(${list}::text[])
    `,
  );
  return new Map(rows.map((r) => [r.guia_number, r]));
}

export async function getZpl(tenantId: string | null, guiaNumber: string): Promise<string | null> {
  const rows = await safe<{ zpl: string | null }[]>([], () =>
    tenantId
      ? prisma.$queryRaw<{ zpl: string | null }[]>`SELECT zpl FROM lm_correos_guias WHERE guia_number = ${guiaNumber} AND crm_tenant_id = ${tenantId} LIMIT 1`
      : prisma.$queryRaw<{ zpl: string | null }[]>`SELECT zpl FROM lm_correos_guias WHERE guia_number = ${guiaNumber} LIMIT 1`,
  );
  return rows[0]?.zpl ?? null;
}

export interface StoredEvent {
  event_at: Date | null;
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  recibido_por: string | null;
  lat: number | null;
  lng: number | null;
}

export async function getEvents(tenantId: string | null, guiaNumber: string): Promise<StoredEvent[]> {
  return safe<StoredEvent[]>([], () =>
    tenantId
      ? prisma.$queryRaw<StoredEvent[]>`
          SELECT event_at, codigo, descripcion, ubicacion, recibido_por, lat, lng FROM lm_correos_tracking_events
          WHERE guia_number = ${guiaNumber} AND crm_tenant_id = ${tenantId} ORDER BY event_at NULLS FIRST, id LIMIT 200`
      : prisma.$queryRaw<StoredEvent[]>`
          SELECT event_at, codigo, descripcion, ubicacion, recibido_por, lat, lng FROM lm_correos_tracking_events
          WHERE guia_number = ${guiaNumber} ORDER BY event_at NULLS FIRST, id LIMIT 200`,
  );
}

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Correos sends local CR time without offset ("2026-06-04T15:48:27").
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}-06:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Saves a tracking answer: new events once, latest state, next check time.
 * Returns the previous status so callers can react to a change.
 */
export async function saveTracking(tenantId: string, t: NormalizedTracking, now = new Date()): Promise<{ previous: CorreosShipmentStatus | null; newEvents: number } | null> {
  return safe(null, async () => {
    const prev = await prisma.$queryRaw<{ last_status: CorreosShipmentStatus | null; created_at: Date }[]>`
      SELECT last_status, created_at FROM lm_correos_guias WHERE guia_number = ${t.guiaNumber} AND crm_tenant_id = ${tenantId} LIMIT 1
    `;
    let newEvents = 0;
    for (const ev of t.events.slice(-100)) {
      newEvents += await prisma.$executeRaw`
        INSERT INTO lm_correos_tracking_events (guia_number, crm_tenant_id, event_at, codigo, descripcion, ubicacion, recibido_por, lat, lng)
        VALUES (${t.guiaNumber}, ${tenantId}, ${toDate(ev.at)}, ${(ev.code ?? '').slice(0, 20)}, ${ev.description.slice(0, 300)},
          ${ev.place?.slice(0, 120) ?? null}, ${ev.receivedBy?.slice(0, 120) ?? null}, ${ev.lat}, ${ev.lng})
        ON CONFLICT (guia_number, coalesce(event_at, 'epoch'::timestamptz), codigo, descripcion) DO NOTHING
      `;
    }
    const createdAt = prev[0]?.created_at ?? now;
    const delay = nextCheckDelayMs(t.status, now.getTime() - new Date(createdAt).getTime());
    const closed = delay === null;
    const next = closed ? null : new Date(now.getTime() + delay);
    const lastEventAt = toDate(t.events.at(-1)?.at);
    await prisma.$executeRaw`
      INSERT INTO lm_correos_guias (guia_number, crm_tenant_id, api_version, last_status, last_status_text, last_status_code,
        delivered_at, received_by, last_event_at, last_checked_at, next_check_at, check_failures, closed)
      VALUES (${t.guiaNumber}, ${tenantId}, 'soap', ${t.status}, ${t.statusText?.slice(0, 300) ?? null}, ${t.statusCode},
        ${toDate(t.deliveredAt)}, ${t.deliveredTo?.slice(0, 200) ?? null}, ${lastEventAt}, ${now}, ${next}, 0, ${closed})
      ON CONFLICT (guia_number) DO UPDATE SET
        last_status = EXCLUDED.last_status, last_status_text = EXCLUDED.last_status_text,
        last_status_code = EXCLUDED.last_status_code, delivered_at = COALESCE(EXCLUDED.delivered_at, lm_correos_guias.delivered_at),
        received_by = COALESCE(EXCLUDED.received_by, lm_correos_guias.received_by),
        last_event_at = COALESCE(EXCLUDED.last_event_at, lm_correos_guias.last_event_at),
        last_checked_at = EXCLUDED.last_checked_at, next_check_at = EXCLUDED.next_check_at,
        check_failures = 0, closed = EXCLUDED.closed, updated_at = now()
      WHERE lm_correos_guias.crm_tenant_id = ${tenantId}
    `;
    return { previous: prev[0]?.last_status ?? null, newEvents };
  });
}

export async function markCheckFailed(guiaNumber: string) {
  return safe(false, async () => {
    await prisma.$executeRaw`
      UPDATE lm_correos_guias SET check_failures = check_failures + 1, last_checked_at = now(),
        next_check_at = now() + make_interval(hours => LEAST(24, 2 * (check_failures + 1))),
        closed = (check_failures + 1) >= 12, updated_at = now()
      WHERE guia_number = ${guiaNumber}
    `;
    return true;
  });
}

export async function dueForTracking(limit: number): Promise<Array<{ guia_number: string; crm_tenant_id: string; shipping_guia_id: string | null; last_status: CorreosShipmentStatus | null }>> {
  return safe([], () =>
    prisma.$queryRaw`
      SELECT guia_number, crm_tenant_id, shipping_guia_id, last_status FROM lm_correos_guias
      WHERE closed = false AND next_check_at <= now() AND environment = 'prod'
      ORDER BY next_check_at ASC LIMIT ${Math.max(1, Math.min(limit, 200))}
    `,
  );
}

export { CLOSED_STATUSES };

// ─── Pickups ────────────────────────────────────────────────────────────────

/** Claims a pickup key. Returns false if this key was already used (double click / retry). */
export async function claimPickup(input: { key: string; tenantId: string; userId: string | null; guias: string[]; address: string; environment: CorreosV3Environment }): Promise<'claimed' | 'duplicate' | 'unavailable'> {
  try {
    const n = await prisma.$executeRaw`
      INSERT INTO lm_correos_pickups (idempotency_key, crm_tenant_id, requested_by, guia_numbers, pickup_address, environment)
      VALUES (${input.key}, ${input.tenantId}, ${input.userId}, ${input.guias}::text[], ${input.address.slice(0, 400)}, ${input.environment})
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
    return n > 0 ? 'claimed' : 'duplicate';
  } catch (e) {
    if (isMissingTable(e)) return 'unavailable';
    throw e;
  }
}

export async function finishPickup(key: string, status: 'sent' | 'failed' | 'unknown', error?: string | null) {
  return safe(false, async () => {
    await prisma.$executeRaw`
      UPDATE lm_correos_pickups SET status = ${status}, error = ${error?.slice(0, 500) ?? null}, updated_at = now()
      WHERE idempotency_key = ${key}
    `;
    return true;
  });
}

export async function recentPickups(tenantId: string, limit = 10) {
  return safe<Array<{ id: bigint; guia_numbers: string[]; status: string; error: string | null; created_at: Date }>>([], () =>
    prisma.$queryRaw`
      SELECT id, guia_numbers, status, error, created_at FROM lm_correos_pickups
      WHERE crm_tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit}
    `,
  );
}
