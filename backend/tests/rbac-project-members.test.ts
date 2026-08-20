import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { projectRoutes } from '../src/routes/projects';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `pm-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(projectRoutes);
  return app;
}

test('members list is team-derived; project create is superadmin-only; mutations gone', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const editorGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } });
  const admin = await makeUser();
  const alice = await makeUser();
  const bob = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });
  await prisma.userGroup.create({ data: { userId: alice.id, groupId: editorGroup.id } });
  await prisma.userGroup.create({ data: { userId: bob.id, groupId: editorGroup.id } });

  const project = await prisma.project.create({ data: { name: `mem-${uniq()}` } });
  const teamA = await prisma.team.create({ data: { name: `A-${uniq()}` } });
  const teamB = await prisma.team.create({ data: { name: `B-${uniq()}` } });
  for (const t of [teamA, teamB]) await prisma.teamProject.create({ data: { teamId: t.id, projectId: project.id } });
  await prisma.teamMember.createMany({ data: [
    { teamId: teamA.id, userId: alice.id }, { teamId: teamB.id, userId: alice.id },
    { teamId: teamB.id, userId: bob.id }
  ]});

  const adminApp = await buildApp(admin.id, admin.email);
  const createdIds: string[] = [];
  try {
    // superadmin creates a project (no OWNER row created)
    const createRes = await adminApp.inject({ method: 'POST', url: '/projects', payload: { name: `p-${uniq()}` } });
    assert.equal(createRes.statusCode, 201);
    createdIds.push(createRes.json().id);
    assert.equal(await prisma.projectMember.count({ where: { projectId: createRes.json().id } }), 0);

    // team-derived, de-duplicated union with effective scopes
    const membersRes = await adminApp.inject({ method: 'GET', url: `/projects/${project.id}/members` });
    assert.equal(membersRes.statusCode, 200);
    const members = membersRes.json() as Array<{ userId: string; teams: unknown[]; scopes: string[] }>;
    assert.equal(members.length, 2); // alice once, bob once
    const aliceRow = members.find((m) => m.userId === alice.id)!;
    assert.equal(aliceRow.teams.length, 2);
    assert.ok(aliceRow.scopes.includes('checks_edit')); // from EDITOR group

    // removed mutation endpoint → 404
    assert.equal((await adminApp.inject({
      method: 'POST', url: `/projects/${project.id}/members`, payload: { email: 'x@y.z', role: 'OWNER' }
    })).statusCode, 404);

    // non-superadmin cannot create a project
    const editorApp = await buildApp(alice.id, alice.email);
    assert.equal((await editorApp.inject({ method: 'POST', url: '/projects', payload: { name: 'nope' } })).statusCode, 403);
    await editorApp.close();
  } finally {
    await adminApp.close();
    for (const id of createdIds) await prisma.project.delete({ where: { id } }).catch(() => undefined);
    for (const t of [teamA, teamB]) await prisma.team.delete({ where: { id: t.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    for (const u of [admin, alice, bob]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
