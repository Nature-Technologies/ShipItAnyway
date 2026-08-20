import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST; // force log transport (read at call time)
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { inviteRoutes } from '../src/routes/invites';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `inv-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(inviteRoutes);
  return app;
}
async function grant(userId: string, groupName: string) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.create({ data: { userId, groupId: g.id } });
}

test('superadmin creates a group invite; token is stored hashed, never raw', async () => {
  const admin = await makeUser();
  await grant(admin.id, 'SUPERADMIN');
  const group = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } });
  const app = await buildApp(admin.id, admin.email);
  try {
    const res = await app.inject({
      method: 'POST', url: '/invites',
      payload: { email: 'New.Person@Example.com', groupId: group.id }
    });
    assert.equal(res.statusCode, 201);
    const invite = await prisma.invite.findFirst({ where: { email: 'new.person@example.com' } });
    assert.ok(invite);
    assert.equal(invite!.status, 'PENDING');
    assert.equal(invite!.groupId, group.id);
    assert.equal(invite!.tokenHash.length, 64); // sha256 hex
    assert.ok(invite!.expiresAt > new Date());
  } finally {
    await app.close();
    await prisma.invite.deleteMany({ where: { email: 'new.person@example.com' } });
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
});

test('teams_manage delegate may invite with a teamId on their project but is 403 for a groupId', async () => {
  const delegate = await makeUser();
  await grant(delegate.id, 'OWNER'); // OWNER group bundles teams_manage
  const project = await prisma.project.create({ data: { name: `inv-proj-${uniq()}` } });
  const team = await prisma.team.create({
    data: { name: `inv-team-${uniq()}`, projects: { create: { projectId: project.id } }, members: { create: { userId: delegate.id } } }
  });
  const app = await buildApp(delegate.id, delegate.email);
  try {
    const ok = await app.inject({ method: 'POST', url: '/invites', payload: { email: `a-${uniq()}@x.io`, teamId: team.id } });
    assert.equal(ok.statusCode, 201);
    const forbidden = await app.inject({ method: 'POST', url: '/invites', payload: { email: `b-${uniq()}@x.io`, groupId: 'any' } });
    assert.equal(forbidden.statusCode, 403);
  } finally {
    await app.close();
    await prisma.invite.deleteMany({ where: { teamId: team.id } });
    await prisma.team.delete({ where: { id: team.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: delegate.id } }).catch(() => undefined);
  }
});

test('re-inviting a PENDING email rotates the token instead of duplicating', async () => {
  const admin = await makeUser();
  await grant(admin.id, 'SUPERADMIN');
  const group = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } });
  const app = await buildApp(admin.id, admin.email);
  const email = `dup-${uniq()}@x.io`;
  try {
    await app.inject({ method: 'POST', url: '/invites', payload: { email, groupId: group.id } });
    const first = await prisma.invite.findFirstOrThrow({ where: { email } });
    await app.inject({ method: 'POST', url: '/invites', payload: { email, groupId: group.id } });
    const all = await prisma.invite.findMany({ where: { email } });
    assert.equal(all.length, 1); // re-issued, not duplicated
    assert.notEqual(all[0].tokenHash, first.tokenHash); // token rotated
  } finally {
    await app.close();
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
});
