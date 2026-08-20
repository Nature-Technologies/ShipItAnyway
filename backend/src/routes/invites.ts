import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { generateInviteToken } from '../utils/invite-token';
import { sendInviteEmail } from '../services/mailer';
import { can, getAuthUser, isSuperadmin, requireSuperadmin } from '../utils/project-access';

const INVITE_TTL_MS = Number(process.env.INVITE_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000;
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

const CreateInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  groupId: z.string().optional(),
  teamId: z.string().optional()
});

// groupId (or neither) ⇒ superadmin; teamId-only ⇒ teams_manage on EVERY project the team is
// attached to (a team is the unit of membership, so inviting onto it grants access to all its
// projects — the delegate must manage all of them), else superadmin.
async function assertInviteAuthority(userId: string, groupId?: string, teamId?: string) {
  if (groupId || !teamId) { await requireSuperadmin(userId); return; }
  const links = await prisma.teamProject.findMany({ where: { teamId }, select: { projectId: true } });
  if (links.length > 0) {
    const authorized = await Promise.all(links.map(({ projectId }) => can(projectId, userId, 'teams_manage')));
    if (authorized.every(Boolean)) return;
  }
  await requireSuperadmin(userId); // throws 403 when the delegate lacks full authority
}

// teams whose attached projects the user has teams_manage on (for delegate invite listing)
async function manageableTeamIds(userId: string): Promise<string[]> {
  const links = await prisma.teamProject.findMany({ select: { teamId: true, projectId: true } });
  const ids = new Set<string>();
  for (const { teamId, projectId } of links) {
    if (await can(projectId, userId, 'teams_manage')) ids.add(teamId);
  }
  return [...ids];
}

export async function inviteRoutes(fastify: FastifyInstance) {
  fastify.post('/invites', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }
  }, async (req, reply) => {
    const { userId } = getAuthUser(req);
    const parsed = CreateInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid invite' });
    const { email, groupId, teamId } = parsed.data;
    try {
      await assertInviteAuthority(userId, groupId, teamId);
    } catch (error) {
      return reply.status(403).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    // ponytail: "usable" = non-empty hash; passwordless placeholder rows still accept an invite.
    if (existingUser?.passwordHash) {
      return reply.status(409).send({ error: 'A user with that email already exists' });
    }

    const { raw, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const pending = await prisma.invite.findFirst({ where: { email, status: 'PENDING' } });
    const invite = pending
      ? await prisma.invite.update({
          where: { id: pending.id },
          data: { tokenHash: hash, expiresAt, groupId: groupId ?? null, teamId: teamId ?? null, invitedById: userId }
        })
      : await prisma.invite.create({
          data: { email, tokenHash: hash, expiresAt, groupId: groupId ?? null, teamId: teamId ?? null, invitedById: userId }
        });

    await sendInviteEmail(email, `${APP_URL}/accept-invite?token=${raw}`);
    return reply.status(201).send({ id: invite.id, email: invite.email, status: invite.status });
  });

  fastify.delete<{ Params: { id: string } }>('/invites/:id', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const invite = await prisma.invite.findUnique({ where: { id: req.params.id } });
    if (!invite) return reply.status(404).send({ error: 'Not found' });
    if (invite.invitedById !== userId) {
      try {
        await requireSuperadmin(userId);
      } catch (error) {
        return reply.status(403).send({ error: error instanceof Error ? error.message : 'Forbidden' });
      }
    }
    await prisma.invite.update({ where: { id: invite.id }, data: { status: 'REVOKED' } });
    return { ok: true };
  });

  fastify.get('/invites', async (req) => {
    const { userId } = getAuthUser(req);
    const select = {
      id: true, email: true, status: true, groupId: true, teamId: true,
      invitedById: true, expiresAt: true, createdAt: true
    }; // no tokenHash
    if (await isSuperadmin(userId)) {
      return prisma.invite.findMany({ where: { status: 'PENDING' }, select });
    }
    const teamIds = await manageableTeamIds(userId);
    return prisma.invite.findMany({ where: { status: 'PENDING', teamId: { in: teamIds } }, select });
  });
}
