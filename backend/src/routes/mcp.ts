import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { createRunsForSelection } from '../services/run-selection';
import {
  getAuthUser, getProjectAccessStatusCode, requireScope,
  resolveUserScopes, isSuperadmin
} from '../utils/project-access';
import { toApiScope } from '../constants/rbac';

const TriggerSchema = z.object({
  testId: z.string().min(1).optional(),
  suiteId: z.string().min(1).optional(),
  environmentId: z.string().min(1)
}).refine((v) => Boolean(v.testId) !== Boolean(v.suiteId), {
  message: 'Provide exactly one of testId or suiteId'
});

export async function mcpRoutes(fastify: FastifyInstance) {
  fastify.get('/me/capabilities', async (req) => {
    const { userId, email } = getAuthUser(req);
    const { membershipScopes, globalScopes } = await resolveUserScopes(userId);
    const scopes = [...new Set([...membershipScopes, ...globalScopes].map(toApiScope))].sort();
    return { userId, email, isSuperadmin: await isSuperadmin(userId), scopes };
  });

  fastify.post('/mcp/trigger', async (req, reply) => {
    const body = TriggerSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const { testId, suiteId, environmentId } = body.data;

    // Resolve the owning project + validate the target and environment.
    let projectId: string;
    if (testId) {
      const test = await prisma.test.findUnique({ where: { id: testId }, select: { projectId: true } });
      if (!test) return reply.status(404).send({ error: 'Test not found' });
      projectId = test.projectId;
    } else {
      const suite = await prisma.suite.findUnique({ where: { id: suiteId! }, select: { projectId: true } });
      if (!suite) return reply.status(404).send({ error: 'Suite not found' });
      projectId = suite.projectId;
    }

    const env = await prisma.environment.findUnique({ where: { id: environmentId }, select: { projectId: true } });
    if (!env || env.projectId !== projectId) {
      return reply.status(404).send({ error: 'Environment not found for target project' });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireScope(projectId, userId, 'runs_trigger');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const { runIds, batchIds } = await createRunsForSelection({ testId, suiteId, environmentId, trigger: 'MCP' });
    if (runIds.length === 0) return reply.status(422).send({ error: 'No checks to run' });
    return reply.status(202).send({ runIds, batchIds });
  });
}
