import { Scope } from '@prisma/client';

const READ: Scope[] = [
  Scope.runs_read, Scope.checks_read, Scope.schedules_read,
  Scope.environments_read, Scope.alerts_read, Scope.members_read
];
const EDITOR_ADD: Scope[] = [
  Scope.runs_trigger, Scope.checks_edit, Scope.schedules_edit,
  Scope.environments_edit, Scope.alerts_edit, Scope.environments_reveal_secrets
];
const OWNER_ADD: Scope[] = [
  Scope.project_manage, Scope.project_delete, Scope.teams_manage
];

const VIEWER_SCOPES = READ;
const EDITOR_SCOPES = [...READ, ...EDITOR_ADD];
const OWNER_SCOPES = [...EDITOR_SCOPES, ...OWNER_ADD];
const ALL_SCOPES = Object.values(Scope);

export const SYSTEM_GROUPS: { name: string; isGlobal: boolean; scopes: Scope[] }[] = [
  { name: 'VIEWER', isGlobal: false, scopes: VIEWER_SCOPES },
  { name: 'EDITOR', isGlobal: false, scopes: EDITOR_SCOPES },
  { name: 'OWNER', isGlobal: false, scopes: OWNER_SCOPES },
  { name: 'SUPERADMIN', isGlobal: true, scopes: ALL_SCOPES }
];

// Highest role a legacy ProjectMember could hold → the group a user is flattened to.
export const ROLE_TO_GROUP: Record<'OWNER' | 'EDITOR' | 'VIEWER', string> = {
  OWNER: 'OWNER', EDITOR: 'EDITOR', VIEWER: 'VIEWER'
};

// Scope wire format: the DB Prisma enum is underscored (`runs_read`), but the API/UI speak the
// canonical `resource:action` form (`runs:read`, `environments:reveal-secrets`). Convert only at
// the HTTP boundary; internal `can()/requireScope` keep the Prisma enum.
export function toApiScope(scope: Scope): string {
  return scope.replace('_', ':').replaceAll('_', '-');
}

export function fromApiScope(scope: string): Scope | null {
  const db = scope.replace(':', '_').replaceAll('-', '_');
  return (Object.values(Scope) as string[]).includes(db) ? (db as Scope) : null;
}

export const ALL_API_SCOPES: string[] = Object.values(Scope).map(toApiScope);
