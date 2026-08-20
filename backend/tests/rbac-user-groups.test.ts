import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { userRoutes } from '../src/routes/users';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `ug-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(userRoutes);
  return app;
}

test('superadmin sets user groups; floor blocks removing the last superadmin', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const editorGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } });
  const admin = await makeUser();
  const target = await makeUser();
  const outsider = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });

  // Isolate the floor test: a seeded admin also holds SUPERADMIN, so temporarily detach every
  // other superadmin's isGlobal grant to make `admin` genuinely the last one; restored in finally.
  const otherSuper = await prisma.userGroup.findMany({
    where: { group: { isGlobal: true }, userId: { not: admin.id } }
  });
  await prisma.userGroup.deleteMany({
    where: { group: { isGlobal: true }, userId: { not: admin.id } }
  });

  const adminApp = await buildApp(admin.id, admin.email);
  const outsiderApp = await buildApp(outsider.id, outsider.email);
  try {
    // non-superadmin 403 even on GET
    assert.equal((await outsiderApp.inject({ method: 'GET', url: '/users' })).statusCode, 403);
    assert.equal((await outsiderApp.inject({
      method: 'PUT', url: `/users/${target.id}/groups`, payload: { groupIds: [editorGroup.id] }
    })).statusCode, 403);

    // assign a group (replace-semantics)
    const putRes = await adminApp.inject({
      method: 'PUT', url: `/users/${target.id}/groups`, payload: { groupIds: [editorGroup.id] }
    });
    assert.equal(putRes.statusCode, 200);
    assert.deepEqual(putRes.json().map((g: { name: string }) => g.name), ['EDITOR']);

    // unknown id → 400
    assert.equal((await adminApp.inject({
      method: 'PUT', url: `/users/${target.id}/groups`, payload: { groupIds: ['does-not-exist'] }
    })).statusCode, 400);

    // floor: admin is the only superadmin → cannot drop their SUPERADMIN group
    const floorRes = await adminApp.inject({
      method: 'PUT', url: `/users/${admin.id}/groups`, payload: { groupIds: [editorGroup.id] }
    });
    assert.equal(floorRes.statusCode, 409);
    assert.equal(await prisma.userGroup.count({ where: { userId: admin.id, groupId: superGroup.id } }), 1);
  } finally {
    await adminApp.close(); await outsiderApp.close();
    if (otherSuper.length) {
      await prisma.userGroup.createMany({ data: otherSuper.map((r) => ({ userId: r.userId, groupId: r.groupId })), skipDuplicates: true });
    }
    for (const u of [admin, target, outsider]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
