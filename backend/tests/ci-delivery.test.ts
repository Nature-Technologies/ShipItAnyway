import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { computeCorrelationState, deliverCiStatus } from '../src/services/ci-delivery';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function seed(state: 'PASSED' | 'FAILED' | 'PENDING', correlationId: string) {
  const project = await prisma.project.create({ data: { name: `d-${uniq()}`, ghRepo: 'o/r', ghPat: 'ghp_x' } });
  const testRow = await prisma.test.create({ data: { name: 't', url: 'https://example.com', projectId: project.id, steps: [], testData: [] } });
  await prisma.testRun.create({ data: { testId: testRow.id, status: state, trigger: 'CI', ciRepo: 'o/r', ciSha: 'sha1', ciCorrelationId: correlationId } });
  await prisma.ciDelivery.create({ data: { correlationId, projectId: project.id, repo: 'o/r', sha: 'sha1', context: 'shipitanyway/s' } });
  return { project, testRow };
}

test('computeCorrelationState reflects sibling run statuses', async () => {
  const c = `corr-${uniq()}`;
  const { project, testRow } = await seed('PASSED', c);
  try {
    assert.equal(await computeCorrelationState(c), 'success');
    await prisma.testRun.updateMany({ where: { ciCorrelationId: c }, data: { status: 'FAILED' } });
    assert.equal(await computeCorrelationState(c), 'failure');
    await prisma.testRun.updateMany({ where: { ciCorrelationId: c }, data: { status: 'PENDING' } });
    assert.equal(await computeCorrelationState(c), 'pending');
  } finally {
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: c } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId: c } });
    await prisma.test.delete({ where: { id: testRow.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});

test('deliverCiStatus posts and marks DELIVERED on success', async () => {
  const c = `corr-${uniq()}`;
  const { project, testRow } = await seed('PASSED', c);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 201, text: async () => '' }) as any) as any;
  try {
    await deliverCiStatus(c);
    const d = await prisma.ciDelivery.findUnique({ where: { correlationId: c } });
    assert.equal(d!.state, 'DELIVERED');
    assert.equal(d!.attempts, 1);
  } finally {
    globalThis.fetch = orig;
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: c } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId: c } });
    await prisma.test.delete({ where: { id: testRow.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});

test('deliverCiStatus throws and records lastError on GitHub failure', async () => {
  const c = `corr-${uniq()}`;
  const { project, testRow } = await seed('PASSED', c);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 500, text: async () => 'boom' }) as any) as any;
  try {
    await assert.rejects(deliverCiStatus(c), /500/);
    const d = await prisma.ciDelivery.findUnique({ where: { correlationId: c } });
    assert.equal(d!.state, 'PENDING');
    assert.match(d!.lastError ?? '', /500/);
  } finally {
    globalThis.fetch = orig;
    await prisma.testRun.deleteMany({ where: { ciCorrelationId: c } });
    await prisma.ciDelivery.deleteMany({ where: { correlationId: c } });
    await prisma.test.delete({ where: { id: testRow.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
});
