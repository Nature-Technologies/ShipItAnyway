import type { FastifyRequest } from 'fastify';
import type { ProjectMember, ProjectMemberStatus, ProjectRole } from '@prisma/client';
import prisma from '../prisma';
import { FALLBACK_ADMIN_EMAIL } from '../constants/admin';

export type AuthUser = {
  userId: string;
  email: string;
};

export type ProjectAccess = {
  project: { id: string; name: string };
  member: ProjectMember;
};

export type ProjectAccessError = Error & { statusCode?: number };

export type Scope =
  | 'runs:read' | 'runs:trigger'
  | 'checks:read' | 'checks:edit'
  | 'schedules:read' | 'schedules:edit'
  | 'environments:read' | 'environments:edit' | 'environments:reveal-secrets'
  | 'alerts:read' | 'alerts:edit'
  | 'members:read'
  | 'teams:manage'
  | 'project:manage' | 'project:delete';

const VIEWER_SCOPES: Scope[] = [
  'runs:read', 'checks:read', 'schedules:read',
  'environments:read', 'alerts:read', 'members:read'
];
const EDITOR_SCOPES: Scope[] = [
  ...VIEWER_SCOPES,
  'runs:trigger', 'checks:edit', 'schedules:edit',
  'environments:edit', 'alerts:edit', 'environments:reveal-secrets'
];
const OWNER_SCOPES: Scope[] = [
  ...EDITOR_SCOPES,
  'project:manage', 'project:delete', 'teams:manage'
];

// ponytail: role→scope shim. Roadmap 2.2 replaces this body with a group-union lookup; no route changes.
export function resolveScopes(member: ProjectMember): Set<Scope> {
  switch (member.role) {
    case 'OWNER': return new Set(OWNER_SCOPES);
    case 'EDITOR': return new Set(EDITOR_SCOPES);
    case 'VIEWER': return new Set(VIEWER_SCOPES);
    default: return new Set();
  }
}

export function can(access: ProjectAccess, scope: Scope): boolean {
  return resolveScopes(access.member).has(scope);
}

export async function requireScope(projectId: string, userId: string, scope: Scope): Promise<ProjectAccess> {
  const access = await getProjectAccess(projectId, userId);
  if (!access) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    const error = new Error(project ? 'Forbidden' : 'Project not found') as ProjectAccessError;
    error.statusCode = project ? 403 : 404;
    throw error;
  }
  if (!can(access, scope)) {
    const error = new Error('Forbidden') as ProjectAccessError;
    error.statusCode = 403;
    throw error;
  }
  return access;
}

const ROLE_RANK: Record<ProjectRole, number> = {
  OWNER: 3,
  EDITOR: 2,
  VIEWER: 1
};

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

export function hasProjectRole(memberRole: ProjectRole, allowedRoles: ProjectRole[]) {
  return allowedRoles.includes(memberRole);
}

export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess | null> {
  const [project, member] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true }
    }),
    prisma.projectMember.findFirst({
      where: {
        projectId,
        userId,
        status: 'ACTIVE'
      }
    })
  ]);

  if (!project || !member) {
    return null;
  }

  return { project, member };
}

export async function getAccessibleProjectIds(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: {
      userId,
      status: 'ACTIVE'
    },
    select: {
      projectId: true
    }
  });

  return memberships.map((membership) => membership.projectId);
}

export async function canCreateProject(userId: string, email: string) {
  if (isProtectedAdminEmail(email)) {
    return true;
  }

  const editableMembership = await prisma.projectMember.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      role: {
        in: ['OWNER', 'EDITOR']
      }
    },
    select: {
      id: true
    }
  });

  return Boolean(editableMembership);
}

export async function requireProjectRole(projectId: string, userId: string, allowedRoles: ProjectRole[]) {
  const access = await getProjectAccess(projectId, userId);
  if (!access) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) {
      const error = new Error('Project not found');
      (error as ProjectAccessError).statusCode = 404;
      throw error;
    }

    const error = new Error('Forbidden');
    (error as ProjectAccessError).statusCode = 403;
    throw error;
  }

  if (!hasProjectRole(access.member.role, allowedRoles)) {
    const error = new Error('Forbidden');
    (error as ProjectAccessError).statusCode = 403;
    throw error;
  }

  return access;
}

export function getProjectAccessStatusCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as ProjectAccessError).statusCode ?? 500)
    : 500;
}

export function roleAtLeast(role: ProjectRole, requiredRole: ProjectRole) {
  return ROLE_RANK[role] >= ROLE_RANK[requiredRole];
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
