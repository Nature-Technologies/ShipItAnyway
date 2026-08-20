import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { requireScope, getAccessibleProjectIds, getProjectAccessStatusCode } from '../src/utils/project-access';

async function grant(userId: string, groupName: string) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.create({ data: { userId, groupId: g.id } });
}
async function team(projectId: string, userIds: string[]) {
  const t = await prisma.team.create({ data: { name: 'T', projects: { create: { projectId } } } });
  for (const userId of userIds) await prisma.teamMember.create({ data: { teamId: t.id, userId } });
  return t;
}

test('requireScope enforces membership × capability, superadmin bypass, no-team 403', async () => {
  const [projA, projB, projC] = await Promise.all(
    ['A', 'B', 'C'].map((n) => prisma.project.create({ data: { name: `rbac-${n}-${Date.now()}` } }))
  );
  const mk = (tag: string) => prisma.user.create({
    data: { email: `rbac-${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, passwordHash: 'x' }
  });
  const [viewer, editor, admin, noteam] = await Promise.all([mk('v'), mk('e'), mk('s'), mk('n')]);
  try {
    await grant(viewer.id, 'VIEWER'); await team(projA.id, [viewer.id]);
    await grant(editor.id, 'EDITOR'); await team(projA.id, [editor.id]); await team(projB.id, [editor.id]);
    await grant(admin.id, 'SUPERADMIN');                  // global, no team
    await grant(noteam.id, 'EDITOR');                     // capability but no team on projC

    // viewer: read on A yes, edit on A no, anything on B no (not a member)
    await assert.doesNotReject(requireScope(projA.id, viewer.id, 'runs_read'));
    await assert.rejects(requireScope(projA.id, viewer.id, 'checks_edit'), (e) => getProjectAccessStatusCode(e) === 403);
    await assert.rejects(requireScope(projB.id, viewer.id, 'runs_read'), (e) => getProjectAccessStatusCode(e) === 403);

    // editor: edit on A and B
    await assert.doesNotReject(requireScope(projB.id, editor.id, 'checks_edit'));

    // superadmin: passes on projC with NO team membership
    await assert.doesNotReject(requireScope(projC.id, admin.id, 'project_delete'));

    // capability without membership → 403 on projC
    await assert.rejects(requireScope(projC.id, noteam.id, 'checks_edit'), (e) => getProjectAccessStatusCode(e) === 403);

    // accessible ids: editor sees A+B; superadmin sees all
    assert.deepEqual((await getAccessibleProjectIds(editor.id)).sort(), [projA.id, projB.id].sort());
    assert.ok((await getAccessibleProjectIds(admin.id)).includes(projC.id));
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: [projA.id, projB.id, projC.id] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, editor.id, admin.id, noteam.id] } } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
