import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, redactEnvironmentVariables, requireScope } from '../utils/project-access';

const EnvironmentSchema = z.object({
  name: z.string().min(1).max(50),
  variables: z.record(z.string())
});

export async function environmentRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      const scopes = await requireScope(req.params.projectId, userId, 'environments_read');
      const viewerOnly = !scopes.has('environments_reveal_secrets');
      const environments = await prisma.environment.findMany({
        where: { projectId: req.params.projectId },
        orderBy: { createdAt: 'asc' }
      });
      return environments.map((environment) => ({
        ...environment,
        variables: redactEnvironmentVariables(environment.variables as Record<string, string>, viewerOnly)
      }));
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req, reply) => {
    const result = EnvironmentSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireScope(req.params.projectId, userId, 'environments_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const environment = await prisma.environment.create({
      data: { ...result.data, projectId: req.params.projectId }
    });
    return reply.status(201).send(environment);
  });

  fastify.patch<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    const result = EnvironmentSchema.partial().safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);
    const environment = await prisma.environment.findUnique({
      where: { id: req.params.id },
      select: { projectId: true }
    });
    if (!environment) return reply.status(404).send({ error: 'Environment not found' });

    try {
      await requireScope(environment.projectId, userId, 'environments_edit');
      return await prisma.environment.update({
        where: { id: req.params.id },
        data: result.data
      });
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    try {
      const { userId } = getAuthUser(req);
      const environment = await prisma.environment.findUnique({
        where: { id: req.params.id },
        select: { projectId: true }
      });
      if (!environment) return reply.status(404).send({ error: 'Environment not found' });
      await requireScope(environment.projectId, userId, 'environments_edit');
      await prisma.environment.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Environment not found' });
    }
  });
}
