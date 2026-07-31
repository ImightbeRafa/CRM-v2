import { createHmac, randomBytes } from 'crypto';
import {
  WORKFORCE_DISPLAY_TIME_ZONE,
  parseExplicitClockTimestamp,
} from '@/lib/workforce-datetime';

export const WORKFORCE_TIME_ZONE = WORKFORCE_DISPLAY_TIME_ZONE;
export const WORKFORCE_SLOT_MINUTES = 30;
export const WORKFORCE_COVERAGE_START = '08:00';
export const WORKFORCE_COVERAGE_END = '20:00';

export {
  formatWorkforceDateTime,
  toCostaRicaDateTimeLocal,
  costaRicaDateTimeLocalToIso,
  costaRicaDateTimeLocalToUtc,
  parseExplicitClockTimestamp,
} from '@/lib/workforce-datetime';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type WorkforceEmployee = {
  id: string;
  display_name: string;
  active: boolean;
  hourly_rate_crc: number | string;
  code_last_generated_at: string | Date | null;
  legacy_staff_name?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

export function normalizeEmployeeCode(code: unknown) {
  return String(code || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function getEmployeeCodeSecret() {
  const secret = process.env.EMPLOYEE_CODE_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'dev-employee-code-secret';
  throw new Error('EMPLOYEE_CODE_SECRET is required');
}

export function hashEmployeeCode(code: string) {
  const normalized = normalizeEmployeeCode(code);
  if (normalized.length < 4) {
    throw new Error('Invalid employee code');
  }
  return createHmac('sha256', getEmployeeCodeSecret()).update(normalized).digest('hex');
}

export function generateEmployeeCode() {
  let code = '';
  const bytes = randomBytes(16);
  for (let i = 0; code.length < 8; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return { code, codeHash: hashEmployeeCode(code) };
}

export function toDateKeyCR(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: WORKFORCE_TIME_ZONE });
}

export function toDateKeyLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysKey(key: string, days: number) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toDateKeyLocal(date);
}

export function getWeekStartKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return toDateKeyLocal(date);
}

export function getWeekEndKey(weekStart: string) {
  return addDaysKey(weekStart, 6);
}

export function getCurrentWeekStartKey() {
  return getWeekStartKey(toDateKeyCR());
}

export function toWorkDateKey(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.includes('T') ? value.slice(0, 10) : value;
  }
  return '';
}

export function parsePositiveMoney(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100) / 100;
}

export function parseMinutes(value: unknown, fallback = 0, max = 1440) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, Math.round(parsed)));
}

/**
 * Parse admin-supplied clock timestamps.
 * Requires an explicit timezone (Z or ±offset) so UTC servers never
 * misread Costa Rica wall-time `datetime-local` strings as UTC.
 * Empty / null → null (caller decides whether clearing is allowed).
 */
export function parseClockTimestamp(value: unknown) {
  return parseExplicitClockTimestamp(value);
}

export function calculatePaidMinutes(clockIn: Date, clockOut: Date) {
  const diff = clockOut.getTime() - clockIn.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / 60000);
}

export function normalizeTimeValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : null;
}

export function getRequestActorId(headers: Headers) {
  return headers.get('x-user-id') || null;
}

export function employeeRow(row: WorkforceEmployee) {
  return {
    id: row.id,
    displayName: row.display_name,
    active: Boolean(row.active),
    hourlyRateCrc: Number(row.hourly_rate_crc) || 0,
    codeLastGeneratedAt: row.code_last_generated_at,
    legacyStaffName: row.legacy_staff_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
