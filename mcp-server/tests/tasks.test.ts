import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRunsToTaskStatus } from '../src/tasks.js';

test('empty → working', () => {
  assert.equal(mapRunsToTaskStatus([]), 'working');
});

test('all passed → completed', () => {
  assert.equal(mapRunsToTaskStatus([{ status: 'PASSED' }, { status: 'PASSED' }]), 'completed');
});

test('any pending/running → working', () => {
  assert.equal(mapRunsToTaskStatus([{ status: 'PASSED' }, { status: 'RUNNING' }]), 'working');
  assert.equal(mapRunsToTaskStatus([{ status: 'PENDING' }]), 'working');
});

test('terminal with a failure → completed (failure in result, not task-level failed)', () => {
  assert.equal(mapRunsToTaskStatus([{ status: 'PASSED' }, { status: 'FAILED' }]), 'completed');
});

test('all terminal statuses → completed', () => {
  assert.equal(mapRunsToTaskStatus([{ status: 'FAILED' }, { status: 'ERROR' }, { status: 'CANCELLED' }]), 'completed');
});
