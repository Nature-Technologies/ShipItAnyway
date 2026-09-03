import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { projectRoutes } from '../src/routes/projects';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () => prisma.user.create({ data: { email: `g-${uniq()}@example.com`, passwordHash: 'x' } });
async function grantGlobal(userId: string) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  await prisma.userGroup.create({ data: { userId, groupId: g.id } });
}
async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(projectRoutes);
  return app;
}

test('PUT stores repo+pat; GET masks the pat and never returns it raw', async () => {
  const admin = await makeUser();
  await grantGlobal(admin.id);
  const project = await prisma.project.create({ data: { name: `gh-${uniq()}` } });
  const app = await buildApp(admin.id, admin.email);
  try {
    const put = await app.inject({ method: 'PUT', url: `/projects/${project.id}/github`, payload: { repo: 'octo/repo', pat: 'ghp_secretvalue123' } });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().ghRepo, 'octo/repo');
    assert.ok(!/ghp_secretvalue123/.test(put.json().ghPatMasked));
    const get = await app.inject({ method: 'GET', url: `/projects/${project.id}/github` });
    assert.equal(get.json().ghRepo, 'octo/repo');
    assert.ok(!/ghp_secretvalue123/.test(JSON.stringify(get.json())));
    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    assert.equal(stored!.ghPat, 'ghp_secretvalue123');
  } finally {
    await app.close();
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
});
