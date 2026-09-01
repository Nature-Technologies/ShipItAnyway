import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import bcrypt from 'bcrypt';
import prisma from '../src/prisma';
import { generateInviteToken } from '../src/utils/invite-token';
import { authRoutes } from '../src/routes/auth';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('accept with no groupId grants NO capability (waits for superadmin), adds team membership, is single-use', async () => {
  const inviter = await prisma.user.create({ data: { email: `inviter-${uniq()}@x.io`, passwordHash: 'x' } });
  const team = await prisma.team.create({ data: { name: `accept-team-${uniq()}` } });
  const email = `accept-${uniq()}@x.io`;
  const app = Fastify();
  await app.register(authRoutes);
  const { raw, hash } = generateInviteToken();
  const invite = await prisma.invite.create({
    data: { email, tokenHash: hash, invitedById: inviter.id, teamId: team.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite', payload: { token: raw, password: 'sup3rsecret' }
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.ok(await bcrypt.compare('sup3rsecret', user.passwordHash));
    const groups = await prisma.userGroup.findMany({ where: { userId: user.id } });
    assert.deepEqual(groups, []); // no capability until a superadmin assigns a group
    assert.ok(await prisma.teamMember.findFirst({ where: { userId: user.id, teamId: team.id } })); // membership added
    assert.equal((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).status, 'ACCEPTED');

    const second = await app.inject({
      method: 'POST', url: '/auth/accept-invite', payload: { token: raw, password: 'sup3rsecret' }
    });
    assert.equal(second.statusCode, 400); // single-use
  } finally {
    await app.close();
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.team.delete({ where: { id: team.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: inviter.id } }).catch(() => undefined);
  }
});

test('accept with an explicit groupId assigns that group', async () => {
  const inviter = await prisma.user.create({ data: { email: `inviter3-${uniq()}@x.io`, passwordHash: 'x' } });
  const editorGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } });
  const email = `accept-grp-${uniq()}@x.io`;
  const app = Fastify();
  await app.register(authRoutes);
  const { raw, hash } = generateInviteToken();
  await prisma.invite.create({
    data: { email, tokenHash: hash, invitedById: inviter.id, groupId: editorGroup.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite', payload: { token: raw, password: 'sup3rsecret' }
    });
    assert.equal(res.statusCode, 200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const groups = await prisma.userGroup.findMany({ where: { userId: user.id } });
    assert.deepEqual(groups.map((g) => g.groupId), [editorGroup.id]);
  } finally {
    await app.close();
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.user.delete({ where: { id: inviter.id } }).catch(() => undefined);
  }
});

test('accept rejects a password under 8 chars', async () => {
  const inviter = await prisma.user.create({ data: { email: `inviter2-${uniq()}@x.io`, passwordHash: 'x' } });
  const email = `short-${uniq()}@x.io`;
  const app = Fastify();
  await app.register(authRoutes);
  const { raw, hash } = generateInviteToken();
  await prisma.invite.create({
    data: { email, tokenHash: hash, invitedById: inviter.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite', payload: { token: raw, password: 'short' }
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.user.delete({ where: { id: inviter.id } }).catch(() => undefined);
  }
});
