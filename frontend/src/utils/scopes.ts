// Underscored scope literals match the backend Prisma `Scope` enum emitted in `currentUserScopes`.
export type Scope =
  | 'checks_edit'
  | 'runs_trigger'
  | 'schedules_edit'
  | 'environments_edit'
  | 'alerts_edit'
  | 'teams_manage'
  | 'members_read';

export function can(scopes: Scope[], scope: Scope): boolean {
  return scopes.includes(scope);
}

export function isReadOnly(scopes: Scope[]): boolean {
  return !scopes.some((s) => s.endsWith('_edit'));
}

export interface ProjectGates {
  canEditChecks: boolean;
  canTriggerRuns: boolean;
  canEditSchedules: boolean;
  canEditEnvironments: boolean;
  canEditAlerts: boolean;
  canManageTeams: boolean;
  canReadMembers: boolean;
  readOnly: boolean;
}

export function deriveProjectGates(scopes: Scope[]): ProjectGates {
  return {
    canEditChecks: can(scopes, 'checks_edit'),
    canTriggerRuns: can(scopes, 'runs_trigger'),
    canEditSchedules: can(scopes, 'schedules_edit'),
    canEditEnvironments: can(scopes, 'environments_edit'),
    canEditAlerts: can(scopes, 'alerts_edit'),
    canManageTeams: can(scopes, 'teams_manage'),
    canReadMembers: can(scopes, 'members_read'),
    readOnly: isReadOnly(scopes)
  };
}
