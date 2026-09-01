import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireScope } from '../utils/project-access';
import { reportScheduler } from '../services/report-scheduler';
import { runReport } from '../services/report-runner';

const CreateSchema = z.object({
  name: z.string().min(1),
  environmentId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1).optional(),
  recipients: z.array(z.string().email()).default([]),
  checkIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true)
});

const UpdateSchema = CreateSchema.partial();

async function validateReportEnvironment(projectId: string, environmentId: string) {
  const environment = await prisma.environment.findUnique({ where: { id: environmentId } });
  if (!environment || environment.projectId !== projectId) {
    throw new Error('Environment not found');
  }
}

export async function reportRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/reports', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireScope(req.params.projectId, userId, 'reports_read');
      return await prisma.reportConfig.findMany({
        where: { projectId: req.params.projectId }, orderBy: { createdAt: 'asc' }
      });
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/reports', async (req, reply) => {
    const result = CreateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const { userId } = getAuthUser(req);
    try {
      await requireScope(req.params.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      await validateReportEnvironment(req.params.projectId, result.data.environmentId);
    } catch {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    const config = await prisma.reportConfig.create({
      data: { ...result.data, projectId: req.params.projectId }
    });
    await reportScheduler.register(config);
    return reply.status(201).send(config);
  });

  fastify.patch<{ Params: { id: string } }>('/reports/:id', async (req, reply) => {
    const result = UpdateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) return reply.status(404).send({ error: 'Report not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    if (result.data.environmentId) {
      try {
        await validateReportEnvironment(existing.projectId, result.data.environmentId);
      } catch {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }

    const config = await prisma.reportConfig.update({ where: { id: req.params.id }, data: result.data });
    await reportScheduler.register(config); // register() unregisters when enabled === false
    return config;
  });

  fastify.delete<{ Params: { id: string } }>('/reports/:id', async (req, reply) => {
    try {
      const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      const { userId } = getAuthUser(req);
      await requireScope(existing.projectId, userId, 'reports_edit');
      await reportScheduler.unregister(req.params.id);
      await prisma.reportConfig.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Not found' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/reports/:id/send-now', async (req, reply) => {
    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const { userId } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    const send = await runReport(req.params.id, { trigger: 'MANUAL' });
    return reply.send(send);
  });

  fastify.post<{ Params: { id: string } }>('/reports/:id/preview', async (req, reply) => {
    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const { userId, email } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    await runReport(req.params.id, { trigger: 'MANUAL', overrideRecipients: [email], forceSend: true });
    return reply.send({ ok: true, previewedTo: email });
  });

  fastify.get<{ Params: { id: string } }>('/reports/:id/sends', async (req, reply) => {
    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const { userId } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_read');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    return prisma.reportSend.findMany({
      where: { reportConfigId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 50
    });
  });
}
