import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { ciDeliveryQueue } from '../src/queue/ci-delivery-queue';
import { maybeEnqueueCiDelivery } from '../src/services/ci-delivery';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('enqueues delivery only when all correlated runs are terminal', async () => {
  const c = `corr-${uniq()}`;
  const project = await prisma.project.create({ data: { name: `fh-${uniq()}` } });
  const testRow = await prisma.test.create({ data: { name: 't', projectId: project.id, url: 'https://example.com', steps: [], testData: [] } });
  const r1 = await prisma.testRun.create({ data: { testId: testRow.id, status: 'PASSED', trigger: 'CI', ciRepo: 'o/r', ciSha: 's', ciCorrelationId: c } });
  const r2 = await prisma.testRun.create({ data: { testId: testRow.id, status: 'PENDING', trigger: 'CI', ciRepo: 'o/r', ciSha: 's', ciCorrelationId: c } });
  await prisma.ciDelivery.create({ data: { correlationId: c, projectId: project.id, repo: 'o/r', sha: 's', context: 'shipitanyway/s' } });
  const before = await ciDeliveryQueue.getJobCounts();
  try {
    await maybeEnqueueCiDelivery(r1.id); // sibling r2 still pending → no enqueue
    let counts = await ciDeliveryQueue.getJobCounts();
    assert.equal((counts.waiting + counts.delayed) - (before.waiting + before.delayed), 0);

    await prisma.testRun.update({ where: { id: r2.id }, data: { status: 'FAILED' } });
    await maybeEnqueueCiDelivery(r2.id); // now all terminal → enqueue
    counts = await ciDeliveryQueue.getJobCounts();
    assert.equal((counts.waiting + counts.delayed) - (before.waiting + before.delayed), 1);
  } finally {
    await ciDeliveryQueue.drain(true);
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: c } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId: c } });
    await prisma.test.delete({ where: { id: testRow.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await ciDeliveryQueue.close();
  }
});
