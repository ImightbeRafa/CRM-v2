import type { V3Rastreo } from './types';

/**
 * Pure helpers that turn Betsy data into what Correos v3 accepts, and Correos
 * answers into Betsy terms. No I/O here, so every rule is unit-tested.
 */

/** Costa Rica phone → exactly 8 digits ("+506 8888-8888" → "88888888"), else null. */
export function toPhone8(raw: string | null | undefined): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('506')) digits = digits.slice(3);
  if (digits.length === 12 && digits.startsWith('00506')) digits = digits.slice(5);
  return /^[2-9]\d{7}$/.test(digits) ? digits : null;
}

/** Postal code → 5 digits, else null. */
export function toZip5(raw: string | null | undefined): string | null {
  const z = String(raw ?? '').trim();
  return /^\d{5}$/.test(z) ? z : null;
}

/** Weight in grams as Correos wants it (int, 1 g … 30 kg). */
export function toGrams(raw: number | string | null | undefined, fallback = 500): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 30_000);
}

export function clip(value: string | null | undefined, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export type CorreosShipmentStatus =
  | 'created'
  | 'in_transit'
  | 'at_branch'
  | 'out_for_delivery'
  | 'delivered'
  | 'returned'
  | 'unknown';

export const SHIPMENT_STATUS_LABEL: Record<CorreosShipmentStatus, string> = {
  created: 'Guía creada',
  in_transit: 'En tránsito',
  at_branch: 'En sucursal',
  out_for_delivery: 'En reparto',
  delivered: 'Entregado',
  returned: 'Devuelto',
  unknown: 'Sin novedades',
};

/** Legacy lm_order_statuses names (Correos group) for each status. */
export const SHIPMENT_STATUS_LM: Partial<Record<CorreosShipmentStatus, string>> = {
  in_transit: 'En Tránsito',
  out_for_delivery: 'En Tránsito',
  at_branch: 'En Sucursal',
  delivered: 'Entregado',
  returned: 'Devuelto',
};

function fold(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/**
 * Correos status text → Betsy status. Correos publishes no code list, so this
 * reads the words ("EN TRANSITO", "ENTREGADO", "DEVUELTO AL REMITENTE"…).
 * Order matters: "devuelto" beats "entregado" ("entregado al remitente").
 */
export function classifyStatus(text: string | null | undefined, deliveredAt?: string | null): CorreosShipmentStatus {
  const t = fold(text);
  if (/DEVOLU|DEVUEL|REMITENTE|RECHAZ/.test(t)) return 'returned';
  if (/ENTREGAD|ENTREGO/.test(t) || deliveredAt) return 'delivered';
  if (/REPARTO|DISTRIBUCION|CARTERO|EN RUTA/.test(t)) return 'out_for_delivery';
  if (/SUCURSAL|RETIRAR|DISPONIBLE|VENTANILLA|APARTADO/.test(t)) return 'at_branch';
  if (/TRANSITO|RECIBID|ADMITID|CLASIFIC|DESPACH|TRASLAD|CENTRO/.test(t)) return 'in_transit';
  if (/REGISTRAD|PRE.?ADMIS|GENERAD/.test(t)) return 'created';
  return t ? 'in_transit' : 'unknown';
}

export const CLOSED_STATUSES: ReadonlySet<CorreosShipmentStatus> = new Set(['delivered', 'returned']);

export interface NormalizedTracking {
  guiaNumber: string;
  status: CorreosShipmentStatus;
  statusText: string | null;
  statusCode: string | null;
  service: string | null;
  origin: string | null;
  recipient: string | null;
  receivedAt: string | null;
  deliveredAt: string | null;
  deliveredTo: string | null;
  events: Array<{
    at: string | null;
    code: string | null;
    description: string;
    place: string | null;
    receivedBy: string | null;
    lat: number | null;
    lng: number | null;
  }>;
}

export function normalizeTracking(guiaNumber: string, r: V3Rastreo | null): NormalizedTracking {
  const e = r?.envio ?? null;
  const events = (r?.eventos ?? [])
    .map((ev) => ({
      at: ev.fecha ?? null,
      code: ev.codigo ?? null,
      description: clip(ev.descripcion, 300) || 'Movimiento',
      place: ev.ubicacion ? clip(ev.ubicacion, 120) : null,
      receivedBy: ev.recibidoPor ? clip(ev.recibidoPor, 120) : null,
      lat: typeof ev.latitud === 'number' && Number.isFinite(ev.latitud) && ev.latitud !== 0 ? ev.latitud : null,
      lng: typeof ev.longitud === 'number' && Number.isFinite(ev.longitud) && ev.longitud !== 0 ? ev.longitud : null,
    }))
    .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  const last = events.at(-1);
  const statusText = e?.estado ?? last?.description ?? null;
  return {
    // Always the number we asked for (ownership was checked on it), never what Correos echoes back.
    guiaNumber,
    status: classifyStatus(e?.estado || last?.description, e?.fechaEntrega),
    statusText,
    statusCode: e?.codigoEstado ?? null,
    service: e?.servicio ?? null,
    origin: e?.unidadOrigen ?? null,
    recipient: e?.nombreDestinatario ?? null,
    receivedAt: e?.fechaRecepcion ?? null,
    deliveredAt: e?.fechaEntrega ?? null,
    deliveredTo: e?.personaEntrega || last?.receivedBy || null,
    events,
  };
}

/** How long to wait before the next tracking check, by status. */
export function nextCheckDelayMs(status: CorreosShipmentStatus, ageMs: number): number | null {
  if (CLOSED_STATUSES.has(status)) return null;
  const H = 3_600_000;
  if (ageMs > 30 * 24 * H) return null; // give up after 30 days
  if (status === 'out_for_delivery' || status === 'at_branch') return 2 * H;
  if (status === 'created' || status === 'unknown') return 6 * H;
  return 4 * H;
}
