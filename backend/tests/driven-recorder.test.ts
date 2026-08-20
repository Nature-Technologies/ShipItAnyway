import assert from 'node:assert/strict';
import test from 'node:test';
import { startDrivenSession, getDrivenSession, stopDrivenSession } from '../src/services/driven-recorder';
import { launchChromium } from '../src/utils/browser';

async function chromiumAvailable() {
  try { const b = await launchChromium(); await b.close(); return true; } catch { return false; }
}

test('start records initial goto, returns a view, and stop frees the browser', async (t) => {
  // ponytail: top-level await unsupported in CJS; guard moved into test body — same skip semantics
  const hasChromium = await chromiumAvailable();
  if (!hasChromium) { t.skip('chromium unavailable'); return; }

  const { sessionId, steps, view } = await startDrivenSession({
    projectId: 'p1', userId: 'u1', url: 'data:text/html,<button id=b>Hi</button>'
  });
  assert.ok(sessionId);
  assert.equal(steps[0].action, 'goto');
  assert.ok(view.screenshot.length > 0);
  assert.match(view.snapshot, /button/); // aria snapshot names the button
  assert.ok(getDrivenSession(sessionId));
  const stopped = await stopDrivenSession(sessionId);
  assert.equal(stopped.steps[0].action, 'goto');
  assert.equal(getDrivenSession(sessionId), undefined);
});
