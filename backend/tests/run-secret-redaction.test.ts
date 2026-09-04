import { test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../src/prisma';
import { runRoutes } from '../src/routes/runs';
import { buildTestApp, tokenFor } from './helpers/mcp-fixtures';
import { joinProject } from './helpers/rbac';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// GET /runs/:id feeds both the web UI and external MCP agents. A runs:read caller
// must never receive the project's write-only GitHub PAT, and environment secret
// values must be masked unless the caller holds environments:reveal-secrets.
test('GET /runs/:id strips project.ghPat and masks env vars for a runs:read caller', async () => {
  const project = await prisma.project.create({
    data: { name: `redact-${uniq()}`, ghRepo: 'o/r', ghPat: 'github_pat_SECRET_should_not_leak' }
  });
  const env = await prisma.environment.create({
    data: { name: 'staging', projectId: project.id, variables: { API_KEY: 'super-secret-value' } }
  });
  const t = await prisma.test.create({
    data: { name: 't', projectId: project.id, steps: [], testData: [], url: 'https://example.com' }
  });
  const run = await prisma.testRun.create({
    data: { testId: t.id, status: 'PASSED', trigger: 'MCP', environmentId: env.id }
  });
  // VIEWER = runs:read but NOT environments:reveal-secrets
  const viewer = await prisma.user.create({ data: { email: `v-${uniq()}@example.com`, passwordHash: 'x' } });
  await joinProject(project.id, viewer.id, 'VIEWER');
  const token = await tokenFor(viewer.id);
  const app = await buildTestApp(runRoutes);

  try {
    const res = await app.inject({ method: 'GET', url: `/runs/${run.id}`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    // GitHub PAT must be absent
    assert.equal(body.test.project.ghPat, undefined, 'ghPat must not be exposed');
    // ghRepo (non-secret, needed for CI links) is retained
    assert.equal(body.test.project.ghRepo, 'o/r');
    // env secret values masked, keys preserved
    assert.equal(body.environment.variables.API_KEY, '••••••');
  } finally {
    await app.close();
    await prisma.testRun.deleteMany({ where: { testId: t.id } });
    await prisma.test.deleteMany({ where: { projectId: project.id } });
    await prisma.environment.deleteMany({ where: { projectId: project.id } });
    await prisma.team.deleteMany({ where: { projects: { some: { projectId: project.id } } } });
    await prisma.apiToken.deleteMany({ where: { userId: viewer.id } });
    await prisma.userGroup.deleteMany({ where: { userId: viewer.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: viewer.id } }).catch(() => undefined);
  }
});
