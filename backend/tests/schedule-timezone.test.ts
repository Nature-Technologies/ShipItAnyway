import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidTimezone } from '../src/utils/timezone';
import { getNextRunAt } from '../src/routes/schedules';

test('isValidTimezone accepts IANA zones and rejects junk', () => {
  assert.equal(isValidTimezone('America/New_York'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Mars/Phobos'), false);
  assert.equal(isValidTimezone(''), false);
});

test('getNextRunAt honours the schedule timezone (DST-correct)', () => {
  const ref = new Date('2026-07-01T00:00:00.000Z'); // summer → EDT (UTC-4)
  const nextNy = getNextRunAt('0 9 * * *', ref, 'America/New_York');
  const nextUtc = getNextRunAt('0 9 * * *', ref, null);
  assert.ok(nextNy && nextUtc);
  assert.equal(nextNy!.getUTCHours(), 13);
  assert.equal(nextUtc!.getUTCHours(), 9);
});
