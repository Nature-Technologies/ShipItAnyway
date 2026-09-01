import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@prisma/client';
import { toApiScope, fromApiScope, ALL_API_SCOPES } from '../src/constants/rbac';

test('toApiScope maps DB enum to resource:action form', () => {
  assert.equal(toApiScope(Scope.runs_read), 'runs:read');
  assert.equal(toApiScope(Scope.teams_manage), 'teams:manage');
  assert.equal(toApiScope(Scope.environments_reveal_secrets), 'environments:reveal-secrets');
});

test('fromApiScope is the inverse and rejects junk', () => {
  assert.equal(fromApiScope('runs:read'), Scope.runs_read);
  assert.equal(fromApiScope('environments:reveal-secrets'), Scope.environments_reveal_secrets);
  assert.equal(fromApiScope('mars:phobos'), null);
  assert.equal(fromApiScope(''), null);
});

test('every Scope round-trips through the API form', () => {
  for (const s of Object.values(Scope)) {
    assert.equal(fromApiScope(toApiScope(s)), s, `round-trip failed for ${s}`);
  }
  assert.equal(ALL_API_SCOPES.length, Object.values(Scope).length);
});
