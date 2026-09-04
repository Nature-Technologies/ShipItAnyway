import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsForScopes } from '../src/gating.js';

test('viewer scopes enable reporting only', () => {
  const g = groupsForScopes(['runs:read', 'checks:read']);
  assert.deepEqual(g, { authoring: false, reporting: true, execution: false });
});
test('editor scopes enable all three', () => {
  const g = groupsForScopes(['runs:read', 'checks:read', 'checks:edit', 'runs:trigger']);
  assert.deepEqual(g, { authoring: true, reporting: true, execution: true });
});
test('no relevant scopes enables nothing', () => {
  assert.deepEqual(groupsForScopes(['members:read']), { authoring: false, reporting: false, execution: false });
});
