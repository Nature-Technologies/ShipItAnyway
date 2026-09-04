// Centralized query keys — the invalidation contract. Keys are hierarchical so a broad
// invalidate (e.g. ['project', id]) also clears its children (members, suites, ...).
export const qk = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  projectMembers: (id: string) => ['project', id, 'members'] as const,
  projectSuites: (id: string) => ['project', id, 'suites'] as const,
  projectSchedules: (id: string) => ['project', id, 'schedules'] as const,
  projectEnvironments: (id: string) => ['project', id, 'environments'] as const,
  projectChannels: (id: string) => ['project', id, 'channels'] as const,
  projectFixtures: (id: string) => ['project', id, 'fixtures'] as const,

  dashboard: (days: number, projectId?: string) => ['dashboard', days, projectId ?? null] as const,

  runs: (filters: Record<string, unknown>) => ['runs', filters] as const,
  run: (id: string) => ['run', id] as const,
  runBatch: (id: string) => ['run-batch', id] as const,

  test: (id: string) => ['test', id] as const,
  testRuns: (testId: string) => ['test', testId, 'runs'] as const,

  scheduleHistory: (id: string, page: number, limit: number) =>
    ['schedule', id, 'history', page, limit] as const,

  devices: ['devices'] as const,
  groups: ['groups'] as const,
  users: ['users'] as const,
  usersPaged: (page: number, limit: number) => ['users', page, limit] as const,
  userGroups: (userId: string) => ['user', userId, 'groups'] as const,
  teams: ['teams'] as const,
  teamsPaged: (page: number, limit: number) => ['teams', page, limit] as const,
  team: (id: string) => ['team', id] as const,
  invites: ['invites'] as const,
  invite: (token: string) => ['invite', token] as const,

  projectReports: (id: string) => ['project', id, 'reports'] as const,
  reportSends: (id: string) => ['report', id, 'sends'] as const,

  ciDeliveries: ['ci-deliveries'] as const,
  apiTokens: ['api-tokens'] as const,
  projectGithubConfig: (id: string) => ['project', id, 'github'] as const
} as const;
