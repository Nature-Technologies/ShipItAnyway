import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../src/client.js';

function fakeFetch(record: { url?: string; auth?: string; method?: string }, body: unknown) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    record.url = String(url);
    record.method = init?.method ?? 'GET';
    record.auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return { ok: true, status: 200, json: async () => body, text: async () => '' } as Response;
  };
}

test('listRuns hits project runs endpoint with the session token and query', async () => {
  const rec: { url?: string; auth?: string } = {};
  const client = makeClient('sia_abc', 'http://backend:3000', fakeFetch(rec, { runs: [], nextCursor: null }));
  await client.listRuns('p1', { status: 'FAILED', limit: 10 });
  assert.match(rec.url!, /\/projects\/p1\/runs\?/);
  assert.match(rec.url!, /status=FAILED/);
  assert.match(rec.url!, /limit=10/);
  assert.equal(rec.auth, 'Bearer sia_abc');
});

test('triggerRun POSTs to /mcp/trigger with the token', async () => {
  const rec: { url?: string; auth?: string; method?: string } = {};
  const client = makeClient('sia_xyz', 'http://backend:3000', fakeFetch(rec, { runIds: ['r1'], batchIds: [] }));
  const out = await client.triggerRun({ testId: 't1', environmentId: 'e1' });
  assert.equal(rec.url, 'http://backend:3000/mcp/trigger');
  assert.equal(rec.method, 'POST');
  assert.equal(rec.auth, 'Bearer sia_xyz');
  assert.deepEqual(out.runIds, ['r1']);
});
