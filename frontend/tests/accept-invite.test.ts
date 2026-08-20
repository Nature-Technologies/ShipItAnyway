import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInvite, acceptInvite, api } from '../src/api/client';

test('validateInvite GETs /auth/invite with the token param', async () => {
  const calls: any[] = [];
  const restore = api.get;
  (api as any).get = async (url: string, cfg: any) => { calls.push({ url, cfg }); return { data: { email: 'x@y.io' } }; };
  try {
    const out = await validateInvite('RAW');
    assert.equal(out.email, 'x@y.io');
    assert.equal(calls[0].url, '/auth/invite');
    assert.equal(calls[0].cfg.params.token, 'RAW');
  } finally { (api as any).get = restore; }
});

test('acceptInvite POSTs token + password to /auth/accept-invite', async () => {
  const calls: any[] = [];
  const restore = api.post;
  (api as any).post = async (url: string, body: any) => { calls.push({ url, body }); return { data: { ok: true } }; };
  try {
    const out = await acceptInvite('RAW', 'sup3rsecret');
    assert.deepEqual(out, { ok: true });
    assert.equal(calls[0].url, '/auth/accept-invite');
    assert.deepEqual(calls[0].body, { token: 'RAW', password: 'sup3rsecret' });
  } finally { (api as any).post = restore; }
});
