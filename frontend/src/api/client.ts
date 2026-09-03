import axios from 'axios';
import type {
  ApiToken,
  ApiTokenCreated,
  CiDelivery,
  DashboardResponse,
  Environment,
  Fixture,
  GithubConfig,
  Group,
  Invite,
  NotificationChannel,
  NotificationChannelType,
  PageView,
  Project,
  ProjectMember,
  ReportConfig,
  ReportConfigPayload,
  ReportSend,
  Team,
  TeamDetail,
  ProjectWorkspace,
  ProjectSummary,
  Schedule,
  ScheduleHistoryResponse,
  Suite,
  Step,
  Test,
  TestRun,
  TestRunBatch,
  RunsResponse,
  ValidationReport
} from '../types';

export type TestPayload = {
  name: string;
  url: string;
  steps: Step[];
  testData?: Test['testData'];
  device?: string | null;
  environmentId?: string | null;
};

export const api = axios.create({
  // optional-chain so the module also imports under node/tsx tests where import.meta.env is absent
  baseURL: (import.meta as { env?: Record<string, string> }).env?.VITE_BACKEND_URL ?? 'http://localhost:3000'
});

export const getProjects = () =>
  api.get<ProjectSummary[]>('/projects').then((r) => r.data);

export const getDashboard = (days: number, projectId?: string) =>
  api
    .get<DashboardResponse>('/dashboard', {
      params: { days, ...(projectId ? { projectId } : {}) }
    })
    .then((r) => r.data);

export const getRuns = (days: number, projectId?: string, limit = 100) =>
  api
    .get<RunsResponse>('/runs', {
      params: { days, limit, ...(projectId ? { projectId } : {}) }
    })
    .then((r) => r.data);

export const getRunHistory = (
  filters: {
    days: number;
    limit: number;
    projectId?: string;
    status?: 'all' | 'passed' | 'failed';
    trigger?: 'all' | 'manual' | 'schedule';
  }
) =>
  api
    .get<RunsResponse>('/runs', {
      params: {
        days: filters.days,
        limit: filters.limit,
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.trigger ? { trigger: filters.trigger } : {})
      }
    })
    .then((r) => r.data);

export const createProject = (name: string) =>
  api.post<Project>('/projects', { name }).then((r) => r.data);

export const deleteProject = (id: string) =>
  api.delete(`/projects/${id}`);

export const updateProject = (id: string, data: { name: string }) =>
  api.patch<Project>(`/projects/${id}`, data).then((r) => r.data);

export const getProject = (id: string) =>
  api.get<ProjectWorkspace>(`/projects/${id}`).then((r) => r.data);

export const getProjectMembers = (projectId: string) =>
  api.get<ProjectMember[]>(`/projects/${projectId}/members`).then((r) => r.data);

export const getProjectTeams = (projectId: string) =>
  api.get<{ id: string; name: string }[]>(`/projects/${projectId}/teams`).then((r) => r.data);

export const checkUserExists = (email: string) =>
  api.get<{ exists: boolean }>('/users/exists', {
    params: { email }
  }).then((r) => r.data);

// Groups (superadmin)
export const getGroups = () => api.get<Group[]>('/groups').then((r) => r.data);
export const createGroup = (data: { name: string; scopes: string[] }) =>
  api.post<Group>('/groups', data).then((r) => r.data);
export const updateGroup = (id: string, data: Partial<{ name: string; scopes: string[] }>) =>
  api.patch<Group>(`/groups/${id}`, data).then((r) => r.data);
export const deleteGroup = (id: string) => api.delete(`/groups/${id}`);

// Users + global group assignment (superadmin)
export type UserWithGroups = { id: string; email: string; groups: Group[] };
export type UsersPage = { users: UserWithGroups[]; total: number; page: number; limit: number };
export const getUsers = (params?: { page?: number; limit?: number }) =>
  api.get<UsersPage>('/users', { params }).then((r) => r.data);
export const getUserGroups = (userId: string) =>
  api.get<Group[]>(`/users/${userId}/groups`).then((r) => r.data);
export const setUserGroups = (userId: string, groupIds: string[]) =>
  api.put(`/users/${userId}/groups`, { groupIds });

