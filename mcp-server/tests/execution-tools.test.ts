import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionTools } from '../src/tools/execution.js';
import type { SiaClient } from '../src/client.js';

test('trigger_run forwards testId/suiteId + environmentId', async () => {
  const seen: unknown[] = [];
  const client = { triggerRun: async (b: unknown) => { seen.push(b); return { runIds: ['r1'], batchIds: [] }; } } as unknown as SiaClient;
  const tools = executionTools(client);
  const res = await tools.trigger_run.handler({ testId: 't1', environmentId: 'e1' });
  assert.deepEqual(seen[0], { testId: 't1', suiteId: undefined, environmentId: 'e1' });
  assert.match((res.content[0] as { text: string }).text, /r1/);
});
