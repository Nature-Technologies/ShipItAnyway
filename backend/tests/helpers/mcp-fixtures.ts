import crypto from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import prisma from '../../src/prisma';
import { resolveApiToken, hashApiToken } from '../../src/utils/api-token';
import { runRoutes } from '../../src/routes/runs';
import { joinProject } from './rbac';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Build a Fastify app with real api-token auth wired in, then register the given route plugin. */
export async function buildTestApp(register: (app: FastifyInstance) => Promise<void>): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('preHandler', async (req, reply) => {
    const viaToken = await resolveApiToken(req.headers.authorization);
    if (viaToken) { req.user = viaToken; return; }
    return reply.status(401).send({ error: 'Unauthorized' });
  });
  await register(app);
  return app;
}

/** Mint a real sia_ token for the given userId. Returns the raw token string. */
export async function tokenFor(userId: string): Promise<string> {
  const raw = 'sia_' + crypto.randomBytes(20).toString('hex');
  await prisma.apiToken.create({
    data: { name: 'test', tokenHash: hashApiToken(raw), prefix: raw.slice(0, 12), userId }
  });
  return raw;
}

interface SeedOpts {
  runCount: number;
  statuses?: string[];
}

interface SeededFixture {
  app: FastifyInstance;
  projectId: string;
  viewerToken: string;
  outsiderToken: string;
  teardown: () => Promise<void>;
}

/** Seed a project with N TestRun rows directly via Prisma (no BullMQ jobs).
 *  Returns app (runRoutes mounted), projectId, viewerToken, outsiderToken, teardown().
 *  Caller must await teardown() in finally. */
export async function seedProjectWithRuns(opts: SeedOpts): Promise<SeededFixture> {
  const { runCount, statuses } = opts;

  const project = await prisma.project.create({ data: { name: `mcp-${uniq()}` } });
  const testRow = await prisma.test.create({
    data: { name: `t-${uniq()}`, projectId: project.id, steps: [], testData: [], url: 'https://example.com' }
  });
  await prisma.environment.create({ data: { name: `env-${uniq()}`, projectId: project.id } });

  // Seed TestRun rows with distinct startedAt for deterministic ordering (newest = index 0)
  for (let i = 0; i < runCount; i++) {
    const status = (statuses?.[i] ?? 'PASSED') as 'PASSED' | 'FAILED' | 'PENDING' | 'RUNNING' | 'ERROR' | 'CANCELLED';
    await prisma.testRun.create({
      data: {
        testId: testRow.id,
        status,
        trigger: 'MANUAL',
        startedAt: new Date(Date.now() - i * 1000)
      }
    });
  }

  const viewer = await prisma.user.create({ data: { email: `viewer-${uniq()}@example.com`, passwordHash: 'x' } });
  const outsider = await prisma.user.create({ data: { email: `outsider-${uniq()}@example.com`, passwordHash: 'x' } });

  await joinProject(project.id, viewer.id, 'VIEWER');
  // outsider has no project access — no joinProject call

  const viewerToken = await tokenFor(viewer.id);
  const outsiderToken = await tokenFor(outsider.id);

  const app = await buildTestApp(runRoutes);

  const teardown = async () => {
    await app.close();
    await prisma.testRun.deleteMany({ where: { testId: testRow.id } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: [viewer.id, outsider.id] } } });
    await prisma.team.deleteMany({ where: { projects: { some: { projectId: project.id } } } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.test.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, outsider.id] } } });
  };

  return { app, projectId: project.id, viewerToken, outsiderToken, teardown };
}
