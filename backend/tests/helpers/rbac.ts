import prisma from '../../src/prisma';

// Grant a user effective access to a project via the scope-based RBAC model:
// assign them the named system group (capability) and put them on a team attached to the project
// (membership). Replaces the retired `ProjectMember.role` seeding in tests.
export async function joinProject(projectId: string, userId: string, groupName: 'OWNER' | 'EDITOR' | 'VIEWER' = 'OWNER') {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId: g.id } }, update: {}, create: { userId, groupId: g.id }
  });
  await prisma.team.create({
    data: { name: `test-harness-${projectId}`, projects: { create: { projectId } }, members: { create: { userId } } }
  });
}
