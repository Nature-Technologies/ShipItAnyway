import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { ciRoutes } from '../src/routes/ci';
import { ciDeliveryQueue } from '../src/queue/ci-delivery-queue';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () => prisma.user.create({ data: { email: `rs-${uniq()}@example.com`, passwordHash: 'x' } });
async function grantSuper(userId: string) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  await prisma.userGroup.create({ data: { userId, groupId: g.id } });
}
async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(ciRoutes);
  return app;
}

test('superadmin resends a FAILED delivery (202); non-superadmin 403', async () => {
  const admin = await makeUser(); await grantSuper(admin.id);
  const plain = await makeUser();
  const c = `corr-${uniq()}`;
  const project = await prisma.project.create({ data: { name: `rs-${uniq()}` } });
  const delivery = await prisma.ciDelivery.create({ data: { correlationId: c, projectId: project.id, repo: 'o/r', sha: 's', context: 'shipitanyway/s', state: 'FAILED', lastError: 'boom' } });
  const adminApp = await buildApp(admin.id, admin.email);
  const plainApp = await buildApp(plain.id, plain.email);
  try {
    assert.equal((await plainApp.inject({ method: 'POST', url: `/ci/deliveries/${delivery.id}/resend` })).statusCode, 403);
    const res = await adminApp.inject({ method: 'POST', url: `/ci/deliveries/${delivery.id}/resend` });
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().correlationId, c);
    const counts = await ciDeliveryQueue.getJobCounts();
    assert.ok(counts.waiting + counts.delayed >= 1);
  } finally {
    await ciDeliveryQueue.drain(true);
    await adminApp.close(); await plainApp.close();
    await prisma.ciDelivery.deleteMany({ where: { correlationId: c } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, plain.id] } } }).catch(() => undefined);
    await ciDeliveryQueue.close();
  }
});
