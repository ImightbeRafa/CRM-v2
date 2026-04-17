const STATS_TIME_ZONE = 'America/Costa_Rica';
const STATS_UTC_OFFSET_MINUTES = -6 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type StatsGroupBy = 'day' | 'week' | 'month';

export interface StatsDateRange {
  start: Date | null;
  end: Date | null;
  startKey: string | null;
  endKey: string | null;
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_KEY_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

function toUtcDateForStatsZone(dateKey: string, endOfDay = false): Date | null {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;

  const localUtcMillis = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );

  return new Date(localUtcMillis - STATS_UTC_OFFSET_MINUTES * 60 * 1000);
}

export function formatStatsDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STATS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function normalizeStatsDateInput(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatStatsDateKey(value) || null;
  }

  const raw = String(value).trim();
  if (!raw) return null;
  if (DATE_KEY_RE.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatStatsDateKey(parsed) || null;
}

export function buildStatsDateRange(startDate?: string | null, endDate?: string | null): StatsDateRange {
  const startKey = normalizeStatsDateInput(startDate);
  const endKey = normalizeStatsDateInput(endDate);

  return {
    start: startKey ? toUtcDateForStatsZone(startKey, false) : null,
    end: endKey ? toUtcDateForStatsZone(endKey, true) : null,
    startKey,
    endKey,
  };
}

export function buildStatsOrderDateWhere(startDate?: string | null, endDate?: string | null): Record<string, any> {
  const range = buildStatsDateRange(startDate, endDate);
  if (!range.start && !range.end && !range.startKey && !range.endKey) {
    return {};
  }

  const timestampFilter: Record<string, Date> = {};
  if (range.start) timestampFilter.gte = range.start;
  if (range.end) timestampFilter.lte = range.end;

  const isoSaleDateFilter: Record<string, string> = {};
  if (range.start) isoSaleDateFilter.gte = range.start.toISOString();
  if (range.end) isoSaleDateFilter.lte = range.end.toISOString();

  const dateOnlySaleDateFilter: Record<string, string> = {};
  if (range.startKey) dateOnlySaleDateFilter.gte = range.startKey;
  if (range.endKey) dateOnlySaleDateFilter.lte = `${range.endKey}\uffff`;

  return {
    OR: [
      {
        AND: [
          { saleDate: { not: null } },
          { saleDate: { contains: 'T' } },
          { saleDate: isoSaleDateFilter },
        ],
      },
      {
        AND: [
          { saleDate: { not: null } },
          { saleDate: { not: '' } },
          { saleDate: { ...dateOnlySaleDateFilter, not: { contains: 'T' } } },
        ],
      },
      { saleDate: null, timestamp: timestampFilter },
      { saleDate: '', timestamp: timestampFilter },
    ],
  };
}

function dateKeyToUtcMillis(dateKey: string): number {
  const parts = parseDateKey(dateKey);
  if (!parts) return NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function addDaysToStatsDateKey(dateKey: string, days: number): string {
  const millis = dateKeyToUtcMillis(dateKey);
  if (Number.isNaN(millis)) return dateKey;

  const shifted = new Date(millis + days * DAY_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPreviousStatsPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } | null {
  const startKey = normalizeStatsDateInput(startDate);
  const endKey = normalizeStatsDateInput(endDate);
  if (!startKey || !endKey) return null;

  const startMillis = dateKeyToUtcMillis(startKey);
  const endMillis = dateKeyToUtcMillis(endKey);
  if (Number.isNaN(startMillis) || Number.isNaN(endMillis) || endMillis < startMillis) {
    return null;
  }

  const days = Math.floor((endMillis - startMillis) / DAY_MS) + 1;
  return {
    startDate: addDaysToStatsDateKey(startKey, -days),
    endDate: addDaysToStatsDateKey(startKey, -1),
  };
}

export function getOrderStatsDateKey(order: { saleDate?: string | null; timestamp: Date | string }): string {
  const saleDate = order.saleDate?.trim();
  if (saleDate) {
    const normalized = normalizeStatsDateInput(saleDate);
    if (normalized) return normalized;
  }

  const timestamp = order.timestamp instanceof Date ? order.timestamp : new Date(order.timestamp);
  return Number.isNaN(timestamp.getTime()) ? '' : formatStatsDateKey(timestamp);
}

export function toStatsPeriodKey(dateKey: string, groupBy: StatsGroupBy): string {
  if (groupBy === 'month') return dateKey.slice(0, 7);
  if (groupBy !== 'week') return dateKey;

  const millis = dateKeyToUtcMillis(dateKey);
  if (Number.isNaN(millis)) return dateKey;

  const date = new Date(millis);
  return addDaysToStatsDateKey(dateKey, -date.getUTCDay());
}
