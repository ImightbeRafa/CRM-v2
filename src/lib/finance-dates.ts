import {
  getCurrentWeekStartKey,
  getWeekEndKey,
} from '@/lib/logistics-workforce';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Cap range to protect the live DB pool; page by month/quarter from the consumer. */
const MAX_RANGE_DAYS = 92;

export type FinanceDateRange = {
  dateFrom: string;
  dateTo: string;
};

function isValidDateKey(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Parse finance date range. Defaults to the current Costa Rica week (Mon–Sun)
 * when both params are omitted — matches Betsy logistics week behavior.
 */
export function parseFinanceDateRange(
  dateFromRaw: string | null,
  dateToRaw: string | null,
): { ok: true; range: FinanceDateRange } | { ok: false; error: string } {
  const dateFrom = dateFromRaw?.trim() || null;
  const dateTo = dateToRaw?.trim() || null;

  if (!dateFrom && !dateTo) {
    const weekStart = getCurrentWeekStartKey();
    return {
      ok: true,
      range: { dateFrom: weekStart, dateTo: getWeekEndKey(weekStart) },
    };
  }

  if (!dateFrom || !dateTo) {
    return { ok: false, error: 'Provide both dateFrom and dateTo (YYYY-MM-DD), or omit both for the current CR week' };
  }

  if (!isValidDateKey(dateFrom) || !isValidDateKey(dateTo)) {
    return { ok: false, error: 'dateFrom and dateTo must be valid YYYY-MM-DD dates' };
  }

  if (dateFrom > dateTo) {
    return { ok: false, error: 'dateFrom must be on or before dateTo' };
  }

  const span = daysBetween(dateFrom, dateTo);
  if (span > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Date range cannot exceed ${MAX_RANGE_DAYS} days — page by month/quarter from the consumer`,
    };
  }

  return { ok: true, range: { dateFrom, dateTo } };
}
