export type WorkforceTimeEntryStatus = 'open' | 'completed' | 'voided';

export function getWorkforceTimeEntryStatus(
  clockOutAt: unknown,
  voidedAt: unknown,
): WorkforceTimeEntryStatus {
  if (voidedAt) return 'voided';
  return clockOutAt ? 'completed' : 'open';
}

export function isOpenWorkforceTimeEntry(clockOutAt: unknown, voidedAt: unknown) {
  return getWorkforceTimeEntryStatus(clockOutAt, voidedAt) === 'open';
}

export type WorkforcePunchDecision =
  | 'create_entry'
  | 'already_open'
  | 'close_entry'
  | 'state_conflict'
  | 'check_closed_replay'
  | 'not_open';

export function decideWorkforcePunch(
  action: 'clock_in' | 'clock_out',
  openEntryId: string | null,
  expectedEntryId: string | null,
): WorkforcePunchDecision {
  if (action === 'clock_in') return openEntryId ? 'already_open' : 'create_entry';
  if (!openEntryId) return expectedEntryId ? 'check_closed_replay' : 'not_open';
  if (expectedEntryId && expectedEntryId !== openEntryId) return 'state_conflict';
  return 'close_entry';
}
