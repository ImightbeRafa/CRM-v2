import assert from 'node:assert/strict';
import {
  decideWorkforcePunch,
  getWorkforceTimeEntryStatus,
  isOpenWorkforceTimeEntry,
} from '../workforce-time-entry-state';

assert.equal(getWorkforceTimeEntryStatus(null, null), 'open');
assert.equal(getWorkforceTimeEntryStatus('2026-08-04T02:00:00.000Z', null), 'completed');
assert.equal(getWorkforceTimeEntryStatus(null, '2026-08-04T02:08:00.000Z'), 'voided');
assert.equal(
  getWorkforceTimeEntryStatus(
    '2026-08-04T02:00:00.000Z',
    '2026-08-04T02:08:00.000Z',
  ),
  'voided',
);

assert.equal(isOpenWorkforceTimeEntry(null, null), true);
assert.equal(isOpenWorkforceTimeEntry(null, '2026-08-04T02:08:00.000Z'), false);

assert.equal(decideWorkforcePunch('clock_in', null, null), 'create_entry');
assert.equal(decideWorkforcePunch('clock_in', 'entry-a', null), 'already_open');
assert.equal(decideWorkforcePunch('clock_out', 'entry-a', 'entry-a'), 'close_entry');
assert.equal(decideWorkforcePunch('clock_out', 'entry-a', 'entry-b'), 'state_conflict');
assert.equal(decideWorkforcePunch('clock_out', null, 'entry-a'), 'check_closed_replay');
assert.equal(decideWorkforcePunch('clock_out', null, null), 'not_open');

console.log('workforce time-entry state tests passed');
