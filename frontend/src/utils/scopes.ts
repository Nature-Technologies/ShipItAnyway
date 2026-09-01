// Canonical `resource:action` scope literals — match the API form emitted in `currentUserScopes`.
export type Scope =
  | 'checks:edit'
  | 'runs:trigger'
  | 'schedules:edit'
  | 'environments:edit'
  | 'alerts:edit'
  | 'teams:manage'
  | 'members:read'
  | 'reports:read'
  | 'reports:edit';

// scopes is the raw wire array (full catalog, `resource:action` form); scope is a known gate.
export function can(scopes: readonly string[], scope: Scope): boolean {
  return scopes.includes(scope);
}

export function isReadOnly(scopes: readonly string[]): boolean {
  return !scopes.some((s) => s.endsWith(':edit'));
}

export interface ProjectGates {
  canEditChecks: boolean;
  canTriggerRuns: boolean;
  canEditSchedules: boolean;
  canEditEnvironments: boolean;
  canEditAlerts: boolean;
  canManageTeams: boolean;
  canReadMembers: boolean;
  canReadReports: boolean;
  canEditReports: boolean;
  readOnly: boolean;
}

export function deriveProjectGates(scopes: readonly string[]): ProjectGates {
  return {
    canEditChecks: can(scopes, 'checks:edit'),
    canTriggerRuns: can(scopes, 'runs:trigger'),
    canEditSchedules: can(scopes, 'schedules:edit'),
    canEditEnvironments: can(scopes, 'environments:edit'),
    canEditAlerts: can(scopes, 'alerts:edit'),
    canManageTeams: can(scopes, 'teams:manage'),
    canReadMembers: can(scopes, 'members:read'),
    canReadReports: can(scopes, 'reports:read'),
    canEditReports: can(scopes, 'reports:edit'),
    readOnly: isReadOnly(scopes)
  };
}
