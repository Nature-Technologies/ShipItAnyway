import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST;
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { generateInviteToken } from '../src/utils/invite-token';
import { inviteRoutes } from '../src/routes/invites';
import { authRoutes } from '../src/routes/auth';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `mng-${uniq()}@example.com`, passwordHash: 'x' } });

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

test('inviter revokes their invite; a revoked token no longer accepts', async () => {
  const inviter = await makeUser();
  const app = await buildApp(inviter.id, inviter.email);
  const authApp = Fastify(); await authApp.register(authRoutes);
  const email = `rev-${uniq()}@x.io`;
  const { raw, hash } = generateInviteToken();
  const invite = await prisma.invite.create({
    data: { email, tokenHash: hash, invitedById: inviter.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  try {
    const del = await app.inject({ method: 'DELETE', url: `/invites/${invite.id}` });
    assert.equal(del.statusCode, 200);
    assert.equal((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).status, 'REVOKED');
    const accept = await authApp.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token: raw, password: 'sup3rsecret' } });
    assert.equal(accept.statusCode, 400);
  } finally {
    await app.close(); await authApp.close();
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.user.delete({ where: { id: inviter.id } }).catch(() => undefined);
  }
});

test('GET /invites lists PENDING invites for a superadmin and omits tokenHash', async () => {
  const superadmin = await makeUser();
  await grant(superadmin.id, 'SUPERADMIN');
  const app = await buildApp(superadmin.id, superadmin.email);
  const email = `list-${uniq()}@x.io`;
  await prisma.invite.create({ data: { email, tokenHash: generateInviteToken().hash, invitedById: superadmin.id, expiresAt: new Date(Date.now() + 60_000) } });
  try {
    const res = await app.inject({ method: 'GET', url: '/invites' });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<Record<string, unknown>>;
    assert.ok(rows.some((r) => r.email === email));
    assert.ok(rows.every((r) => !('tokenHash' in r)));
  } finally {
    await app.close();
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.user.delete({ where: { id: superadmin.id } }).catch(() => undefined);
  }
});
