import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma';
import { canCreateProject, isSuperadmin, isTeamsManager } from '../utils/project-access';
import { hashInviteToken } from '../utils/invite-token';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const UserLookupSchema = z.object({
  email: z.string().trim().toLowerCase().email()
});

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8) // same rule as ChangePasswordSchema
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '5 minutes'
      }
    }
  }, async (req, reply) => {
    const result = LoginSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid credentials' });
    }

    const user = await prisma.user.findUnique({
      where: { email: result.data.email }
    });

    const passwordHash = user?.passwordHash ?? '$2b$12$invalidhashfortiming';
    const valid = await bcrypt.compare(result.data.password, passwordHash);

    if (!user || !valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign(
      { userId: user.id, email: user.email },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' }
    );

    return {
      token,
      email: user.email,
      canCreateProject: await canCreateProject(user.id, user.email),
      isSuperadmin: await isSuperadmin(user.id),
      canManageTeams: await isTeamsManager(user.id)
    };
  });

  fastify.post('/auth/logout', async () => ({ ok: true }));

  fastify.get('/auth/invite', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } }
  }, async (req, reply) => {
    const token = (req.query as { token?: string }).token;
    if (!token) return reply.status(400).send({ error: 'Invalid or expired invite' });
    const invite = await prisma.invite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      if (invite?.status === 'PENDING' && invite.expiresAt < new Date()) {
        await prisma.invite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
      }
      return reply.status(400).send({ error: 'Invalid or expired invite' }); // generic — no enumeration
    }
    return { email: invite.email };
  });

  fastify.post('/auth/accept-invite', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }
  }, async (req, reply) => {
    const parsed = AcceptInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid or expired invite' });

    const tokenHash = hashInviteToken(parsed.data.token);
    const user = await prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { tokenHash } });
      if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) return null;

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const u = await tx.user.upsert({
        where: { email: invite.email },
        update: { passwordHash, passwordChangedAt: new Date() },
        create: { email: invite.email, passwordHash }
      });

      // Capability is superadmin-granted. If the invite carried no group, the user joins with
      // no scopes and waits for a superadmin to assign a group in the Access console.
      if (invite.groupId) {
        await tx.userGroup.upsert({
          where: { userId_groupId: { userId: u.id, groupId: invite.groupId } }, update: {},
          create: { userId: u.id, groupId: invite.groupId }
        });
      }
      if (invite.teamId) {
        await tx.teamMember.upsert({
          where: { teamId_userId: { teamId: invite.teamId, userId: u.id } }, update: {},
          create: { teamId: invite.teamId, userId: u.id }
        });
      }
      await tx.invite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      return u;
    });

    if (!user) return reply.status(400).send({ error: 'Invalid or expired invite' });
    return { ok: true };
  });

  fastify.get('/auth/me', async (req) => {
    const payload = req.user as { userId: string; email: string };
    return {
      userId: payload.userId,
      email: payload.email,
      canCreateProject: await canCreateProject(payload.userId, payload.email),
      isSuperadmin: await isSuperadmin(payload.userId),
      canManageTeams: await isTeamsManager(payload.userId)
    };
  });

  fastify.post('/auth/change-password', async (req, reply) => {
    const result = ChangePasswordSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const payload = req.user as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(result.data.currentPassword, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(result.data.newPassword, 12), passwordChangedAt: new Date() }
    });

    return { ok: true };
  });

  fastify.get('/users/exists', {
    // Throttle to blunt authenticated email-directory enumeration.
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } }
  }, async (req, reply) => {
    const result = UserLookupSchema.safeParse(req.query);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const user = await prisma.user.findUnique({
      where: { email: result.data.email },
      select: { id: true }
    });

    return { exists: Boolean(user) };
  });
}
