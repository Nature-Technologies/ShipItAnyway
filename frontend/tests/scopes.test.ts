import assert from 'node:assert/strict';
import test from 'node:test';
import { can, isReadOnly, deriveProjectGates, type Scope } from '../src/utils/scopes';

// Underscored to match the backend Prisma Scope enum emitted in currentUserScopes.
const EDITOR: Scope[] = ['checks_edit', 'runs_trigger', 'schedules_edit', 'environments_edit', 'alerts_edit'];

test('can() is scope membership', () => {
  assert.equal(can(['checks_edit'], 'checks_edit'), true);
  assert.equal(can(['checks_edit'], 'schedules_edit'), false);
  assert.equal(can([], 'runs_trigger'), false);
});

test('isReadOnly is true only when no *_edit scope is present', () => {
  assert.equal(isReadOnly([]), true);
  assert.equal(isReadOnly(['teams_manage', 'members_read']), true);
  assert.equal(isReadOnly(['runs_trigger']), true);
  assert.equal(isReadOnly(['alerts_edit']), false);
});

test('deriveProjectGates maps a read-only scope set to all-false gates', () => {
  const g = deriveProjectGates([]);
  assert.deepEqual(g, {
    canEditChecks: false, canTriggerRuns: false, canEditSchedules: false,
    canEditEnvironments: false, canEditAlerts: false, canManageTeams: false,
    canReadMembers: false, readOnly: true
  });
});

test('deriveProjectGates unlocks per-feature gates for an editor-equivalent set', () => {
  const g = deriveProjectGates(EDITOR);
  assert.equal(g.canEditChecks, true);
  assert.equal(g.canTriggerRuns, true);
  assert.equal(g.canEditSchedules, true);
  assert.equal(g.canEditEnvironments, true);
  assert.equal(g.canEditAlerts, true);
  assert.equal(g.canManageTeams, false);
  assert.equal(g.readOnly, false);
});

test('deriveProjectGates surfaces teams-manage and members-read independently', () => {
  const g = deriveProjectGates(['teams_manage', 'members_read']);
  assert.equal(g.canManageTeams, true);
  assert.equal(g.canReadMembers, true);
  assert.equal(g.readOnly, true); // no *_edit
});
