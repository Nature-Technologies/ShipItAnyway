import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTools } from '../src/index.js';

test('click tool forwards the active session and selector', async () => {
  const calls: unknown[] = [];
  const view = { screenshot: 'x', snapshot: '- button "Hi"', url: 'https://e.com', title: 'T' };
  const client = {
    startDriven: async () => ({ sessionId: 's1', steps: [], view }),
    action: async (id: string, a: unknown) => { calls.push([id, a]); return { step: a, view }; },
    observe: async () => ({ view }),
    stopDriven: async () => ({ steps: [] })
  };
  const tools = buildTools(client as any);
  await tools.start_recording.handler({ projectId: 'p', url: 'https://e.com' });
  await tools.click.handler({ selector: '#b' });
  assert.deepEqual(calls[0], ['s1', { action: 'click', selector: '#b' }]);
});
