import assert from 'node:assert/strict';
import test from 'node:test';
import { StepSchema } from '../src/schemas/test.schema';
import { stepToCode } from '../src/services/exporter';

test('StepSchema accepts an upload step', () => {
  assert.equal(StepSchema.safeParse({ action: 'upload', selector: 'input[type=file]', value: 'fx_123' }).success, true);
});

test('exporter serializes upload to setInputFiles', () => {
  const code = stepToCode({ action: 'upload', selector: 'input[type=file]', value: 'fx_123' }, {}, false);
  assert.match(code, /setInputFiles/);
  assert.match(code, /input\[type=file\]/);
});
