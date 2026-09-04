import crypto from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import prisma from '../../src/prisma';
import { resolveApiToken, hashApiToken } from '../../src/utils/api-token';
import { runRoutes } from '../../src/routes/runs';
import { mcpRoutes } from '../../src/routes/mcp';
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

/** Create a user assigned to the named system group (no team needed — /me/capabilities reads UserGroups only).
 *  Returns app (mcpRoutes mounted), token, and a teardown for cleanup. */
export async function seedUserInGroup(groupName: 'VIEWER' | 'EDITOR' | 'OWNER' | 'SUPERADMIN'): Promise<{ app: FastifyInstance; token: string; teardown: () => Promise<void> }> {
  const user = await prisma.user.create({ data: { email: `${groupName.toLowerCase()}-${uniq()}@example.com`, passwordHash: 'x' } });
  const group = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
  const token = await tokenFor(user.id);
  const app = await buildTestApp(mcpRoutes);
  const teardown = async () => {
    await app.close();
    await prisma.apiToken.deleteMany({ where: { userId: user.id } });
    await prisma.userGroup.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  };
  return { app, token, teardown };
}

interface TriggerableFixture {
  app: FastifyInstance;
  projectId: string;
  testId: string;
  environmentId: string;
  editorToken: string;
  viewerToken: string;
  suiteId?: string;
  emptySuiteId?: string;
  teardown: () => Promise<void>;
}

/** Seed a project + environment + one Test with no data cases (→ exactly one run).
 *  Editor and viewer users are joinProject'd so requireScope works correctly.
 *  Optional: withSuite creates a Suite with the test; withEmptySuite creates a Suite with no tests. */
export async function seedTriggerableTest(opts?: { withSuite?: boolean; withEmptySuite?: boolean }): Promise<TriggerableFixture> {
  const project = await prisma.project.create({ data: { name: `mcp-trigger-${uniq()}` } });
  const test = await prisma.test.create({
    data: { name: `t-${uniq()}`, projectId: project.id, steps: [], testData: [], url: 'https://example.com' }
  });
  const env = await prisma.environment.create({ data: { name: `env-${uniq()}`, projectId: project.id } });

  const editor = await prisma.user.create({ data: { email: `editor-${uniq()}@example.com`, passwordHash: 'x' } });
  const viewer = await prisma.user.create({ data: { email: `viewer-${uniq()}@example.com`, passwordHash: 'x' } });

  // Assign group memberships (capability side) and put both on one shared team (membership side).
  // Calling joinProject twice for the same project would create two teams with the same name and hit a unique constraint.
  const editorGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } });
  const viewerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } });
  await prisma.userGroup.upsert({ where: { userId_groupId: { userId: editor.id, groupId: editorGroup.id } }, update: {}, create: { userId: editor.id, groupId: editorGroup.id } });
  await prisma.userGroup.upsert({ where: { userId_groupId: { userId: viewer.id, groupId: viewerGroup.id } }, update: {}, create: { userId: viewer.id, groupId: viewerGroup.id } });
  await prisma.team.create({
    data: { name: `test-harness-${project.id}`, projects: { create: { projectId: project.id } }, members: { create: [{ userId: editor.id }, { userId: viewer.id }] } }
  });

  const editorToken = await tokenFor(editor.id);
  const viewerToken = await tokenFor(viewer.id);

  let suiteId: string | undefined;
  let emptySuiteId: string | undefined;

  if (opts?.withSuite) {
    const suite = await prisma.suite.create({ data: { name: `suite-${uniq()}`, projectId: project.id, testIds: [test.id] } });
    suiteId = suite.id;
  }
  if (opts?.withEmptySuite) {
    const emptySuite = await prisma.suite.create({ data: { name: `empty-suite-${uniq()}`, projectId: project.id, testIds: [] } });
    emptySuiteId = emptySuite.id;
  }

  const app = await buildTestApp(mcpRoutes);

  const teardown = async () => {
    await app.close();
    await prisma.testRun.deleteMany({ where: { testId: test.id } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: [editor.id, viewer.id] } } });
    await prisma.suite.deleteMany({ where: { projectId: project.id } });
    await prisma.team.deleteMany({ where: { projects: { some: { projectId: project.id } } } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.test.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [editor.id, viewer.id] } } });
  };

  return { app, projectId: project.id, testId: test.id, environmentId: env.id, editorToken, viewerToken, suiteId, emptySuiteId, teardown };
}
