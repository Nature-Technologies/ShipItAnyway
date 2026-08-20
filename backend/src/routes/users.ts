import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import {
  countSuperadmins, getAuthUser, getProjectAccessStatusCode, isSuperadmin, requireSuperadmin
} from '../utils/project-access';

const SetGroupsSchema = z.object({ groupIds: z.array(z.string()).default([]) });

async function ensureSuperadmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireSuperadmin(getAuthUser(req).userId);
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: 'Forbidden' });
    return false;
  }
}

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get('/users', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    return prisma.user.findMany({ select: { id: true, email: true }, orderBy: { email: 'asc' } });
  });

  fastify.get<{ Params: { id: string } }>('/users/:id/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const rows = await prisma.userGroup.findMany({
      where: { userId: req.params.id },
      include: { group: { select: { id: true, name: true, isSystem: true, isGlobal: true } } },
      orderBy: { group: { name: 'asc' } }
    });
    return rows.map((r) => r.group);
  });

  fastify.put<{ Params: { id: string } }>('/users/:id/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const result = SetGroupsSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const groupIds = [...new Set(result.data.groupIds)];
    const groups = await prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, isGlobal: true } });
    if (groups.length !== groupIds.length) {
      return reply.status(400).send({ error: 'One or more group ids do not exist' });
    }

    // Superadmin floor: if the target is currently the last superadmin and the new set has no
    // isGlobal group, refuse.
    const wasSuper = await isSuperadmin(user.id);
    const willBeSuper = groups.some((g) => g.isGlobal);
    if (wasSuper && !willBeSuper && (await countSuperadmins()) <= 1) {
      return reply.status(409).send({ error: 'At least one superadmin must exist' });
    }

    await prisma.$transaction([
      prisma.userGroup.deleteMany({ where: { userId: user.id } }),
      prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId: user.id, groupId })) })
    ]);

    const rows = await prisma.userGroup.findMany({
      where: { userId: user.id },
      include: { group: { select: { id: true, name: true, isSystem: true, isGlobal: true } } },
      orderBy: { group: { name: 'asc' } }
    });
    return rows.map((r) => r.group);
  });
}
