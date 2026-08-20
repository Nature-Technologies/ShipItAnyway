import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { groupRoutes } from '../src/routes/groups';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `grp-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(groupRoutes);
  return app;
}

test('superadmin CRUDs custom groups; non-superadmin 403; system groups immutable', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const admin = await makeUser();
  const outsider = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });

  const adminApp = await buildApp(admin.id, admin.email);
  const outsiderApp = await buildApp(outsider.id, outsider.email);
  let createdId: string | undefined;
  try {
    // non-superadmin blocked on every verb
    assert.equal((await outsiderApp.inject({ method: 'GET', url: '/groups' })).statusCode, 403);
    assert.equal((await outsiderApp.inject({
      method: 'POST', url: '/groups', payload: { name: `c-${uniq()}`, scopes: ['runs_read'] }
    })).statusCode, 403);

    // create
    const createRes = await adminApp.inject({
      method: 'POST', url: '/groups', payload: { name: `custom-${uniq()}`, scopes: ['runs_read', 'checks_read'] }
    });
    assert.equal(createRes.statusCode, 201);
    createdId = createRes.json().id;
    assert.equal(createRes.json().isSystem, false);
    assert.equal(createRes.json().isGlobal, false);
    assert.deepEqual([...createRes.json().scopes].sort(), ['checks_read', 'runs_read']);

    // edit replaces scope set
    const patchRes = await adminApp.inject({
      method: 'PATCH', url: `/groups/${createdId}`, payload: { scopes: ['runs_read'] }
    });
    assert.equal(patchRes.statusCode, 200);
    assert.deepEqual(patchRes.json().scopes, ['runs_read']);

    // system group rejects edit + delete
    assert.equal((await adminApp.inject({
      method: 'PATCH', url: `/groups/${superGroup.id}`, payload: { name: 'nope' }
    })).statusCode, 409);
    assert.equal((await adminApp.inject({
      method: 'DELETE', url: `/groups/${superGroup.id}`
    })).statusCode, 409);

    // delete custom group + cascade
    assert.equal((await adminApp.inject({ method: 'DELETE', url: `/groups/${createdId}` })).statusCode, 204);
    assert.equal(await prisma.group.findUnique({ where: { id: createdId } }), null);
    createdId = undefined;
  } finally {
    await adminApp.close(); await outsiderApp.close();
    if (createdId) await prisma.group.delete({ where: { id: createdId } }).catch(() => undefined);
    for (const u of [admin, outsider]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
