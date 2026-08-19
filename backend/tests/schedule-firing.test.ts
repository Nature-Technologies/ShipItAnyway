import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { scheduleQueue } from '../src/queue/schedule-queue';
import { schedulerService } from '../src/services/scheduler';

test('register upserts one job scheduler; unregister removes it', async () => {
  const project = await prisma.project.create({ data: { name: `firing-${Date.now()}` } });
  const t = await prisma.test.create({
    data: { name: 'x', url: 'https://example.com', projectId: project.id, steps: [] }
  });
  const schedule = await prisma.schedule.create({
    data: { name: 's', cron: '0 9 * * *', projectId: project.id, testId: t.id, timezone: 'UTC' }
  });
  try {
    await schedulerService.register(schedule);
    let schedulers = await scheduleQueue.getJobSchedulers();
    assert.equal(schedulers.filter(s => s.key === schedule.id).length, 1);

    await schedulerService.unregister(schedule.id);
    schedulers = await scheduleQueue.getJobSchedulers();
    assert.equal(schedulers.filter(s => s.key === schedule.id).length, 0);
  } finally {
    await scheduleQueue.removeJobScheduler(schedule.id).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await scheduleQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