// Teams (delegated via teams_manage)
export type TeamsPage = { teams: Team[]; total: number; page: number; limit: number };
export const getTeams = (params?: { page?: number; limit?: number }) =>
  api.get<TeamsPage>('/teams', { params }).then((r) => r.data);
export const getTeam = (id: string) =>
  api.get<TeamDetail>(`/teams/${id}`).then((r) => r.data);
export const createTeam = (data: { name: string }) =>
  api.post<Team>('/teams', data).then((r) => r.data);
export const updateTeam = (id: string, data: { name: string }) =>
  api.patch<Team>(`/teams/${id}`, data).then((r) => r.data);
export const deleteTeam = (id: string) => api.delete(`/teams/${id}`);
export const attachTeamToProject = (teamId: string, projectId: string) =>
  api.post(`/teams/${teamId}/projects`, { projectId });
export const detachTeamFromProject = (teamId: string, projectId: string) =>
  api.delete(`/teams/${teamId}/projects/${projectId}`);
export const addTeamMember = (teamId: string, userId: string) =>
  api.post(`/teams/${teamId}/members`, { userId });
export const removeTeamMember = (teamId: string, userId: string) =>
  api.delete(`/teams/${teamId}/members/${userId}`);

// Invites (2.4)
export const getInvites = () =>
  api.get<Invite[]>('/invites').then((r) => r.data);
export const createInvite = (data: { email: string; teamId?: string; groupId?: string }) =>
  api.post<Invite>('/invites', data).then((r) => r.data);
export const revokeInvite = (id: string) => api.delete(`/invites/${id}`);

export const getDevices = () =>
  api.get<{ label: string; value: string }[]>('/devices').then((r) => r.data);

export const getSuites = (projectId: string) =>
  api.get<Suite[]>(`/projects/${projectId}/suites`).then((r) => r.data);

export const createSuite = (
  projectId: string,
  data: { name: string; testIds: string[] }
) => api.post<Suite>(`/projects/${projectId}/suites`, data).then((r) => r.data);

export const updateSuite = (
  id: string,
  data: Partial<{ name: string; testIds: string[] }>
) => api.patch<Suite>(`/suites/${id}`, data).then((r) => r.data);

export const deleteSuite = (id: string) =>
  api.delete(`/suites/${id}`);

export const runSuite = (id: string, environmentId?: string) =>
  api.post<{ suiteId: string; queued: number; jobs: { testRunId: string; testId: string }[] }>(
    `/suites/${id}/run`,
    environmentId ? { environmentId } : {}
  ).then((r) => r.data);

export const getSchedules = (projectId: string) =>
  api.get<Schedule[]>(`/projects/${projectId}/schedules`).then((r) => r.data);

export const getScheduleHistory = (scheduleId: string, page = 1, limit = 20) =>
  api.get<ScheduleHistoryResponse>(`/schedules/${scheduleId}/history`, {
    params: { page, limit }
  }).then((r) => r.data);

export const createSchedule = (
  projectId: string,
  data: {
    name: string;
    cron: string;
    timezone?: string;
    suiteId?: string;
    testId?: string;
    environmentId?: string;
    enabled: boolean;
  }
) => api.post<Schedule>(`/projects/${projectId}/schedules`, data).then((r) => r.data);

export const updateSchedule = (
  id: string,
  data: Partial<{
    name: string;
    cron: string;
    timezone: string | null;
    suiteId: string | null;
    testId: string | null;
    environmentId: string | null;
    enabled: boolean;
  }>
) => api.patch<Schedule>(`/schedules/${id}`, data).then((r) => r.data);

export const deleteSchedule = (id: string) =>
  api.delete(`/schedules/${id}`);

export const runSchedule = (id: string) =>
  api.post('/schedules/' + id + '/run');

export const getEnvironments = (projectId: string) =>
  api.get<Environment[]>(`/projects/${projectId}/environments`).then((r) => r.data);

export const createEnvironment = (projectId: string, data: { name: string; variables: Record<string, string> }) =>
  api.post<Environment>(`/projects/${projectId}/environments`, data).then((r) => r.data);

