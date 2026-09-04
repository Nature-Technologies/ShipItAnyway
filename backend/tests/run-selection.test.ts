import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { createRunsForSelection } from '../src/services/run-selection';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('suite selection creates one run per test, stamped with trigger + ci fields', async () => {
  const project = await prisma.project.create({ data: { name: `sel-${uniq()}` } });
  const t1 = await prisma.test.create({ data: { name: 'a', url: 'https://example.com', projectId: project.id, steps: [], testData: [] } });
  const t2 = await prisma.test.create({ data: { name: 'b', url: 'https://example.com', projectId: project.id, steps: [], testData: [] } });
  const suite = await prisma.suite.create({ data: { name: 's', projectId: project.id, testIds: [t1.id, t2.id] } });
  const env = await prisma.environment.create({ data: { name: 'e', projectId: project.id } });
  try {
    const { runIds } = await createRunsForSelection({
      suiteId: suite.id, environmentId: env.id, trigger: 'CI',
      ci: { repo: 'o/r', sha: 'deadbeef', prNumber: 7, correlationId: 'corr-1' }
    });
    assert.equal(runIds.length, 2);
    const runs = await prisma.testRun.findMany({ where: { id: { in: runIds } } });
    for (const r of runs) {
      assert.equal(r.trigger, 'CI');
      assert.equal(r.ciSha, 'deadbeef');
      assert.equal(r.ciCorrelationId, 'corr-1');
      assert.equal(r.environmentId, env.id);
    }
  } finally {
    await prisma.testRun.deleteMany({ where: { testId: { in: [t1.id, t2.id] } } });
    await prisma.suite.deleteMany({ where: { projectId: project.id } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.test.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});
