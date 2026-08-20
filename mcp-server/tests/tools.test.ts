import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTools } from '../src/index.js';

const view = { screenshot: 'x', snapshot: '- button "Hi"', url: 'https://e.com', title: 'T' };

function stubClient(overrides: Record<string, unknown> = {}) {
  return {
    startDriven: async () => ({ sessionId: 's1', steps: [], view }),
    action: async (id: string, a: unknown) => ({ step: a, view }),
    observe: async () => ({ view }),
    stopDriven: async () => ({ steps: [{ action: 'goto', value: 'https://e.com' }] }),
    createTest: async () => ({ id: 't1', name: 'T', url: 'https://e.com', steps: [] }),
    validateSteps: async () => ({ ok: true }),
    listTests: async () => [{ id: 't1', name: 'T', url: 'https://e.com', steps: [] }],
    getTest: async () => ({ id: 't1', name: 'T', url: 'https://e.com', steps: [] }),
    deleteTest: async () => undefined,
    ...overrides,
  };
}

test('click tool forwards the active session and selector', async () => {
  const calls: unknown[] = [];
  const client = stubClient({ action: async (id: string, a: unknown) => { calls.push([id, a]); return { step: a, view }; } });
  const tools = buildTools(client as any);
  await tools.start_recording.handler({ projectId: 'p', url: 'https://e.com' });
  await tools.click.handler({ selector: '#b' });
  assert.deepEqual(calls[0], ['s1', { action: 'click', selector: '#b' }]);
});

test('save_test is rejected while a recording is still active', async () => {
  const tools = buildTools(stubClient() as any);
  await tools.start_recording.handler({ projectId: 'p', url: 'https://e.com' });
  await assert.rejects(
    () => tools.save_test.handler({ name: 'My test' }),
    /Recording still in progress/
  );
});

test('save_test is rejected before anything has been recorded', async () => {
  const tools = buildTools(stubClient() as any);
  await assert.rejects(
    () => tools.save_test.handler({ name: 'My test' }),
    /No finished recording/
  );
});

test('save_test persists the finished recording to its project', async () => {
  const calls: unknown[] = [];
  const client = stubClient({
    createTest: async (projectId: string, input: unknown) => { calls.push([projectId, input]); return { id: 't9', name: 'My test' }; },
  });
  const tools = buildTools(client as any);
  await tools.start_recording.handler({ projectId: 'p', url: 'https://e.com' });
  await tools.finish_recording.handler({});
  const res = await tools.save_test.handler({ name: 'My test' });
  assert.deepEqual(calls[0], ['p', { name: 'My test', url: 'https://e.com', steps: [{ action: 'goto', value: 'https://e.com' }], device: undefined, environmentId: undefined }]);
  assert.match((res.content[0] as { text: string }).text, /t9/);
});

test('list_tests falls back to the recording project when none is given', async () => {
  const calls: unknown[] = [];
  const client = stubClient({ listTests: async (projectId: string) => { calls.push(projectId); return []; } });
  const tools = buildTools(client as any);
  await tools.start_recording.handler({ projectId: 'p', url: 'https://e.com' });
  await tools.finish_recording.handler({});
  await tools.list_tests.handler({});
  assert.deepEqual(calls, ['p']);
});
