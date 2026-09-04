import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedProjectWithRuns } from './helpers/mcp-fixtures';

test('lists runs for a project, newest first, paginated', async () => {
  const { app, projectId, viewerToken, teardown } = await seedProjectWithRuns({ runCount: 3 });
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/runs?limit=2`,
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.runs.length, 2);
    assert.ok(body.nextCursor);
    assert.ok(body.runs[0].startedAt >= body.runs[1].startedAt);
  } finally {
    await teardown();
  }
});

test('filters by status', async () => {
  const { app, projectId, viewerToken, teardown } = await seedProjectWithRuns({ runCount: 3, statuses: ['PASSED', 'FAILED', 'PASSED'] });
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/runs?status=FAILED`,
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    assert.equal(res.json().runs.length, 1);
    assert.equal(res.json().runs[0].status, 'FAILED');
  } finally {
    await teardown();
  }
});

test('403 without runs_read', async () => {
  const { app, projectId, outsiderToken, teardown } = await seedProjectWithRuns({ runCount: 1 });
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/runs`,
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await teardown();
  }
});
