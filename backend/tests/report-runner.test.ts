import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST; // jsonTransport
import prisma from '../src/prisma';
import { sendReport, runReport } from '../src/services/report-runner';

async function fixture() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({ data: { name: `runner-${suffix}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  const check = await prisma.test.create({
    data: { name: 'Login', url: 'https://x.test', projectId: project.id, environmentId: env.id, steps: [] }
  });
  const config = await prisma.reportConfig.create({
    data: { name: 'Nightly', projectId: project.id, environmentId: env.id, cron: '0 8 * * *', recipients: ['ops@example.com'], checkIds: [] }
  });
  return { project, env, check, config };
}

test('empty window → SKIPPED_EMPTY, lastSentAt unchanged', async () => {
  const { project, config } = await fixture();
  try {
    const send = await sendReport(config.id);
    assert.equal(send?.status, 'SKIPPED_EMPTY');
    const after = await prisma.reportConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.equal(after.lastSentAt, null);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('runs in window → SENT, lastSentAt advanced, counts recorded', async () => {
  const { project, env, check, config } = await fixture();
  try {
    await prisma.testRun.create({ data: { testId: check.id, environmentId: env.id, status: 'PASSED', durationMs: 100, finishedAt: new Date() } });
    await prisma.testRun.create({ data: { testId: check.id, environmentId: env.id, status: 'FAILED', error: 'boom', durationMs: 200, finishedAt: new Date() } });
    const send = await sendReport(config.id);
    assert.equal(send?.status, 'SENT');
    assert.equal(send?.runCount, 2);
    assert.equal(send?.passed, 1);
    assert.equal(send?.failed, 1);
    const after = await prisma.reportConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.notEqual(after.lastSentAt, null);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('preview forceSend on empty window sends but does not advance lastSentAt or log SKIPPED', async () => {
  const { project, config } = await fixture();
  try {
    const send = await runReport(config.id, { trigger: 'MANUAL', overrideRecipients: ['me@example.com'], forceSend: true });
    assert.equal(send, null); // preview is throwaway: no ReportSend row
    const after = await prisma.reportConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.equal(after.lastSentAt, null);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('checkIds filters the window to selected checks', async () => {
  const { project, env, config } = await fixture();
  try {
    const other = await prisma.test.create({ data: { name: 'Other', url: 'https://y.test', projectId: project.id, environmentId: env.id, steps: [] } });
    await prisma.testRun.create({ data: { testId: other.id, environmentId: env.id, status: 'PASSED', durationMs: 50, finishedAt: new Date() } });
    await prisma.reportConfig.update({ where: { id: config.id }, data: { checkIds: ['nonexistent-id'] } });
    const send = await sendReport(config.id);
    assert.equal(send?.status, 'SKIPPED_EMPTY'); // the only run belongs to a non-selected check
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});
