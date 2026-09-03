import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { reportQueue } from '../src/queue/report-queue';
import { reportScheduler } from '../src/services/report-scheduler';

test('register upserts one report job scheduler; unregister removes it', async () => {
  const project = await prisma.project.create({ data: { name: `report-sched-${Date.now()}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  const config = await prisma.reportConfig.create({
    data: { name: 'Nightly', projectId: project.id, environmentId: env.id, cron: '0 8 * * *', timezone: 'UTC' }
  });
  try {
    await reportScheduler.register(config);
    let schedulers = await reportQueue.getJobSchedulers();
    assert.equal(schedulers.filter((s) => s.key === config.id).length, 1);

    await reportScheduler.unregister(config.id);
    schedulers = await reportQueue.getJobSchedulers();
    assert.equal(schedulers.filter((s) => s.key === config.id).length, 0);
  } finally {
    await reportQueue.removeJobScheduler(config.id).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await reportQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
