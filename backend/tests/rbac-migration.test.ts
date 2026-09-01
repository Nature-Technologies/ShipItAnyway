import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { SYSTEM_GROUPS } from '../src/constants/rbac';

test('system groups are self-seeded with exact scope sets and flags', async () => {
  try {
    for (const spec of SYSTEM_GROUPS) {
      const group = await prisma.group.findUnique({
        where: { name: spec.name },
        include: { scopes: true }
      });
      assert.ok(group, `${spec.name} group missing`);
      assert.equal(group!.isSystem, true);
      assert.equal(group!.isGlobal, spec.isGlobal);
      assert.deepEqual(
        group!.scopes.map((s) => s.scope).sort(),
        [...spec.scopes].sort()
      );
    }
    const superadmin = SYSTEM_GROUPS.find((g) => g.name === 'SUPERADMIN')!;
    assert.equal(superadmin.isGlobal, true);
    assert.equal(superadmin.scopes.length, 15); // every Scope
  } finally {
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
