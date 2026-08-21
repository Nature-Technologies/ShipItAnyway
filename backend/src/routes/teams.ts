import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import {
  getAuthUser, getProjectAccessStatusCode, isSuperadmin, requireScope, requireTeamsManage
} from '../utils/project-access';

const TeamCreateSchema = z.object({ name: z.string().trim().min(1) });
const TeamUpdateSchema = z.object({ name: z.string().trim().min(1) });
const TeamMemberSchema = z.object({ userId: z.string().min(1) });
const TeamProjectSchema = z.object({ projectId: z.string().min(1) });

async function ensureTeamsManage(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireTeamsManage(getAuthUser(req).userId);
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: 'Forbidden' });
    return false;
  }
}

async function ensureProjectScope(projectId: string, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireScope(projectId, getAuthUser(req).userId, 'teams_manage');
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    return false;
  }
}

async function loadTeamOr404(id: string, reply: FastifyReply) {
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) { reply.status(404).send({ error: 'Team not found' }); return null; }
  return team;
}

export async function teamRoutes(fastify: FastifyInstance) {
  fastify.post('/teams', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const result = TeamCreateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    try {
      const team = await prisma.team.create({ data: { name: result.data.name } });
      return reply.status(201).send(team);
    } catch {
      return reply.status(409).send({ error: 'A team with that name already exists' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: {
        members: { include: { user: { select: { id: true, email: true } } } },
        projects: { include: { project: { select: { id: true, name: true } } } }
      }
    });
    if (!team) return reply.status(404).send({ error: 'Team not found' });
    return {
      id: team.id,
      name: team.name,
      members: team.members.map((m) => ({ userId: m.userId, email: m.user.email })),
      projects: team.projects.map((p) => ({ projectId: p.projectId, name: p.project.name }))
    };
  });

  fastify.get('/teams', async (req, reply) => {
    const { userId } = getAuthUser(req);
    // Superadmins and teams_manage holders manage all teams (capability is global); others see
    // only the teams they belong to.
    let canManageAll = await isSuperadmin(userId);
    if (!canManageAll) {
      canManageAll = await requireTeamsManage(userId).then(() => true).catch(() => false);
    }
    // ponytail: two-tier visibility (all vs member-of). Per-project narrowing deferred — a
    // teams_manage holder can already manage every team, so "all" is the correct set for them.
    const teams = await prisma.team.findMany({
      where: canManageAll ? undefined : { members: { some: { userId } } },
      include: { _count: { select: { members: true, projects: true } } },
      orderBy: { name: 'asc' }
    });
    return teams.map((t) => ({ id: t.id, name: t.name, memberCount: t._count.members, projectCount: t._count.projects }));
  });

  fastify.patch<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const result = TeamUpdateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    try {
      return await prisma.team.update({ where: { id: req.params.id }, data: { name: result.data.name } });
    } catch {
      return reply.status(409).send({ error: 'A team with that name already exists' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    await prisma.team.delete({ where: { id: req.params.id } }); // cascade removes TeamMember/TeamProject
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/teams/:id/members', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const result = TeamMemberSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    const user = await prisma.user.findUnique({ where: { id: result.data.userId }, select: { id: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    const membership = await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: req.params.id, userId: user.id } },
      update: {},
      create: { teamId: req.params.id, userId: user.id }
    });
    return reply.status(201).send(membership);
  });

  fastify.delete<{ Params: { id: string; userId: string } }>('/teams/:id/members/:userId', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: req.params.id, userId: req.params.userId } }
    }).catch(() => undefined);
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/teams/:id/projects', async (req, reply) => {
    const result = TeamProjectSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    if (!(await ensureProjectScope(result.data.projectId, req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    const attach = await prisma.teamProject.upsert({
      where: { teamId_projectId: { teamId: req.params.id, projectId: result.data.projectId } },
      update: {},
      create: { teamId: req.params.id, projectId: result.data.projectId }
    });
    return reply.status(201).send(attach);
  });

  fastify.delete<{ Params: { id: string; projectId: string } }>('/teams/:id/projects/:projectId', async (req, reply) => {
    if (!(await ensureProjectScope(req.params.projectId, req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    await prisma.teamProject.delete({
      where: { teamId_projectId: { teamId: req.params.id, projectId: req.params.projectId } }
    }).catch(() => undefined);
    return reply.status(204).send();
  });
}
