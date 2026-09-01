import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST;
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { joinProject } from './helpers/rbac';
import { reportQueue } from '../src/queue/report-queue';
import { reportRoutes } from '../src/routes/reports';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(reportRoutes);
  return app;
}

async function access(group: 'OWNER' | 'VIEWER' = 'OWNER') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { email: `reports-${suffix}@example.com`, passwordHash: 'x' } });
  const project = await prisma.project.create({ data: { name: `Reports ${suffix}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  await joinProject(project.id, user.id, group);
  return { user, project, env };
}

test('create → list → send-now → sends history', async () => {
  const { user, project, env } = await access('OWNER');
  const app = await buildApp(user.id, user.email);
  let create: Awaited<ReturnType<typeof app.inject>> | undefined;
  try {
    create = await app.inject({
      method: 'POST', url: `/projects/${project.id}/reports`,
      payload: { name: 'Nightly', environmentId: env.id, cron: '0 8 * * *', recipients: ['ops@example.com'], checkIds: [] }
    });
    assert.equal(create.statusCode, 201);
    const id = create.json().id as string;

    const list = await app.inject({ method: 'GET', url: `/projects/${project.id}/reports` });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().length, 1);

    const send = await app.inject({ method: 'POST', url: `/reports/${id}/send-now`, payload: {} });
    assert.equal(send.statusCode, 200);
    assert.equal(send.json().status, 'SKIPPED_EMPTY'); // no runs yet

    const sends = await app.inject({ method: 'GET', url: `/reports/${id}/sends` });
    assert.equal(sends.statusCode, 200);
    assert.equal(sends.json().length, 1);
  } finally {
    await reportQueue.removeJobScheduler(create ? create.json().id : '').catch(() => undefined);
    await app.close();
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await reportQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('viewer cannot create a report (403)', async () => {
  const { user, project, env } = await access('VIEWER');
  const app = await buildApp(user.id, user.email);
  try {
    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/reports`,
      payload: { name: 'Nightly', environmentId: env.id, cron: '0 8 * * *', recipients: [], checkIds: [] }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await reportQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
