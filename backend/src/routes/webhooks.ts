import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { testQueue } from '../queue/queue';
import { DATA_DRIVEN_CASE_REQUIRED_ERROR, hasTestDataCases } from '../utils/test-data';

const WebhookPayloadSchema = z.object({
  testId: z.string().optional(),
  projectId: z.string().optional(),
  environmentId: z.string().optional()
});

function verifySignature(secret: string, body: string, signature: string) {
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal-length buffers; unequal length is already a mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post('/webhooks/trigger', async (req, reply) => {
    // Fail closed: this route is public (no JWT), so an unset/weak secret means anyone can enqueue
    // runs for any project. Refuse the request rather than treating "no secret" as "no auth".
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret || secret.length < 16 || secret === 'your-secret-here') {
      return reply.status(503).send({ error: 'Webhook trigger is not configured' });
    }

    const signatureHeader = req.headers['x-shipitanyway-secret'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

    if (!signature || !verifySignature(secret, rawBody, signature)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const result = WebhookPayloadSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { testId, projectId, environmentId } = result.data;
    const jobs: { testRunId: string; testId: string }[] = [];

    if (testId) {
      const test = await prisma.test.findUnique({ where: { id: testId } });
      if (!test) return reply.status(404).send({ error: 'Test not found' });

      if (hasTestDataCases(test.testData)) {
        const run = await prisma.testRun.create({
          data: {
            testId,
            status: 'FAILED',
            environmentId,
            finishedAt: new Date(),
            durationMs: 0,
            error: DATA_DRIVEN_CASE_REQUIRED_ERROR
          }
        });
        jobs.push({ testRunId: run.id, testId });
        return reply.status(202).send({ queued: jobs.length, jobs });
      }

      const run = await prisma.testRun.create({
        data: { testId, status: 'PENDING', environmentId }
      });
      await testQueue.add('run', { testRunId: run.id, testId, environmentId });
      jobs.push({ testRunId: run.id, testId });
    } else if (projectId) {
      const tests = await prisma.test.findMany({ where: { projectId } });
      if (tests.length === 0) {
        return reply.status(404).send({ error: 'No tests found for project' });
      }

      for (const test of tests) {
        if (hasTestDataCases(test.testData)) {
          const run = await prisma.testRun.create({
            data: {
              testId: test.id,
              status: 'FAILED',
              environmentId,
              finishedAt: new Date(),
              durationMs: 0,
              error: DATA_DRIVEN_CASE_REQUIRED_ERROR
            }
          });
          jobs.push({ testRunId: run.id, testId: test.id });
          continue;
        }

        const run = await prisma.testRun.create({
          data: { testId: test.id, status: 'PENDING', environmentId }
        });
        await testQueue.add('run', {
          testRunId: run.id,
          testId: test.id,
          environmentId
        });
        jobs.push({ testRunId: run.id, testId: test.id });
      }
    } else {
      return reply.status(400).send({ error: 'testId or projectId required' });
    }

    return reply.status(202).send({ queued: jobs.length, jobs });
  });
}
