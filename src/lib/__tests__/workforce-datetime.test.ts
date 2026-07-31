import assert from 'node:assert/strict';
import {
  costaRicaDateTimeLocalToIso,
  costaRicaDateTimeLocalToUtc,
  formatWorkforceDateTime,
  hasExplicitTimezone,
  parseExplicitClockTimestamp,
  toCostaRicaDateTimeLocal,
} from '../workforce-datetime';
import { parseClockTimestamp } from '../logistics-workforce';

// 09:00 Costa Rica wall time = 15:00 UTC
assert.equal(costaRicaDateTimeLocalToIso('2026-07-31T09:00'), '2026-07-31T15:00:00.000Z');
assert.equal(costaRicaDateTimeLocalToIso('2026-07-31T09:00:00'), '2026-07-31T15:00:00.000Z');

const utc = costaRicaDateTimeLocalToUtc('2026-07-31T09:00');
assert.ok(utc);
assert.equal(utc.toISOString(), '2026-07-31T15:00:00.000Z');

// Round-trip: UTC instant → CR datetime-local → UTC instant
assert.equal(toCostaRicaDateTimeLocal('2026-07-31T15:00:00.000Z'), '2026-07-31T09:00');
assert.equal(
  costaRicaDateTimeLocalToIso(toCostaRicaDateTimeLocal('2026-07-31T15:00:00.000Z')),
  '2026-07-31T15:00:00.000Z',
);

// Display always uses Costa Rica wall time regardless of process TZ interpretation of locale
const display = formatWorkforceDateTime('2026-07-31T15:00:00.000Z');
assert.match(display, /31/);
assert.match(display, /09:00|9:00/i);

assert.equal(costaRicaDateTimeLocalToIso(''), null);
assert.equal(costaRicaDateTimeLocalToIso('not-a-date'), null);
assert.equal(costaRicaDateTimeLocalToIso('2026-13-01T09:00'), null);
assert.equal(toCostaRicaDateTimeLocal(null), '');
assert.equal(toCostaRicaDateTimeLocal(''), '');
assert.equal(formatWorkforceDateTime(null), '-');

// API boundary: bare datetime-local is rejected; explicit offsets are accepted
assert.equal(hasExplicitTimezone('2026-07-31T09:00'), false);
assert.equal(hasExplicitTimezone('2026-07-31T15:00:00.000Z'), true);
assert.equal(hasExplicitTimezone('2026-07-31T09:00:00-06:00'), true);

assert.equal(parseExplicitClockTimestamp('2026-07-31T09:00'), null);
assert.equal(parseClockTimestamp('2026-07-31T09:00'), null);
assert.equal(parseClockTimestamp(null), null);
assert.equal(parseClockTimestamp(''), null);

const parsedZ = parseClockTimestamp('2026-07-31T15:00:00.000Z');
assert.ok(parsedZ);
assert.equal(parsedZ.toISOString(), '2026-07-31T15:00:00.000Z');

const parsedOffset = parseClockTimestamp('2026-07-31T09:00:00-06:00');
assert.ok(parsedOffset);
assert.equal(parsedOffset.toISOString(), '2026-07-31T15:00:00.000Z');

// Saving an "unchanged" CR wall time must preserve the original UTC instant
const storedIso = '2026-07-31T15:00:00.000Z';
const editedLocal = toCostaRicaDateTimeLocal(storedIso);
assert.equal(editedLocal, '2026-07-31T09:00');
assert.equal(costaRicaDateTimeLocalToIso(editedLocal), storedIso);

console.log('workforce-datetime tests passed');
