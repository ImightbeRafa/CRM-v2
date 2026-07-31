/**
 * Browser-safe Costa Rica datetime helpers for workforce / time-clock UI.
 * Do not import Node-only modules here — this is used from client components.
 */

export const WORKFORCE_DISPLAY_TIME_ZONE = 'America/Costa_Rica';

/** Costa Rica observes UTC−6 year-round (no DST). */
const CR_UTC_OFFSET_MINUTES = -6 * 60;

const DATE_TIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_EXPLICIT_OFFSET_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

function parseInstant(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function crParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKFORCE_DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  let hour = get('hour');
  if (hour === '24') hour = '00';

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Format an instant for display in Costa Rica wall time. */
export function formatWorkforceDateTime(value: string | Date | null | undefined) {
  const date = parseInstant(value);
  if (!date) return '-';
  return date.toLocaleString('es-CR', {
    timeZone: WORKFORCE_DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format an instant as `YYYY-MM-DDTHH:mm` in Costa Rica wall time
 * for `<input type="datetime-local">`.
 */
export function toCostaRicaDateTimeLocal(value: string | Date | null | undefined) {
  const date = parseInstant(value);
  if (!date) return '';
  const parts = crParts(date);
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Convert a Costa Rica `datetime-local` wall-time string to a UTC Date.
 * Returns null for empty/invalid input.
 */
export function costaRicaDateTimeLocalToUtc(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = DATE_TIME_LOCAL_RE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || '0');

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return null;
  }

  const wallAsUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(wallAsUtcMillis - CR_UTC_OFFSET_MINUTES * 60 * 1000);
}

/** Convert Costa Rica wall time to an explicit ISO-8601 instant (with Z). */
export function costaRicaDateTimeLocalToIso(value: unknown): string | null {
  const date = costaRicaDateTimeLocalToUtc(value);
  return date ? date.toISOString() : null;
}

/**
 * True when the string already carries an explicit timezone (Z or ±offset).
 * Bare `YYYY-MM-DDTHH:mm` values are ambiguous and must be rejected at the API.
 */
export function hasExplicitTimezone(value: string) {
  return HAS_EXPLICIT_OFFSET_RE.test(value.trim());
}

/**
 * Parse a clock timestamp for API boundaries.
 * Requires an explicit timezone; rejects bare datetime-local strings.
 * Returns null for empty/null (caller decides if that is allowed).
 */
export function parseExplicitClockTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!hasExplicitTimezone(trimmed)) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
