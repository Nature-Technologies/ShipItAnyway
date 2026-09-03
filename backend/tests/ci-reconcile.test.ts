import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { ciDeliveryQueue } from '../src/queue/ci-delivery-queue';
import { reconcileStuckCiRuns } from '../src/services/ci-reconcile';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('reconciles a stuck non-terminal CI run: marks FAILED + enqueues delivery', async () => {
  const c = `corr-${uniq()}`;
  const project = await prisma.project.create({ data: { name: `rec-${uniq()}` } });
  const testRow = await prisma.test.create({ data: { name: 't', projectId: project.id, url: 'https://example.com', steps: [], testData: [] } });
  const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const run = await prisma.testRun.create({ data: { testId: testRow.id, status: 'RUNNING', trigger: 'CI', ciRepo: 'o/r', ciSha: 's', ciCorrelationId: c, startedAt: old } });
  await prisma.ciDelivery.create({ data: { correlationId: c, projectId: project.id, repo: 'o/r', sha: 's', context: 'shipitanyway/s' } });
  try {
    const n = await reconcileStuckCiRuns(30 * 60 * 1000); // 30m cutoff
    assert.ok(n >= 1);
    const reloaded = await prisma.testRun.findUnique({ where: { id: run.id } });
    assert.equal(reloaded!.status, 'FAILED');
    assert.match(reloaded!.error ?? '', /timed out|reconcil/i);
  } finally {
    await ciDeliveryQueue.drain(true);
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: c } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId: c } });
    await prisma.test.delete({ where: { id: testRow.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await ciDeliveryQueue.close();
  }
});
