import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectMember, ProjectRole } from '@prisma/client';
import { resolveScopes, can, type Scope } from '../src/utils/project-access';

const member = (role: ProjectRole) => ({ role }) as ProjectMember; // resolveScopes reads only .role
const set = (role: ProjectRole) => [...resolveScopes(member(role))].sort();

test('resolveScopes: VIEWER = all *:read, no reveal-secrets', () => {
  assert.deepEqual(set('VIEWER'), [
    'alerts:read', 'checks:read', 'environments:read',
    'members:read', 'runs:read', 'schedules:read'
  ]);
});

test('resolveScopes: EDITOR = VIEWER + edit/trigger + reveal-secrets', () => {
  assert.deepEqual(set('EDITOR'), [
    'alerts:edit', 'alerts:read', 'checks:edit', 'checks:read',
    'environments:edit', 'environments:read', 'environments:reveal-secrets',
    'members:read', 'runs:read', 'runs:trigger',
    'schedules:edit', 'schedules:read'
  ]);
});

test('resolveScopes: OWNER = EDITOR + project:manage/delete + teams:manage', () => {
  const owner = set('OWNER');
  for (const s of set('EDITOR')) assert.ok(owner.includes(s), `owner missing ${s}`);
  assert.ok(owner.includes('project:manage'));
  assert.ok(owner.includes('project:delete'));
  assert.ok(owner.includes('teams:manage'));
});

test('can: truth table across tiers', () => {
  const access = (role: ProjectRole) =>
    ({ project: { id: 'p', name: 'p' }, member: member(role) });
  assert.equal(can(access('VIEWER'), 'runs:read'), true);
  assert.equal(can(access('VIEWER'), 'runs:trigger'), false);
  assert.equal(can(access('VIEWER'), 'environments:reveal-secrets'), false);
  assert.equal(can(access('EDITOR'), 'runs:trigger'), true);
  assert.equal(can(access('EDITOR'), 'environments:reveal-secrets'), true);
  assert.equal(can(access('EDITOR'), 'project:manage'), false);
  assert.equal(can(access('OWNER'), 'project:delete'), true);
});
