import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeUserRegex, compileUserRegExp } from '../src/utils/safe-regexp';

test('rejects catastrophic-backtracking patterns', () => {
  for (const bad of ['(a+)+$', '(a*)*b', '(\\d+){2,}', '(.*)+x', '(a|a)*', '(x|xy)+']) {
    assert.throws(() => assertSafeUserRegex(bad), /catastrophic|too long/, `should reject: ${bad}`);
  }
  assert.throws(() => assertSafeUserRegex('a'.repeat(600)), /too long/);
});

test('allows normal assertion patterns', () => {
  for (const ok of ['^/dashboard$', 'foo.*bar', 'https://example\\.com/.+', 'Login|Sign in', '\\d{4}-\\d{2}']) {
    assert.doesNotThrow(() => assertSafeUserRegex(ok), `should allow: ${ok}`);
  }
  assert.ok(compileUserRegExp('^/dashboard$').test('/dashboard'));
});
