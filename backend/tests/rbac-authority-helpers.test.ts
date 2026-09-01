import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import {
  isSuperadmin, requireSuperadmin, countSuperadmins, requireTeamsManage
} from '../src/utils/project-access';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `helper-${uniq()}@example.com`, passwordHash: 'x' } });

test('superadmin + teams_manage helpers key on group membership', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const ownerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'OWNER' } });   // has teams_manage
  const viewerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } }); // no teams_manage
  const admin = await makeUser();
  const delegate = await makeUser();
  const plain = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });
  await prisma.userGroup.create({ data: { userId: delegate.id, groupId: ownerGroup.id } });
  await prisma.userGroup.create({ data: { userId: plain.id, groupId: viewerGroup.id } });

  try {
    assert.equal(await isSuperadmin(admin.id), true);
    assert.equal(await isSuperadmin(delegate.id), false);
    await requireSuperadmin(admin.id); // resolves
    await assert.rejects(requireSuperadmin(delegate.id), (e: any) => e.statusCode === 403);
    assert.ok((await countSuperadmins()) >= 1);

    await requireTeamsManage(admin.id);    // superadmin passes
    await requireTeamsManage(delegate.id); // teams_manage holder passes
    await assert.rejects(requireTeamsManage(plain.id), (e: any) => e.statusCode === 403);
  } finally {
    for (const u of [admin, delegate, plain]) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    }
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
