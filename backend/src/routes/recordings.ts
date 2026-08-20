import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { interpolate } from '../utils/interpolate';
import { getRecordingStatus, startRecording, stopRecording } from '../services/recorder';
import { getAuthUser, getProjectAccessStatusCode, requireScope } from '../utils/project-access';
import {
  startDrivenSession, performDrivenAction, observeDrivenSession, stopDrivenSession,
  getDrivenSession, DrivenActionError
} from '../services/driven-recorder';
import { StepSchema } from '../schemas/test.schema';

const StartSchema = z.object({
  projectId: z.string().min(1),
  url: z.string().min(1),
  environmentId: z.string().optional(),
  device: z.string().optional()
});

export async function recordingRoutes(fastify: FastifyInstance) {
  fastify.post('/recordings/start', async (req, reply) => {
    const result = StartSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);

    try {
      await requireScope(result.data.projectId, userId, 'checks:edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      let resolvedUrl = result.data.url;

      if (result.data.environmentId) {
        const environment = await prisma.environment.findUnique({
          where: { id: result.data.environmentId }
        });

        if (!environment || environment.projectId !== result.data.projectId) {
          return reply.status(404).send({ error: 'Environment not found' });
        }

        resolvedUrl = interpolate(result.data.url, (environment.variables ?? {}) as Record<string, string>);

        if (/\{\{\w+\}\}/.test(resolvedUrl)) {
          return reply.status(400).send({
            error: 'Unresolved variables remain in recording URL'
          });
        }
      } else if (/\{\{\w+\}\}/.test(result.data.url)) {
        return reply.status(400).send({
          error: 'Recording URL contains variables. Select an environment first.'
        });
      }

      const sessionId = await startRecording(resolvedUrl, result.data.device, result.data.projectId, userId);
      return reply.status(201).send({ sessionId, status: 'active' });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Failed to start recording'
      });
    }
  });

  fastify.post<{ Params: { id: string } }>('/recordings/:id/stop', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const status = getRecordingStatus(req.params.id);
    if (!status) return reply.status(404).send({ error: 'Session not found' });

    try {
      await requireScope(status.projectId, userId, 'checks:edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      const steps = await stopRecording(req.params.id);
      return { steps };
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Session not found'
      });
    }
  });

  fastify.get<{ Params: { id: string } }>('/recordings/:id', async (req, reply) => {
    const status = getRecordingStatus(req.params.id);
    if (!status) return reply.status(404).send({ error: 'Session not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireScope(status.projectId, userId, 'checks:edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    return status;
  });

  // Driven recording routes (agent/MCP-driven session with per-action view capture)
  fastify.post<{ Body: { projectId: string; url: string; device?: string } }>(
    '/recordings/driven/start', async (req, reply) => {
      const result = z.object({ projectId: z.string().min(1), url: z.string().min(1), device: z.string().optional() }).safeParse(req.body);
      if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
      const { projectId, url, device } = result.data;
      const { userId } = getAuthUser(req);
      try {
        await requireScope(projectId, userId, 'checks:edit');
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
      }
      return reply.code(201).send(await startDrivenSession({ projectId, url, device, userId }));
    });

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/recordings/driven/:id/action', async (req, reply) => {
      const session = getDrivenSession(req.params.id);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      const { userId } = getAuthUser(req);
      try {
        await requireScope(session.projectId, userId, 'checks:edit');
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
      }
      const parsed = StepSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        return await performDrivenAction(req.params.id, parsed.data);
      } catch (err) {
        if (err instanceof DrivenActionError) return reply.code(422).send({ error: (err as Error).message });
        throw err;
      }
    });

  fastify.get<{ Params: { id: string } }>(
    '/recordings/driven/:id/observe', async (req, reply) => {
      const session = getDrivenSession(req.params.id);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      const { userId } = getAuthUser(req);
      try {
        await requireScope(session.projectId, userId, 'checks:edit');
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
      }
      return observeDrivenSession(req.params.id);
    });

  fastify.post<{ Params: { id: string } }>(
    '/recordings/driven/:id/stop', async (req, reply) => {
      const session = getDrivenSession(req.params.id);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      const { userId } = getAuthUser(req);
      try {
        await requireScope(session.projectId, userId, 'checks:edit');
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
      }
      return stopDrivenSession(req.params.id);
    });
}
