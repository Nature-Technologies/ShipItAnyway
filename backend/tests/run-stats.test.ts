import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, flakyChecks } from '../src/services/run-stats';

test('summarize computes counts, pass rate, avg duration', () => {
  const s = summarize([
    { status: 'PASSED', durationMs: 100 },
    { status: 'PASSED', durationMs: 300 },
    { status: 'FAILED', durationMs: null }
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.passed, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.passRate, 67);
  assert.equal(s.avgDurationMs, 200); // null durations excluded from the average
});

test('summarize handles the empty set', () => {
  assert.deepEqual(summarize([]), { total: 0, passed: 0, failed: 0, passRate: 0, avgDurationMs: null });
});

test('flakyChecks returns only tests with both a pass and a fail', () => {
  const rows = flakyChecks([
    { testId: 't1', testName: 'A', status: 'PASSED' },
    { testId: 't1', testName: 'A', status: 'FAILED' },
    { testId: 't2', testName: 'B', status: 'PASSED' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].testId, 't1');
  assert.equal(rows[0].passRate, 50);
});
