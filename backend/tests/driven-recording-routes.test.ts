import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { recordingRoutes } from '../src/routes/recordings';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.user = { userId, email };
  });
  await app.register(recordingRoutes);
  return app;
}

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: { email: `driven-${suffix}@example.com`, passwordHash: 'not-used' }
  });
  const project = await prisma.project.create({
    data: { name: `Driven ${suffix}` }
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, email: user.email, role: 'OWNER', status: 'ACTIVE' }
  });
  return { user, project };
}

async function cleanup(projectId: string, userId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

test('driven start rejects a non-member with 403', async () => {
  const { user, project } = await createProjectAccess();
  const outsider = await prisma.user.create({ data: { email: `o-${Date.now()}@e.com`, passwordHash: 'x' } });
  const app = await buildApp(outsider.id, outsider.email);
  try {
    const res = await app.inject({
      method: 'POST', url: '/recordings/driven/start',
      payload: { projectId: project.id, url: 'data:text/html,<b>x</b>' }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close(); await cleanup(project.id, user.id);
    await prisma.user.delete({ where: { id: outsider.id } }).catch(() => undefined);
  }
});

test('action on an unknown session is 404', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    const res = await app.inject({
      method: 'POST', url: '/recordings/driven/nope/action',
      payload: { action: 'click', selector: '#x' }
    });
    assert.equal(res.statusCode, 404);
  } finally { await app.close(); await cleanup(project.id, user.id); }
});
