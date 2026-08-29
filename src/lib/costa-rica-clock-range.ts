import { Prisma } from '@prisma/client';

const CR_TZ = 'America/Costa_Rica';

/**
 * Half-open Costa Rica calendar range for `timestamptz` columns:
 * `[dateFrom 00:00 CR, dateTo 00:00 CR + 1 day)`.
 *
 * Always cast YYYY-MM-DD as `timestamp` before `AT TIME ZONE`.
 * Casting as `date` on PostgreSQL 17 (session TimeZone=UTC) returns
 * timestamp-without-time-zone: UTC midnight converted to Costa Rica wall
 * time (18:00 UTC the previous calendar day). Comparing that to timestamptz
 * starts the next week at Sunday noon CR, while the exclusive end bound
 * (`date + interval` AT TIME ZONE) stays at Monday 00:00 CR. Sunday
 * afternoon therefore matched both consecutive weeks.
 *
 * `timestamp AT TIME ZONE tz` returns timestamptz at Costa Rica midnight.
 */
export function sqlCostaRicaDayStart(dateSql: string) {
  return `(${dateSql}::timestamp AT TIME ZONE '${CR_TZ}')`;
}

export function sqlCostaRicaDayAfter(dateSql: string) {
  return `((${dateSql}::timestamp + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')`;
}

export function sqlCostaRicaHalfOpenRange(
  columnSql: string,
  fromDateSql: string,
  toDateSql: string,
) {
  return `${columnSql} >= ${sqlCostaRicaDayStart(fromDateSql)}
    AND ${columnSql} < ${sqlCostaRicaDayAfter(toDateSql)}`;
}

export function prismaCostaRicaClockInRange(dateFrom: string, dateTo: string) {
  return Prisma.sql`
    te.clock_in_at >= (${dateFrom}::timestamp AT TIME ZONE 'America/Costa_Rica')
    AND te.clock_in_at < ((${dateTo}::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Costa_Rica')
  `;
}

/** Same predicate for `$queryRawUnsafe` with `$1` / `$2` date keys. */
export const SQL_CR_CLOCK_IN_RANGE_P12 = sqlCostaRicaHalfOpenRange(
  'te.clock_in_at',
  '$1',
  '$2',
);