export const updateEnvironment = (
  id: string,
  data: Partial<{ name: string; variables: Record<string, string> }>
) => api.patch<Environment>(`/environments/${id}`, data).then((r) => r.data);

export const deleteEnvironment = (id: string) =>
  api.delete(`/environments/${id}`);

export const getChannels = (projectId: string) =>
  api.get<NotificationChannel[]>(`/projects/${projectId}/channels`).then((r) => r.data);

export const createChannel = (
  projectId: string,
  data: {
    type: NotificationChannelType;
    name: string;
    config: Record<string, string>;
    onFailed: boolean;
    onRecovered?: boolean;
    onPassed: boolean;
    enabled?: boolean;
  }
) => api.post<NotificationChannel>(`/projects/${projectId}/channels`, data).then((r) => r.data);

export const updateChannel = (
  id: string,
  data: Partial<{
    name: string;
    config: Record<string, string>;
    onFailed: boolean;
    onRecovered: boolean;
    onPassed: boolean;
    enabled: boolean;
  }>
) => api.patch<NotificationChannel>(`/channels/${id}`, data).then((r) => r.data);

export const deleteChannel = (id: string) =>
  api.delete(`/channels/${id}`);

export const testChannel = (id: string) =>
  api.post<{ ok: boolean }>(`/channels/${id}/test`).then((r) => r.data);

export const testChannelDraft = (
  projectId: string,
  data: {
    type: NotificationChannelType;
    name: string;
    config: Record<string, string>;
  }
) => api.post<{ ok: boolean }>(`/projects/${projectId}/channels/test`, data).then((r) => r.data);

export const createTest = (
  projectId: string,
  data: TestPayload
) => api.post<Test>(`/projects/${projectId}/tests`, data).then((r) => r.data);

export const updateTest = (id: string, data: Partial<TestPayload>) =>
  api.patch<Test>(`/tests/${id}`, data).then((r) => r.data);

export const getTest = (id: string) =>
  api.get<Test>(`/tests/${id}`).then((r) => r.data);

export const deleteTest = (id: string) =>
  api.delete(`/tests/${id}`);

export const importTestSpec = (projectId: string, code: string, name?: string) =>
  api.post<{ test: Test; parsedSteps: number }>(`/projects/${projectId}/import`, { code, name }).then((r) => r.data);

export const runTest = (testId: string, dataCaseIndex?: number) =>
  api
    .post<{ testRunId: string; jobId?: string; status: string }>(
      `/tests/${testId}/run`,
      dataCaseIndex === undefined ? {} : { dataCaseIndex }
    )
    .then((r) => r.data);

export const runTestWithEnvironment = (testId: string, environmentId?: string, dataCaseIndex?: number) =>
  api
    .post<{ testRunId: string; jobId?: string; status: string }>(`/tests/${testId}/run`, {
      ...(environmentId ? { environmentId } : {}),
      ...(dataCaseIndex === undefined ? {} : { dataCaseIndex })
    })
    .then((r) => r.data);

export const runAllEnabledTestCases = (testId: string, environmentId?: string) =>
  api
    .post<{
      batchId: string;
      testId: string;
      totalCases: number;
      queued: number;
      runs: Array<{
        id: string;
        testRunId: string;
        jobId?: string;
        dataCaseName: string;
        dataCaseIndex: number;
        batchOrder: number;
      }>;
    }>(`/tests/${testId}/runs/all-cases`, {
      ...(environmentId ? { environmentId } : {})
    })
    .then((r) => r.data);

export const triggerWebhook = (payload: {
  testId?: string;
  projectId?: string;
  environmentId?: string;
}) => api.post<{ queued: number; jobs: { testRunId: string; testId: string }[] }>(
  '/webhooks/trigger',
  payload
).then((r) => r.data);

export const getRun = (runId: string) =>
  api.get<TestRun>(`/runs/${runId}`).then((r) => r.data);

export const getRunBatch = (batchId: string) =>
  api.get<TestRunBatch>(`/run-batches/${batchId}`).then((r) => r.data);

export const getTestRuns = (testId: string) =>
  api.get<TestRun[]>(`/tests/${testId}/runs`).then((r) => r.data);

