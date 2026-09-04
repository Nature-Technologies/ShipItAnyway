import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportingTools } from '../src/tools/reporting.js';
import type { SiaClient } from '../src/client.js';

function stubClient(calls: string[]): SiaClient {
  return {
    listProjects: async () => { calls.push('listProjects'); return [{ id: 'p1', name: 'P' }]; },
    listRuns: async (pid: string) => { calls.push(`listRuns:${pid}`); return { runs: [], nextCursor: null }; },
    getRun: async (id: string) => { calls.push(`getRun:${id}`); return { id }; },
    getRunBatch: async (id: string) => { calls.push(`getRunBatch:${id}`); return { id }; }
  } as unknown as SiaClient;
}

test('list_runs passes projectId + filters through', async () => {
  const calls: string[] = [];
  const tools = reportingTools(stubClient(calls));
  const res = await tools.list_runs.handler({ projectId: 'p1', status: 'FAILED' });
  assert.equal(calls[0], 'listRuns:p1');
  assert.equal(res.content[0].type, 'text');
});

test('get_run calls client.getRun', async () => {
  const calls: string[] = [];
  const tools = reportingTools(stubClient(calls));
  await tools.get_run.handler({ runId: 'r1' });
  assert.equal(calls[0], 'getRun:r1');
});
