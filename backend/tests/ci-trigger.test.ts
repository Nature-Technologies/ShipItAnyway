import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { ciRoutes } from '../src/routes/ci';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () => prisma.user.create({ data: { email: `ci-${uniq()}@example.com`, passwordHash: 'x' } });

async function grantTriggerOnProject(userId: string, projectId: string) {
  const group = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } }); // EDITOR bundles runs_trigger
  await prisma.userGroup.create({ data: { userId, groupId: group.id } });
  await prisma.team.create({
    data: { name: `ci-team-${uniq()}`, members: { create: { userId } }, projects: { create: { projectId } } }
  });
}
async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(ciRoutes);
  return app;
}

test('POST /ci/trigger creates CI runs + a PENDING delivery, returns 202', async () => {
  const user = await makeUser();
  const project = await prisma.project.create({ data: { name: `ci-${uniq()}`, ghRepo: 'o/r', ghPat: 'ghp_x' } });
  const t = await prisma.test.create({ data: { name: 't', projectId: project.id, steps: [], testData: [], url: 'https://example.com' } });
  const suite = await prisma.suite.create({ data: { name: 'E2E', projectId: project.id, testIds: [t.id] } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  await grantTriggerOnProject(user.id, project.id);
  const app = await buildApp(user.id, user.email);
  const correlationId = `corr-${uniq()}`;
  try {
    const res = await app.inject({
      method: 'POST', url: '/ci/trigger',
      payload: { suiteId: suite.id, environmentId: env.id, ci: { repo: 'o/r', sha: 'abc', prNumber: 3, correlationId } }
    });
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().correlationId, correlationId);
    assert.equal(res.json().runIds.length, 1);
    const delivery = await prisma.ciDelivery.findUnique({ where: { correlationId } });
    assert.equal(delivery!.state, 'PENDING');
    assert.equal(delivery!.context, 'shipitanyway/e2e');
    const runs = await prisma.testRun.findMany({ where: { ciCorrelationId: correlationId } });
    assert.equal(runs[0].trigger, 'CI');
  } finally {
    await app.close();
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: correlationId } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId } });
    await prisma.team.deleteMany({ where: { projects: { some: { projectId: project.id } } } });
    await prisma.suite.deleteMany({ where: { projectId: project.id } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.test.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test('POST /ci/trigger returns 422 and creates no CiDelivery when suite has no tests', async () => {
  const user = await makeUser();
  const project = await prisma.project.create({ data: { name: `ci-${uniq()}`, ghRepo: 'o/r', ghPat: 'ghp_x' } });
  const suite = await prisma.suite.create({ data: { name: 'Empty', projectId: project.id, testIds: [] } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  await grantTriggerOnProject(user.id, project.id);
  const app = await buildApp(user.id, user.email);
  const correlationId = `corr-empty-${uniq()}`;
  try {
    const res = await app.inject({
      method: 'POST', url: '/ci/trigger',
      payload: { suiteId: suite.id, environmentId: env.id, ci: { repo: 'o/r', sha: 'abc', correlationId } }
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.json().error, /no checks/i);
    const delivery = await prisma.ciDelivery.findUnique({ where: { correlationId } });
    assert.equal(delivery, null);
  } finally {
    await app.close();
    await prisma.ciDelivery.deleteMany({ where: { correlationId } });
    await prisma.team.deleteMany({ where: { projects: { some: { projectId: project.id } } } });
    await prisma.suite.deleteMany({ where: { projectId: project.id } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test('POST /ci/trigger with duplicate correlationId returns 202 with runIds:[] and single CiDelivery', async () => {
  const user = await makeUser();
  const project = await prisma.project.create({ data: { name: `ci-${uniq()}`, ghRepo: 'o/r', ghPat: 'ghp_x' } });
  const t = await prisma.test.create({ data: { name: 't', projectId: project.id, steps: [], testData: [], url: 'https://example.com' } });
  const suite = await prisma.suite.create({ data: { name: 'E2E', projectId: project.id, testIds: [t.id] } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  await grantTriggerOnProject(user.id, project.id);
  const app = await buildApp(user.id, user.email);
  const correlationId = `corr-dup-${uniq()}`;
  const payload = { suiteId: suite.id, environmentId: env.id, ci: { repo: 'o/r', sha: 'abc', correlationId } };
  try {
    const first = await app.inject({ method: 'POST', url: '/ci/trigger', payload });
    assert.equal(first.statusCode, 202);
    assert.equal(first.json().runIds.length, 1);
    const second = await app.inject({ method: 'POST', url: '/ci/trigger', payload });
    assert.equal(second.statusCode, 202);
    assert.deepEqual(second.json().runIds, []);
    const deliveries = await prisma.ciDelivery.findMany({ where: { correlationId } });
    assert.equal(deliveries.length, 1);
  } finally {
    await app.close();
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: correlationId } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId } });
    await prisma.team.deleteMany({ where: { projects: { some: { projectId: project.id } } } });
    await prisma.suite.deleteMany({ where: { projectId: project.id } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.test.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test('POST /ci/trigger is 403 without runs_trigger on the project', async () => {
  const user = await makeUser();
  const project = await prisma.project.create({ data: { name: `ci-${uniq()}` } });
  const suite = await prisma.suite.create({ data: { name: 's', projectId: project.id, testIds: [] } });
  const env = await prisma.environment.create({ data: { name: 'e', projectId: project.id } });
  const app = await buildApp(user.id, user.email);
  try {
    const res = await app.inject({ method: 'POST', url: '/ci/trigger', payload: { suiteId: suite.id, environmentId: env.id, ci: { repo: 'o/r', sha: 'abc', correlationId: `c-${uniq()}` } } });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
    await prisma.suite.deleteMany({ where: { projectId: project.id } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
