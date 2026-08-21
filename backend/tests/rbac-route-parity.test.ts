import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
import { runRoutes } from '../src/routes/runs';
import { testRoutes } from '../src/routes/tests';
import { environmentRoutes } from '../src/routes/environments';
import { projectRoutes } from '../src/routes/projects';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(runRoutes);
  await app.register(testRoutes);
  await app.register(environmentRoutes);
  await app.register(projectRoutes);
  return app;
}

async function makeUser(tag: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prisma.user.create({
    data: { email: `rbac-${tag}-${suffix}@example.com`, passwordHash: 'not-used' }
  });
}

type Tier = 'OWNER' | 'EDITOR' | 'VIEWER';

async function joinProject(projectId: string, userId: string, groupName: Tier) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId: g.id } }, update: {}, create: { userId, groupId: g.id }
  });
  await prisma.team.create({
    data: { name: `tier-${projectId}-${userId}`, projects: { create: { projectId } }, members: { create: { userId } } }
  });
}

async function seedTiers() {
  const project = await prisma.project.create({ data: { name: `rbac-${Date.now()}` } });
  const users: Record<Tier | 'OUTSIDER', { id: string; email: string }> = {} as never;
  for (const role of ['OWNER', 'EDITOR', 'VIEWER'] as Tier[]) {
    const u = await makeUser(role.toLowerCase());
    await joinProject(project.id, u.id, role);
    users[role] = u;
  }
  users.OUTSIDER = await makeUser('outsider');
  return { project, users };
}

async function cleanup(projectId: string, userIds: string[]) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

test('scope parity: read/trigger/edit/manage + secret masking match the role matrix', async () => {
  const { project, users } = await seedTiers();
  const allIds = Object.values(users).map((u) => u.id);
  const t = await prisma.test.create({
    data: {
      name: 'x', url: 'https://example.com', projectId: project.id,
      steps: [{ action: 'goto', value: 'https://example.com' }]
    }
  });
  await prisma.environment.create({
    data: { name: 'DEV', projectId: project.id, variables: { SECRET: 'super-secret' } }
  });

  const apps: Record<string, Awaited<ReturnType<typeof buildApp>>> = {};
  for (const [k, u] of Object.entries(users)) apps[k] = await buildApp(u.id, u.email);

  try {
    await testQueue.pause();

    // read (checks:read): O,E,V allow; outsider 403
    for (const k of ['OWNER', 'EDITOR', 'VIEWER']) {
      const r = await apps[k].inject({ method: 'GET', url: `/projects/${project.id}/tests` });
      assert.equal(r.statusCode, 200, `${k} read`);
    }
    assert.equal(
      (await apps.OUTSIDER.inject({ method: 'GET', url: `/projects/${project.id}/tests` })).statusCode,
      403, 'outsider read'
    );

    // trigger (runs:trigger): O,E allow (202); V,outsider 403
    for (const [k, code] of [['OWNER', 202], ['EDITOR', 202], ['VIEWER', 403], ['OUTSIDER', 403]] as const) {
      const r = await apps[k].inject({ method: 'POST', url: `/tests/${t.id}/run`, payload: {} });
      assert.equal(r.statusCode, code, `${k} trigger`);
    }

    // edit (environments:edit): O,E allow (201); V,outsider 403
    for (const [k, code] of [['OWNER', 201], ['EDITOR', 201], ['VIEWER', 403], ['OUTSIDER', 403]] as const) {
      const r = await apps[k].inject({
        method: 'POST', url: `/projects/${project.id}/environments`,
        payload: { name: `env-${k}`, variables: {} }
      });
      assert.equal(r.statusCode, code, `${k} edit`);
    }

    // manage (project:manage): O allow (200); E,V,outsider 403
    for (const [k, code] of [['OWNER', 200], ['EDITOR', 403], ['VIEWER', 403], ['OUTSIDER', 403]] as const) {
      const r = await apps[k].inject({
        method: 'PATCH', url: `/projects/${project.id}`, payload: { name: `renamed-${k}` }
      });
      assert.equal(r.statusCode, code, `${k} manage`);
    }

    // secret masking: VIEWER masked, EDITOR unmasked
    const asViewer = (await apps.VIEWER.inject({ method: 'GET', url: `/projects/${project.id}/environments` })).json();
    const asEditor = (await apps.EDITOR.inject({ method: 'GET', url: `/projects/${project.id}/environments` })).json();
    assert.equal(asViewer[0].variables.SECRET, '••••••');
    assert.equal(asEditor[0].variables.SECRET, 'super-secret');
  } finally {
    await testQueue.resume().catch(() => undefined);
    for (const app of Object.values(apps)) await app.close();
    await cleanup(project.id, allIds);
    await testQueue.drain().catch(() => undefined);
    await testQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
