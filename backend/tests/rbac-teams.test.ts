import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { teamRoutes } from '../src/routes/teams';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `team-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(teamRoutes);
  return app;
}

test('teams_manage delegate manages teams; project attach is project-gated', async () => {
  const ownerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'OWNER' } }); // has teams_manage
  const viewerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } });
  const delegate = await makeUser();
  const member = await makeUser();
  const plain = await makeUser();
  await prisma.userGroup.create({ data: { userId: delegate.id, groupId: ownerGroup.id } });
  await prisma.userGroup.create({ data: { userId: plain.id, groupId: viewerGroup.id } });

  const authorized = await prisma.project.create({ data: { name: `auth-${uniq()}` } });
  const other = await prisma.project.create({ data: { name: `other-${uniq()}` } });
  const gateTeam = await prisma.team.create({ data: { name: `gate-${uniq()}` } });
  await prisma.teamMember.create({ data: { teamId: gateTeam.id, userId: delegate.id } });
  await prisma.teamProject.create({ data: { teamId: gateTeam.id, projectId: authorized.id } });

  const delegateApp = await buildApp(delegate.id, delegate.email);
  const plainApp = await buildApp(plain.id, plain.email);
  let teamId: string | undefined;
  try {
    // plain member cannot create teams
    assert.equal((await plainApp.inject({ method: 'POST', url: '/teams', payload: { name: 'x' } })).statusCode, 403);

    // delegate creates a team, adds a member
    const createRes = await delegateApp.inject({ method: 'POST', url: '/teams', payload: { name: `t-${uniq()}` } });
    assert.equal(createRes.statusCode, 201);
    teamId = createRes.json().id;
    assert.equal((await delegateApp.inject({
      method: 'POST', url: `/teams/${teamId}/members`, payload: { userId: member.id }
    })).statusCode, 201);

    // attach to a project the delegate has teams_manage on → allow
    assert.equal((await delegateApp.inject({
      method: 'POST', url: `/teams/${teamId}/projects`, payload: { projectId: authorized.id }
    })).statusCode, 201);

    // attach to a project the delegate lacks authority on → 403
    assert.equal((await delegateApp.inject({
      method: 'POST', url: `/teams/${teamId}/projects`, payload: { projectId: other.id }
    })).statusCode, 403);
  } finally {
    await delegateApp.close(); await plainApp.close();
    if (teamId) await prisma.team.delete({ where: { id: teamId } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: gateTeam.id } }).catch(() => undefined);
    for (const p of [authorized, other]) await prisma.project.delete({ where: { id: p.id } }).catch(() => undefined);
    for (const u of [delegate, member, plain]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
