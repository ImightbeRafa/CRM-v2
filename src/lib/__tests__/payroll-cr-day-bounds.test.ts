import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  SQL_CR_CLOCK_IN_RANGE_P12,
  prismaCostaRicaClockInRange,
  sqlCostaRicaHalfOpenRange,
} from '../costa-rica-clock-range';
import { prisma } from '../db';
import { costaRicaDateTimeLocalToIso } from '../workforce-datetime';

assert.match(
  SQL_CR_CLOCK_IN_RANGE_P12,
  /\$1::timestamp AT TIME ZONE 'America\/Costa_Rica'/,
);
assert.match(
  SQL_CR_CLOCK_IN_RANGE_P12,
  /\$2::timestamp \+ INTERVAL '1 day'/,
);
assert.doesNotMatch(SQL_CR_CLOCK_IN_RANGE_P12, /::date AT TIME ZONE/);
assert.match(
  sqlCostaRicaHalfOpenRange('created_at', '$2', '$2'),
  /\$2::timestamp AT TIME ZONE/,
);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const banned = /::date AT TIME ZONE/;
for (const file of collectSourceFiles(join(process.cwd(), 'src'))) {
  const text = readFileSync(file, 'utf8');
  assert.equal(
    banned.test(text),
    false,
    `${file} still uses date AT TIME ZONE (Sunday week-overlap trap)`,
  );
}

// Monday 17 Aug 2026 00:00 CR = 06:00 UTC
assert.equal(costaRicaDateTimeLocalToIso('2026-08-17T00:00'), '2026-08-17T06:00:00.000Z');

async function weekIds(dateFrom: string, dateTo: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT te.id
    FROM lm_time_entries te
    WHERE te.voided_at IS NULL
      AND te.clock_out_at IS NOT NULL
      AND ${prismaCostaRicaClockInRange(dateFrom, dateTo)}
  `;
  return rows.map((row) => row.id);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('payroll CR day bounds tests passed (fragment only; no DATABASE_URL)');
    return;
  }

  const [bound] = await prisma.$queryRaw<Array<{
    typeof_ts: string;
    epoch_ts: number;
    epoch_intended: number;
    typeof_date_atz: string;
  }>>`
    SELECT
      pg_typeof(('2026-08-17'::timestamp AT TIME ZONE 'America/Costa_Rica'))::text AS typeof_ts,
      EXTRACT(EPOCH FROM ('2026-08-17'::timestamp AT TIME ZONE 'America/Costa_Rica'))::float8 AS epoch_ts,
      EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-08-17 00:00:00-06')::float8 AS epoch_intended,
      pg_typeof(('2026-08-17'::date AT TIME ZONE 'America/Costa_Rica'))::text AS typeof_date_atz
  `;

  assert.equal(bound.typeof_ts, 'timestamp with time zone');
  assert.equal(bound.epoch_ts, bound.epoch_intended);
  assert.equal(bound.typeof_date_atz, 'timestamp without time zone');

  const weekA = await weekIds('2026-08-10', '2026-08-16');
  const weekB = await weekIds('2026-08-17', '2026-08-23');
  const overlap = weekA.filter((id) => weekB.includes(id));
  assert.deepEqual(overlap, [], `consecutive payroll weeks must not share clock-ins, got ${overlap.join(',')}`);

  await prisma.$disconnect();
  console.log('payroll CR day bounds tests passed');
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
