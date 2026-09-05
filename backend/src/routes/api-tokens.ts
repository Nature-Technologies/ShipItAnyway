import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireSuperadmin } from '../utils/project-access';
import { hashApiToken } from '../utils/api-token';
import { Scope } from '@prisma/client';
import { ALL_API_SCOPES, fromApiScope, toApiScope } from '../constants/rbac';

const CreateSchema = z.object({
  name: z.string().min(1),
  userId: z.string().min(1),
  expiresAt: z.coerce.date().optional(),
  // API-scope strings (e.g. "runs:trigger"). Empty/omitted = unrestricted (full user authority).
  scopes: z.array(z.string()).optional()
});

export async function apiTokenRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireSuperadmin(userId);
    } catch (error) {
      return reply
        .status(getProjectAccessStatusCode(error))
        .send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.post('/api-tokens', async (req, reply) => {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const target = await prisma.user.findUnique({ where: { id: body.data.userId } });
    if (!target) return reply.status(404).send({ error: 'User not found' });

    // Convert API-scope strings to internal enum; reject any unknown scope.
    const scopes: Scope[] = [];
    for (const s of body.data.scopes ?? []) {
      const mapped = fromApiScope(s);
      if (!mapped) return reply.status(400).send({ error: `Unknown scope: ${s}` });
      scopes.push(mapped);
    }

    const raw = `sia_${crypto.randomBytes(20).toString('hex')}`;
    const token = await prisma.apiToken.create({
      data: {
        name: body.data.name,
        tokenHash: hashApiToken(raw),
        prefix: raw.slice(0, 12),
        userId: body.data.userId,
        scopes,
        expiresAt: body.data.expiresAt ?? null
      }
    });
    return reply.status(201).send({ id: token.id, token: raw });
  });

  // Scope catalog for the token-creation UI.
  fastify.get('/api-tokens/scopes', async () => ({ scopes: ALL_API_SCOPES }));

  fastify.get('/api-tokens', async () => {
    const tokens = await prisma.apiToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, prefix: true, scopes: true,
        lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true,
        user: { select: { email: true } }
      }
    });
    return tokens.map(({ user, scopes, ...rest }) => ({
      ...rest,
      userEmail: user.email,
      scopes: scopes.map(toApiScope) // [] = unrestricted
    }));
  });

  fastify.delete<{ Params: { id: string } }>('/api-tokens/:id', async (req, reply) => {
    await prisma.apiToken.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
    return reply.status(204).send();
  });
}
