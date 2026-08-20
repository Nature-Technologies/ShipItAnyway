import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { joinProject } from './helpers/rbac';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
import { scheduleRoutes } from '../src/routes/schedules';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.user = { userId, email };
  });
  await app.register(scheduleRoutes);
  return app;
}

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `schedule-run-now-${suffix}@example.com`,
      passwordHash: 'not-used'
    }
  });
  const project = await prisma.project.create({
    data: { name: `Schedule run now ${suffix}` }
  });
  await joinProject(project.id, user.id);
  return { user, project };
}

async function cleanup(projectId: string, userId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

test('POST /schedules/:id/run creates a run linked to the schedule', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    await testQueue.pause();
    const t = await prisma.test.create({
      data: { name: 'x', url: 'https://example.com', projectId: project.id,
        steps: [{ action: 'goto', value: 'https://example.com' }] }
    });
    const schedule = await prisma.schedule.create({
      data: { name: 's', cron: '0 9 * * *', projectId: project.id, testId: t.id }
    });
    const res = await app.inject({ method: 'POST', url: `/schedules/${schedule.id}/run`, payload: {} });
    assert.equal(res.statusCode, 202);
    const run = await prisma.testRun.findUnique({ where: { id: res.json().runIds[0] } });
    assert.equal(run?.scheduleId, schedule.id);
  } finally {
    await testQueue.resume().catch(() => undefined);
    await app.close(); await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
    redis.disconnect();
  }
});
