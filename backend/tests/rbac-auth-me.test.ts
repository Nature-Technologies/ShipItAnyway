import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { authRoutes } from '../src/routes/auth';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `authme-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(authRoutes);
  return app;
}

test('/auth/me reports isSystemAdmin from isGlobal group membership, not ADMIN_EMAIL', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const admin = await makeUser();
  const plain = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });

  const adminApp = await buildApp(admin.id, admin.email);
  const plainApp = await buildApp(plain.id, plain.email);
  try {
    const adminMe = await adminApp.inject({ method: 'GET', url: '/auth/me' });
    assert.equal(adminMe.statusCode, 200);
    assert.equal(adminMe.json().isSystemAdmin, true);

    const plainMe = await plainApp.inject({ method: 'GET', url: '/auth/me' });
    assert.equal(plainMe.json().isSystemAdmin, false);
  } finally {
    await adminApp.close(); await plainApp.close();
    for (const u of [admin, plain]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
