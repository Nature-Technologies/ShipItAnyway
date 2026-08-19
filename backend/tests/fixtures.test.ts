import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import prisma from '../src/prisma';
import { fixtureRoutes } from '../src/routes/fixtures';

async function buildApp(userId: string, email: string) {
  const app = Fastify();

  app.addHook('preHandler', async (req) => {
    req.user = { userId, email };
  });

  await app.register(multipart);
  await app.register(fixtureRoutes);
  return app;
}

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `fixtures-${suffix}@example.com`,
      passwordHash: 'not-used'
    }
  });

  const project = await prisma.project.create({
    data: { name: `Fixtures ${suffix}` }
  });

  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: user.id,
      email: user.email,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });

  return { user, project };
}

async function cleanup(projectId: string, userId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

test('upload stores a fixture and list returns it', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    const boundary = '----t';
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hi.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/fixtures`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().fixture.filename, 'hi.txt');
    const list = await app.inject({ method: 'GET', url: `/projects/${project.id}/fixtures` });
    assert.equal(list.json().fixtures.length, 1);
  } finally {
    await app.close(); await cleanup(project.id, user.id);
  }
});