export const validateTestSteps = (projectId: string, url: string, steps: Step[], device?: string | null) =>
  api.post<ValidationReport>('/tests/validate', {
    projectId,
    url,
    steps,
    device: device || undefined
  }).then((r) => r.data);

export const startRecording = (url: string, projectId: string, environmentId?: string, device?: string) =>
  api.post<{ sessionId: string; status: string }>('/recordings/start', {
    url,
    projectId,
    environmentId,
    device
  }).then((r) => r.data);

export const stopRecording = (sessionId: string) =>
  api.post<{ steps: Step[] }>(`/recordings/${sessionId}/stop`).then((r) => r.data);

export const startDrivenRecording = (projectId: string, url: string, device?: string) =>
  api.post<{ sessionId: string; steps: Step[]; view: PageView }>('/recordings/driven/start', { projectId, url, device }).then((r) => r.data);

export const sendDrivenAction = (sessionId: string, action: Step) =>
  api.post<{ step: Step; view: PageView }>(`/recordings/driven/${sessionId}/action`, action).then((r) => r.data);

export const observeDrivenRecording = (sessionId: string) =>
  api.get<{ view: PageView }>(`/recordings/driven/${sessionId}/observe`).then((r) => r.data);

export const stopDrivenRecording = (sessionId: string) =>
  api.post<{ steps: Step[] }>(`/recordings/driven/${sessionId}/stop`).then((r) => r.data);

export const uploadFixture = (projectId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<{ fixture: Fixture }>(`/projects/${projectId}/fixtures`, form).then((r) => r.data.fixture);
};

export const listFixtures = (projectId: string) =>
  api.get<{ fixtures: Fixture[] }>(`/projects/${projectId}/fixtures`).then((r) => r.data.fixtures);

export const validateInvite = (token: string) =>
  api.get<{ email: string }>('/auth/invite', { params: { token } }).then((r) => r.data);

export const acceptInvite = (token: string, password: string) =>
  api.post<{ ok: true }>('/auth/accept-invite', { token, password }).then((r) => r.data);

export const getReports = (projectId: string) =>
  api.get<ReportConfig[]>(`/projects/${projectId}/reports`).then((r) => r.data);

export const createReport = (projectId: string, payload: ReportConfigPayload) =>
  api.post<ReportConfig>(`/projects/${projectId}/reports`, payload).then((r) => r.data);

export const updateReport = (id: string, payload: Partial<ReportConfigPayload>) =>
  api.patch<ReportConfig>(`/reports/${id}`, payload).then((r) => r.data);

export const deleteReport = (id: string) =>
  api.delete(`/reports/${id}`).then(() => undefined);

export const sendReportNow = (id: string) =>
  api.post<ReportSend | null>(`/reports/${id}/send-now`, {}).then((r) => r.data);

export const previewReport = (id: string) =>
  api.post<{ ok: boolean; previewedTo: string }>(`/reports/${id}/preview`, {}).then((r) => r.data);

export const getReportSends = (id: string) =>
  api.get<ReportSend[]>(`/reports/${id}/sends`).then((r) => r.data);

// API tokens (superadmin)
export const listApiTokens = () =>
  api.get<ApiToken[]>('/api-tokens').then((r) => r.data);
export const createApiToken = (body: { name: string; userId: string; expiresAt?: string }) =>
  api.post<ApiTokenCreated>('/api-tokens', body).then((r) => r.data);
export const revokeApiToken = (id: string) =>
  api.delete(`/api-tokens/${id}`);

// Project GitHub CI config
export const getProjectGithubConfig = (projectId: string) =>
  api.get<GithubConfig>(`/projects/${projectId}/github`).then((r) => r.data);
export const setProjectGithubConfig = (projectId: string, body: { repo: string; pat?: string }) =>
  api.put<GithubConfig>(`/projects/${projectId}/github`, body).then((r) => r.data);

// CI delivery log (superadmin)
export const listCiDeliveries = () =>
  api.get<CiDelivery[]>('/ci/deliveries').then((r) => r.data);
export const resendCiDelivery = (id: string) =>
  api.post(`/ci/deliveries/${id}/resend`).then((r) => r.data);
