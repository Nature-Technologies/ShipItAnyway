import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { apiTokenRoutes } from '../src/routes/api-tokens';
import { hashApiToken } from '../src/utils/api-token';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () => prisma.user.create({ data: { email: `t-${uniq()}@example.com`, passwordHash: 'x' } });
async function grant(userId: string, groupName: string) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.create({ data: { userId, groupId: g.id } });
}
async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(apiTokenRoutes);
  return app;
}

test('superadmin creates a token: raw returned once, only hash stored', async () => {
  const admin = await makeUser();
  await grant(admin.id, 'SUPERADMIN');
  const svc = await makeUser();
  const app = await buildApp(admin.id, admin.email);
  try {
    const res = await app.inject({ method: 'POST', url: '/api-tokens', payload: { name: 'ci', userId: svc.id } });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.match(body.token, /^sia_[0-9a-f]{40}$/);
    const row = await prisma.apiToken.findUnique({ where: { id: body.id } });
    assert.equal(row!.tokenHash, hashApiToken(body.token));
    assert.equal(row!.prefix, body.token.slice(0, 12));
  } finally {
    await prisma.apiToken.deleteMany({ where: { userId: svc.id } });
    await app.close();
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, svc.id] } } }).catch(() => undefined);
  }
});

test('non-superadmin is 403; list never leaks tokenHash; delete revokes', async () => {
  const admin = await makeUser();
  await grant(admin.id, 'SUPERADMIN');
  const plain = await makeUser();
  const svc = await makeUser();
  const adminApp = await buildApp(admin.id, admin.email);
  const plainApp = await buildApp(plain.id, plain.email);
  try {
    assert.equal((await plainApp.inject({ method: 'POST', url: '/api-tokens', payload: { name: 'x', userId: svc.id } })).statusCode, 403);
    assert.equal((await plainApp.inject({ method: 'GET', url: '/api-tokens' })).statusCode, 403);
    assert.equal((await plainApp.inject({ method: 'DELETE', url: '/api-tokens/whatever' })).statusCode, 403);
    const created = (await adminApp.inject({ method: 'POST', url: '/api-tokens', payload: { name: 'ci', userId: svc.id } })).json();
    const list = (await adminApp.inject({ method: 'GET', url: '/api-tokens' })).json();
    const found = list.find((t: any) => t.id === created.id);
    assert.ok(found);
    assert.equal(found.tokenHash, undefined);
    assert.equal((await adminApp.inject({ method: 'DELETE', url: `/api-tokens/${created.id}` })).statusCode, 204);
    assert.ok((await prisma.apiToken.findUnique({ where: { id: created.id } }))!.revokedAt);
  } finally {
    await prisma.apiToken.deleteMany({ where: { userId: svc.id } });
    await adminApp.close(); await plainApp.close();
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, plain.id, svc.id] } } }).catch(() => undefined);
  }
});
