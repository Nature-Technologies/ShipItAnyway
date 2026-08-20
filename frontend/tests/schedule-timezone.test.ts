import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveScheduleTimezone } from '../src/utils/scheduleTimezone';

test('resolveScheduleTimezone falls back to UTC when unset', () => {
  assert.equal(resolveScheduleTimezone({ timezone: null }), 'UTC');
  assert.equal(resolveScheduleTimezone({}), 'UTC');
  assert.equal(resolveScheduleTimezone({ timezone: 'Asia/Kolkata' }), 'Asia/Kolkata');
});
