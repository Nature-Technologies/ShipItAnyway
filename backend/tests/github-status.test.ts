import assert from 'node:assert/strict';
import test from 'node:test';
import { postCommitStatus, suiteContext } from '../src/services/github';

test('suiteContext slugifies to a stable shipitanyway/ context', () => {
  assert.equal(suiteContext('Checkout E2E'), 'shipitanyway/checkout-e2e');
  assert.equal(suiteContext('  Login   Flow!! '), 'shipitanyway/login-flow');
});

test('postCommitStatus POSTs to the statuses API with auth + payload', async () => {
  const calls: any[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: true, status: 201, text: async () => '' } as any;
  }) as any;
  try {
    await postCommitStatus({
      repo: 'octo/repo', sha: 'abc123', pat: 'ghp_x',
      state: 'success', context: 'shipitanyway/e2e', targetUrl: 'https://sia/run/1', description: '3/3 passed'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/repos/octo/repo/statuses/abc123');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer ghp_x');
    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.state, 'success');
    assert.equal(payload.context, 'shipitanyway/e2e');
    assert.equal(payload.target_url, 'https://sia/run/1');
  } finally {
    globalThis.fetch = orig;
  }
});

test('postCommitStatus throws on non-2xx', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 422, text: async () => 'bad sha' }) as any) as any;
  try {
    await assert.rejects(
      postCommitStatus({ repo: 'o/r', sha: 'x', pat: 'p', state: 'failure', context: 'c' }),
      /422/
    );
  } finally {
    globalThis.fetch = orig;
  }
});
