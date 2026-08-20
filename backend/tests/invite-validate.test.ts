import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { generateInviteToken } from '../src/utils/invite-token';
import { authRoutes } from '../src/routes/auth';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('GET /auth/invite returns only the email for a valid token, generic 400 otherwise', async () => {
  const inviter = await prisma.user.create({ data: { email: `inviter-${uniq()}@x.io`, passwordHash: 'x' } });
  const app = Fastify(); // no preHandler — route is public
  await app.register(authRoutes);
  const validEmail = `valid-${uniq()}@x.io`;
  const oldEmail = `old-${uniq()}@x.io`;
  const { raw, hash } = generateInviteToken();
  await prisma.invite.create({
    data: { email: validEmail, tokenHash: hash, invitedById: inviter.id, expiresAt: new Date(Date.now() + 60_000) }
  });
  const expiredTok = generateInviteToken();
  await prisma.invite.create({
    data: { email: oldEmail, tokenHash: expiredTok.hash, invitedById: inviter.id, expiresAt: new Date(Date.now() - 60_000) }
  });
  try {
    const ok = await app.inject({ method: 'GET', url: `/auth/invite?token=${raw}` });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { email: validEmail });

    const bad = await app.inject({ method: 'GET', url: '/auth/invite?token=nope' });
    assert.equal(bad.statusCode, 400);

    const expired = await app.inject({ method: 'GET', url: `/auth/invite?token=${expiredTok.raw}` });
    assert.equal(expired.statusCode, 400);
    const flipped = await prisma.invite.findFirst({ where: { email: oldEmail } });
    assert.equal(flipped!.status, 'EXPIRED'); // lazily marked
  } finally {
    await app.close();
    await prisma.invite.deleteMany({ where: { email: { in: [validEmail, oldEmail] } } });
    await prisma.user.delete({ where: { id: inviter.id } }).catch(() => undefined);
  }
});
