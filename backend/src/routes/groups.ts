import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Scope } from '@prisma/client';
import prisma from '../prisma';
import { fromApiScope, toApiScope } from '../constants/rbac';
import { getAuthUser, getProjectAccessStatusCode, requireSuperadmin } from '../utils/project-access';

// Accept the API `resource:action` form and convert to the Prisma enum; reject unknown scopes.
const apiScope = z.string().transform((s, ctx): Scope => {
  const v = fromApiScope(s);
  if (!v) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown scope: ${s}` }); return z.NEVER; }
  return v;
});

const GroupCreateSchema = z.object({
  name: z.string().trim().min(1),
  scopes: z.array(apiScope).default([])
});
const GroupUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  scopes: z.array(apiScope).optional()
}).refine((v) => v.name !== undefined || v.scopes !== undefined, 'Nothing to update');

async function ensureSuperadmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireSuperadmin(getAuthUser(req).userId);
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: 'Forbidden' });
    return false;
  }
}

const serialize = (g: { id: string; name: string; isSystem: boolean; isGlobal: boolean; scopes: { scope: Scope }[] }) =>
  ({ id: g.id, name: g.name, isSystem: g.isSystem, isGlobal: g.isGlobal, scopes: g.scopes.map((s) => toApiScope(s.scope)) });

export async function groupRoutes(fastify: FastifyInstance) {
  fastify.get('/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const groups = await prisma.group.findMany({ include: { scopes: true }, orderBy: { name: 'asc' } });
    return groups.map(serialize);
  });

  fastify.post('/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const result = GroupCreateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    try {
      const group = await prisma.group.create({
        data: {
          name: result.data.name,
          isSystem: false,
          isGlobal: false,
          scopes: { create: [...new Set(result.data.scopes)].map((scope) => ({ scope })) }
        },
        include: { scopes: true }
      });
      return reply.status(201).send(serialize(group));
    } catch {
      return reply.status(409).send({ error: 'A group with that name already exists' });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const result = GroupUpdateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    if (group.isSystem) return reply.status(409).send({ error: 'System groups cannot be edited' });

    const updated = await prisma.$transaction(async (tx) => {
      if (result.data.name !== undefined) {
        await tx.group.update({ where: { id: group.id }, data: { name: result.data.name } });
      }
      if (result.data.scopes !== undefined) {
        await tx.groupScope.deleteMany({ where: { groupId: group.id } });
        await tx.groupScope.createMany({
          data: [...new Set(result.data.scopes)].map((scope) => ({ groupId: group.id, scope }))
        });
      }
      return tx.group.findUniqueOrThrow({ where: { id: group.id }, include: { scopes: true } });
    }).catch(() => null);

    if (!updated) return reply.status(409).send({ error: 'A group with that name already exists' });
    return serialize(updated);
  });

  fastify.delete<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    if (group.isSystem) return reply.status(409).send({ error: 'System groups cannot be deleted' });
    await prisma.group.delete({ where: { id: group.id } }); // cascade removes GroupScope + UserGroup
    return reply.status(204).send();
  });
}
