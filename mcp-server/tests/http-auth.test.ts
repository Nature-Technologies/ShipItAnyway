import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBearer, gatedToolNames } from '../src/http.js';

test('extractBearer parses a Bearer token', () => {
  assert.equal(extractBearer('Bearer sia_abc'), 'sia_abc');
  assert.equal(extractBearer('bearer sia_abc'), 'sia_abc');
});
test('extractBearer rejects missing/malformed', () => {
  assert.equal(extractBearer(undefined), null);
  assert.equal(extractBearer('Token x'), null);
  assert.equal(extractBearer('Bearer '), null);
});
test('gatedToolNames returns only reporting tools for a viewer', () => {
  const names = gatedToolNames(['runs:read', 'checks:read'], ['start_recording','save_test','list_projects','list_runs','get_run','get_run_batch','trigger_run']);
  assert.ok(names.includes('list_runs'));
  assert.ok(!names.includes('trigger_run'));
  assert.ok(!names.includes('start_recording'));
});
