import type { FastifyRequest } from 'fastify';
import { Scope, type ProjectMemberStatus, type ProjectRole } from '@prisma/client';
import prisma from '../prisma';
import { FALLBACK_ADMIN_EMAIL } from '../constants/admin';

export { Scope };

export type AuthUser = {
  userId: string;
  email: string;
};

export type ProjectAccessError = Error & { statusCode?: number };

export async function memberOf(userId: string, projectId: string): Promise<boolean> {
  const hit = await prisma.teamMember.findFirst({
    where: { userId, team: { projects: { some: { projectId } } } },
    select: { teamId: true }
  });
  return Boolean(hit);
}

export async function resolveUserScopes(userId: string): Promise<{ membershipScopes: Set<Scope>; globalScopes: Set<Scope> }> {
  const rows = await prisma.userGroup.findMany({
    where: { userId },
    select: { group: { select: { isGlobal: true, scopes: { select: { scope: true } } } } }
  });
  const membershipScopes = new Set<Scope>();
  const globalScopes = new Set<Scope>();
  for (const { group } of rows) {
    for (const { scope } of group.scopes) (group.isGlobal ? globalScopes : membershipScopes).add(scope);
  }
  return { membershipScopes, globalScopes };
}

// Effective scopes on a project = global group scopes ∪ (member of the project ? membership scopes : ∅).
export async function resolveScopes(userId: string, projectId: string): Promise<Set<Scope>> {
  const { membershipScopes, globalScopes } = await resolveUserScopes(userId);
  const effective = new Set<Scope>(globalScopes);
  // ponytail: one membership lookup; fold into resolveUserScopes if a hot route shows up.
  if (await memberOf(userId, projectId)) for (const s of membershipScopes) effective.add(s);
  return effective;
}

export async function can(projectId: string, userId: string, scope: Scope): Promise<boolean> {
  return (await resolveScopes(userId, projectId)).has(scope);
}

function forbidden(): ProjectAccessError {
  const error = new Error('Forbidden') as ProjectAccessError;
  error.statusCode = 403;
  return error;
}

export async function isSuperadmin(userId: string): Promise<boolean> {
  const count = await prisma.userGroup.count({
    where: { userId, group: { isGlobal: true } }
  });
  return count > 0;
}

export async function requireSuperadmin(userId: string): Promise<void> {
  if (!(await isSuperadmin(userId))) throw forbidden();
}

export async function countSuperadmins(): Promise<number> {
  const rows = await prisma.userGroup.findMany({
    where: { group: { isGlobal: true } },
    select: { userId: true },
    distinct: ['userId']
  });
  return rows.length;
}

export async function requireTeamsManage(userId: string): Promise<void> {
  const { membershipScopes, globalScopes } = await resolveUserScopes(userId);
  if (!membershipScopes.has('teams_manage') && !globalScopes.has('teams_manage')) {
    throw forbidden();
  }
}

// Returns the effective scope set on success (callers use it for secret masking); throws 404/403 otherwise.
export async function requireScope(projectId: string, userId: string, scope: Scope): Promise<Set<Scope>> {
  const scopes = await resolveScopes(userId, projectId);
  if (!scopes.has(scope)) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    const error = new Error(project ? 'Forbidden' : 'Project not found') as ProjectAccessError;
    error.statusCode = project ? 403 : 404;
    throw error;
  }
  return scopes;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getProtectedAdminEmails() {
  return [...new Set([
    process.env.ADMIN_EMAIL,
    FALLBACK_ADMIN_EMAIL
  ].filter((email): email is string => Boolean(email && email.trim())))].map(normalizeEmail);
}

export function isProtectedAdminEmail(email: string) {
  return getProtectedAdminEmails().includes(normalizeEmail(email));
}

export function getAuthUser(request: FastifyRequest): AuthUser {
  const payload = request.user as Partial<AuthUser> | undefined;
  if (!payload?.userId || !payload.email) {
    throw new Error('Unauthorized');
  }
  return { userId: payload.userId, email: payload.email };
}

export async function getAccessibleProjectIds(userId: string): Promise<string[]> {
  const { globalScopes } = await resolveUserScopes(userId);
  if (globalScopes.size > 0) {
    const all = await prisma.project.findMany({ select: { id: true } });
    return all.map((p) => p.id);
  }
  const links = await prisma.teamProject.findMany({
    where: { team: { members: { some: { userId } } } },
    select: { projectId: true }
  });
  return [...new Set(links.map((l) => l.projectId))];
}

// Keeps the _email param for the 2.1 call-site signature; protected admins are already in the
// SUPERADMIN (isGlobal) group via migration/seed, so no email branch is needed.
export async function canCreateProject(userId: string, _email: string): Promise<boolean> {
  const rows = await prisma.userGroup.findMany({
    where: { userId },
    select: { group: { select: { isGlobal: true, scopes: { select: { scope: true } } } } }
  });
  return rows.some(({ group }) =>
    group.isGlobal || group.scopes.some((s) => s.scope === 'project_manage' || s.scope === 'checks_edit')
  );
}

export function getProjectAccessStatusCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as ProjectAccessError).statusCode ?? 500)
    : 500;
}

export function maskSecretValue(value: string) {
  if (!value) return value;
  return '••••••';
}

export function redactEnvironmentVariables(variables: Record<string, string>, viewerOnly = false) {
  if (!viewerOnly) return variables;

  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, maskSecretValue(value)])
  );
}

export async function getProjectOwnersCount(projectId: string) {
  return prisma.projectMember.count({
    where: { projectId, role: 'OWNER', status: 'ACTIVE' }
  });
}

export async function upsertProjectMember(data: {
  projectId: string;
  email: string;
  userId?: string | null;
  role: ProjectRole;
  status?: ProjectMemberStatus;
}) {
  return prisma.projectMember.upsert({
    where: {
      projectId_email: {
        projectId: data.projectId,
        email: data.email
      }
    },
    update: {
      userId: data.userId ?? null,
      role: data.role,
      status: data.status ?? 'ACTIVE'
    },
    create: {
      projectId: data.projectId,
      email: data.email,
      userId: data.userId ?? null,
      role: data.role,
      status: data.status ?? 'ACTIVE'
    }
  });
}
