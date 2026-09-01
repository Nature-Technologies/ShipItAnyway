import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { joinProject } from './helpers/rbac';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
import { fireSchedule } from '../src/services/schedule-runner';

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: { email: `sched-dd-${suffix}@example.com`, passwordHash: 'not-used' }
  });
  const project = await prisma.project.create({ data: { name: `Sched DD ${suffix}` } });
  await joinProject(project.id, user.id);
  return { user, project };
}

async function cleanup(projectId: string, userId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

test('fireSchedule creates a TestRunBatch with one run per enabled data case', async () => {
  const { user, project } = await createProjectAccess();
  try {
    await testQueue.pause();

    const t = await prisma.test.create({
      data: {
        name: 'dd-test',
        url: 'https://example.com',
        projectId: project.id,
        steps: [{ action: 'goto', value: 'https://example.com' }],
        testData: [
          { name: 'Case A', enabled: true, variables: { KEY: 'a' } },
          { name: 'Case B', enabled: true, variables: { KEY: 'b' } }
        ]
      }
    });

    const schedule = await prisma.schedule.create({
      data: { name: 's', cron: '0 9 * * *', projectId: project.id, testId: t.id }
    });

    const result = await fireSchedule(schedule.id);

    assert.ok(result.batchId, 'batchId should be set');

    const batch = await prisma.testRunBatch.findUnique({ where: { id: result.batchId! } });
    assert.ok(batch, 'batch should exist');
    assert.equal(batch!.totalCases, 2);

    const runs = await prisma.testRun.findMany({
      where: { batchId: result.batchId! },
      orderBy: { batchOrder: 'asc' }
    });
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map(r => r.scheduleId), [schedule.id, schedule.id]);
    assert.deepEqual(runs.map(r => r.batchOrder), [0, 1]);
    assert.equal(runs[0]!.status, 'PENDING');
    assert.equal(runs[1]!.status, 'PENDING');
  } finally {
    await testQueue.resume().catch(() => undefined);
    await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
    redis.disconnect();
  }
});
