import assert from 'node:assert/strict';
import test from 'node:test';
import { startDrivenSession, performDrivenAction, observeDrivenSession, stopDrivenSession } from '../src/services/driven-recorder';
import { launchChromium } from '../src/utils/browser';

async function chromiumAvailable() {
  try { const b = await launchChromium(); await b.close(); return true; } catch { return false; }
}

test('click is executed, appended, and enriched', async (t) => {
  // ponytail: CJS top-level await unsupported; guard in test body per driven-recorder.test.ts pattern
  const hasChromium = await chromiumAvailable();
  if (!hasChromium) { t.skip('chromium unavailable'); return; }

  const { sessionId } = await startDrivenSession({
    projectId: 'p1', userId: 'u1', url: 'data:text/html,<button id=b>Hi</button>'
  });
  try {
    const { step, view } = await performDrivenAction(sessionId, { action: 'click', selector: '#b' });
    assert.equal(step.action, 'click');
    assert.equal(step.selector, '#b');
    assert.ok(Array.isArray(step.selectorCandidates));
    assert.ok(view.screenshot.length > 0);
    assert.equal(typeof view.snapshot, 'string');
  } finally { await stopDrivenSession(sessionId); }
});

test('a failing assertion throws and appends nothing', async (t) => {
  const hasChromium = await chromiumAvailable();
  if (!hasChromium) { t.skip('chromium unavailable'); return; }

  const { sessionId } = await startDrivenSession({
    projectId: 'p1', userId: 'u1', url: 'data:text/html,<div>only this</div>'
  });
  try {
    await assert.rejects(() => performDrivenAction(sessionId, { action: 'assertVisible', selector: '#missing' }));
    const { steps } = await stopDrivenSession(sessionId);
    assert.equal(steps.length, 1); // only the initial goto
  } catch (e) { await stopDrivenSession(sessionId); throw e; }
});

test('observeDrivenSession returns view for live session', async (t) => {
  const hasChromium = await chromiumAvailable();
  if (!hasChromium) { t.skip('chromium unavailable'); return; }

  const { sessionId } = await startDrivenSession({
    projectId: 'p1', userId: 'u1', url: 'data:text/html,<p>observe</p>'
  });
  try {
    const { view } = await observeDrivenSession(sessionId);
    assert.ok(view.screenshot.length > 0);
  } finally { await stopDrivenSession(sessionId); }
});
