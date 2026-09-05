import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocator } from '../src/utils/locator';

// A fake Page that records which locator method was called with which args, so we can assert the
// parser dispatches correctly without launching a browser. Returns a sentinel "Locator".
function makeFakePage() {
  const calls: { method: string; args: unknown[] }[] = [];
  const handler = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return { __locator: true } as unknown;
  };
  const page = {
    getByRole: handler('getByRole'),
    getByText: handler('getByText'),
    getByLabel: handler('getByLabel'),
    getByPlaceholder: handler('getByPlaceholder'),
    getByTestId: handler('getByTestId'),
    getByTitle: handler('getByTitle'),
    getByAltText: handler('getByAltText'),
    locator: handler('locator')
  };
  return { page, calls };
}

test('valid locator forms parse and dispatch with correct args', () => {
  const { page, calls } = makeFakePage();
  resolveLocator(page as never, "page.getByText('Hello')");
  resolveLocator(page as never, "page.getByRole('button', { name: 'Submit', exact: true })");
  resolveLocator(page as never, "page.locator('a', { hasText: 'Docs' })");
  resolveLocator(page as never, "page.getByTestId('nav-1')");

  assert.deepEqual(calls[0], { method: 'getByText', args: ['Hello'] });
  assert.deepEqual(calls[1], { method: 'getByRole', args: ['button', { name: 'Submit', exact: true }] });
  assert.deepEqual(calls[2], { method: 'locator', args: ['a', { hasText: 'Docs' }] });
  assert.deepEqual(calls[3], { method: 'getByTestId', args: ['nav-1'] });
});

test('raw (non page.) selectors fall through to page.locator', () => {
  const { page, calls } = makeFakePage();
  resolveLocator(page as never, '#login-form input[name="email"]');
  assert.deepEqual(calls[0], { method: 'locator', args: ['#login-form input[name="email"]'] });
});

test('RCE payloads are rejected, no code executes', () => {
  const { page } = makeFakePage();
  let sideEffect = false;
  (globalThis as Record<string, unknown>).__rceCanary = () => { sideEffect = true; };
  const payloads = [
    "page.getByText((function(){throw new Error('x')})())",
    "page.getByText('a'); globalThis.__rceCanary(); page.getByText('b')",
    "page.getByText(globalThis.__rceCanary())",
    "page.locator('a').evaluate(() => 1)",
    "page.evaluate(() => 1)", // method not in allowlist
    "page.getByText(require('os').hostname())"
  ];
  for (const p of payloads) {
    assert.throws(() => resolveLocator(page as never, p), /rejected/, `should reject: ${p}`);
  }
  assert.equal(sideEffect, false, 'no payload may execute code');
  delete (globalThis as Record<string, unknown>).__rceCanary;
});
