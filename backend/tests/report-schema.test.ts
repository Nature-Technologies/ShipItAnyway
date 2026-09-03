import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';

test('ReportConfig + ReportSend persist and relate', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({ data: { name: `report-schema-${suffix}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  try {
    const config = await prisma.reportConfig.create({
      data: {
        name: 'Nightly', projectId: project.id, environmentId: env.id,
        cron: '0 8 * * *', recipients: ['a@example.com'], checkIds: []
      }
    });
    assert.equal(config.enabled, true);
    assert.equal(config.lastSentAt, null);

    const send = await prisma.reportSend.create({
      data: {
        reportConfigId: config.id, status: 'SENT', trigger: 'SCHEDULED',
        windowStart: new Date(0), windowEnd: new Date(),
        recipients: ['a@example.com'], runCount: 3, passed: 2, failed: 1, passRate: 67
      }
    });
    const withSends = await prisma.reportConfig.findUniqueOrThrow({
      where: { id: config.id }, include: { sends: true }
    });
    assert.equal(withSends.sends.length, 1);
    assert.equal(withSends.sends[0].id, send.id);

    // cascade: deleting the environment removes the config
    await prisma.environment.delete({ where: { id: env.id } });
    assert.equal(await prisma.reportConfig.count({ where: { id: config.id } }), 0);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});
