import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTriggerableTest, tokenFor } from './helpers/mcp-fixtures';

test('triggers a single test run tagged MCP', async () => {
  const { app, testId, environmentId, editorToken } = await seedTriggerableTest();
  const res = await app.inject({
    method: 'POST', url: '/mcp/trigger',
    headers: { authorization: `Bearer ${editorToken}` },
    payload: { testId, environmentId }
  });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().runIds.length, 1);
  await app.close();
});

test('400 when both testId and suiteId given', async () => {
  const { app, testId, suiteId, environmentId, editorToken } = await seedTriggerableTest({ withSuite: true });
  const res = await app.inject({
    method: 'POST', url: '/mcp/trigger',
    headers: { authorization: `Bearer ${editorToken}` },
    payload: { testId, suiteId, environmentId }
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('400 when neither testId nor suiteId given', async () => {
  const { app, environmentId, editorToken } = await seedTriggerableTest();
  const res = await app.inject({
    method: 'POST', url: '/mcp/trigger',
    headers: { authorization: `Bearer ${editorToken}` },
    payload: { environmentId }
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('422 when suite has no checks', async () => {
  const { app, emptySuiteId, environmentId, editorToken } = await seedTriggerableTest({ withEmptySuite: true });
  const res = await app.inject({
    method: 'POST', url: '/mcp/trigger',
    headers: { authorization: `Bearer ${editorToken}` },
    payload: { suiteId: emptySuiteId, environmentId }
  });
  assert.equal(res.statusCode, 422);
  await app.close();
});

test('403 without runs_trigger', async () => {
  const { app, testId, environmentId, viewerToken } = await seedTriggerableTest();
  const res = await app.inject({
    method: 'POST', url: '/mcp/trigger',
    headers: { authorization: `Bearer ${viewerToken}` },
    payload: { testId, environmentId }
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});
