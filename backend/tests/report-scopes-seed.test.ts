import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { seedSystemGroups } from '../prisma/seed';

test('default groups include report scopes', async () => {
  try {
    await seedSystemGroups();
    const load = async (name: string) => {
      const g = await prisma.group.findUniqueOrThrow({ where: { name }, include: { scopes: true } });
      return new Set(g.scopes.map((s) => s.scope));
    };
    assert.ok((await load('VIEWER')).has('reports_read'));
    assert.ok(!(await load('VIEWER')).has('reports_edit'));
    assert.ok((await load('EDITOR')).has('reports_edit'));
    assert.ok((await load('OWNER')).has('reports_edit'));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
});
