import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireScope } from '../utils/project-access';
import { createRunsForSelection } from '../services/run-selection';
import { suiteContext } from '../services/github';
import { enqueueCiDelivery } from '../queue/ci-delivery-queue';

const TriggerSchema = z.object({
  suiteId: z.string().min(1),
  environmentId: z.string().min(1),
  ci: z.object({
    repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    sha: z.string().min(1),
    ref: z.string().optional(),
    prNumber: z.number().int().optional(),
    runUrl: z.string().url().optional(),
    correlationId: z.string().min(1)
  })
});

export async function ciRoutes(fastify: FastifyInstance) {
  fastify.post('/ci/trigger', async (req, reply) => {
    const body = TriggerSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const { suiteId, environmentId, ci } = body.data;

    const suite = await prisma.suite.findUnique({ where: { id: suiteId } });
    if (!suite) return reply.status(404).send({ error: 'Suite not found' });

    const env = await prisma.environment.findUnique({ where: { id: environmentId } });
    if (!env || env.projectId !== suite.projectId) {
      return reply.status(404).send({ error: 'Environment not found for suite project' });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireScope(suite.projectId, userId, 'runs_trigger');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const context = suiteContext(suite.name);
    await prisma.ciDelivery.create({
      data: { correlationId: ci.correlationId, projectId: suite.projectId, repo: ci.repo, sha: ci.sha, context, prNumber: ci.prNumber ?? null, targetUrl: ci.runUrl ?? null }
    });

    const { runIds } = await createRunsForSelection({
      suiteId, environmentId, trigger: 'CI', ci
    });

    await enqueueCiDelivery(ci.correlationId);

    return reply.status(202).send({ correlationId: ci.correlationId, runIds });
  });
}
