import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import prisma from '../prisma';
import { getAuthUser, requireProjectRole } from '../utils/project-access';

const FIXTURES_DIR = path.resolve(process.env.FIXTURES_DIR || './fixtures');
export function resolveFixturePath(storedName: string): string {
  return path.join(FIXTURES_DIR, storedName);
}

export async function fixtureRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/fixtures', async (req, reply) => {
    const { userId } = getAuthUser(req);
    await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });
    await fs.mkdir(FIXTURES_DIR, { recursive: true });
    const storedName = `${randomUUID()}${path.extname(data.filename)}`;
    await pipeline(data.file, createWriteStream(resolveFixturePath(storedName)));
    if (data.file.truncated) {
      await fs.unlink(resolveFixturePath(storedName));
      return reply.code(413).send({ error: 'File too large' });
    }
    const { size } = await fs.stat(resolveFixturePath(storedName));
    const fixture = await prisma.fixture.create({
      data: { projectId: req.params.projectId, filename: data.filename, storedName, size }
    });
    return reply.code(201).send({ fixture });
  });

  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/fixtures', async (req) => {
    const { userId } = getAuthUser(req);
    await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    const fixtures = await prisma.fixture.findMany({
      where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' }
    });
    return { fixtures };
  });
}
