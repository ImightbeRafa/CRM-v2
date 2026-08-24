import { Prisma } from '@prisma/client';

/**
 * Half-open Costa Rica calendar range for `timestamptz` clock-in filters:
 * `[dateFrom 00:00 CR, dateTo 00:00 CR + 1 day)`.
 *
 * Use `::timestamp AT TIME ZONE`, never `::date AT TIME ZONE`.
 *
 * On PostgreSQL 17 with `TimeZone=UTC`, `date AT TIME ZONE tz` returns
 * `timestamp without time zone` (UTC midnight converted to Costa Rica wall
 * time — 18:00 UTC the previous calendar day). Comparing that to `timestamptz`
 * starts the next week at Sunday noon CR. The exclusive end bound already used
 * `date + interval` (a timestamp) `AT TIME ZONE`, which correctly yields
 * Monday 00:00 CR. Sunday afternoon therefore matched both consecutive weeks
 * and was paid twice.
 *
 * `timestamp AT TIME ZONE tz` returns `timestamptz` at Costa Rica midnight.
 */
export function prismaCostaRicaClockInRange(dateFrom: string, dateTo: string) {
  return Prisma.sql`
    te.clock_in_at >= (${dateFrom}::timestamp AT TIME ZONE 'America/Costa_Rica')
    AND te.clock_in_at < ((${dateTo}::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Costa_Rica')
  `;
}

/** Same predicate for `$queryRawUnsafe` with `$1` / `$2` date keys. */
export const SQL_CR_CLOCK_IN_RANGE_P12 = `
  te.clock_in_at >= ($1::timestamp AT TIME ZONE 'America/Costa_Rica')
  AND te.clock_in_at < (($2::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Costa_Rica')
`;
