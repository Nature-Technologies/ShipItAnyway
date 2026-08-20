import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { getAccessibleProjectIds } from '../src/utils/project-access';

test('getAccessibleProjectIds returns projects where the member resolves a *:read scope', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: { email: `rbac-acc-${suffix}@example.com`, passwordHash: 'not-used' }
  });
  const project = await prisma.project.create({ data: { name: `rbac-acc-${suffix}` } });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, email: user.email, role: 'VIEWER', status: 'ACTIVE' }
  });
  try {
    const ids = await getAccessibleProjectIds(user.id);
    assert.deepEqual(ids, [project.id]); // VIEWER has runs:read etc. → included
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});
