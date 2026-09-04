import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, tokenFor, seedUserInGroup } from './helpers/mcp-fixtures';

test('returns api-format scope union for a viewer token', async () => {
  const { app, token } = await seedUserInGroup('VIEWER');
  const res = await app.inject({ method: 'GET', url: '/me/capabilities', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.scopes.includes('runs:read'));
  assert.ok(body.scopes.includes('checks:read'));
  assert.ok(!body.scopes.includes('runs:trigger'));
  assert.equal(body.isSuperadmin, false);
  await app.close();
});

test('401 on missing token', async () => {
  const { app } = await seedUserInGroup('VIEWER');
  const res = await app.inject({ method: 'GET', url: '/me/capabilities' });
  assert.equal(res.statusCode, 401);
  await app.close();
});
