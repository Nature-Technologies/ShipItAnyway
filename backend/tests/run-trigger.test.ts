import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { joinProject } from './helpers/rbac';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
import { runRoutes } from '../src/routes/runs';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.user = { userId, email };
  });
  await app.register(runRoutes);
  return app;
}

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `run-trigger-${suffix}@example.com`,
      passwordHash: 'not-used'
    }
  });
  const project = await prisma.project.create({
    data: { name: `Run trigger ${suffix}` }
  });
  await joinProject(project.id, user.id);
  return { user, project };
}

async function cleanup(projectId: string, userId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

test('manual run is created with trigger MANUAL', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    const t = await prisma.test.create({
      data: { name: 'x', url: 'https://example.com', projectId: project.id,
        steps: [{ action: 'goto', value: 'https://example.com' }] }
    });
    const res = await app.inject({ method: 'POST', url: `/tests/${t.id}/run`, payload: {} });
    assert.equal(res.statusCode, 202);
    const run = await prisma.testRun.findUnique({ where: { id: res.json().testRunId } });
    assert.equal(run?.trigger, 'MANUAL');
  } finally {
    await app.close(); await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
    redis.disconnect();
  }
});
