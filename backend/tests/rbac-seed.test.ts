import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { seedSystemGroups } from '../prisma/seed';

test('seedSystemGroups is idempotent and scope sets self-correct', async () => {
  try {
    await seedSystemGroups();
    // introduce drift, then re-seed
    const owner = await prisma.group.findUniqueOrThrow({ where: { name: 'OWNER' } });
    await prisma.groupScope.deleteMany({ where: { groupId: owner.id, scope: 'project_delete' } });
    await seedSystemGroups();
    const fixed = await prisma.groupScope.findFirst({
      where: { groupId: owner.id, scope: 'project_delete' }
    });
    assert.ok(fixed, 'authoritative re-seed restored the missing scope');

    const groups = await prisma.group.findMany({ where: { isSystem: true } });
    assert.equal(groups.length, 4);
  } finally {
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
