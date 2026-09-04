type FetchLike = typeof fetch;

export interface PageView {
  screenshot: string;
  snapshot: string;
  url: string;
  title: string;
}

export interface Step {
  action: string;
  [k: string]: unknown;
}

export interface Test {
  id: string;
  name: string;
  url: string;
  steps: Step[];
  [k: string]: unknown;
}

export interface CreateTestInput {
  name: string;
  url: string;
  steps: Step[];
  device?: string;
  environmentId?: string | null;
}

export interface ValidationReport {
  [k: string]: unknown;
}

export interface SiaClient {
  // recording session (unchanged behaviour)
  startDriven(input: { projectId: string; url: string; device?: string }): Promise<{ sessionId: string; steps: Step[]; view: PageView }>;
  action(sessionId: string, step: Step): Promise<{ step: Step; view: PageView }>;
  observe(sessionId: string): Promise<{ view: PageView }>;
  stopDriven(sessionId: string): Promise<{ steps: Step[] }>;
  createTest(projectId: string, input: CreateTestInput): Promise<Test>;
  validateSteps(input: { projectId: string; url: string; steps: Step[]; device?: string }): Promise<ValidationReport>;
  listTests(projectId: string): Promise<Test[]>;
  getTest(testId: string): Promise<Test>;
  deleteTest(testId: string): Promise<void>;
  // reporting / execution (new)
  getCapabilities(): Promise<{ userId: string; email: string; isSuperadmin: boolean; scopes: string[] }>;
  listProjects(): Promise<Array<{ id: string; name: string }>>;
  listRuns(projectId: string, q?: Record<string, string | number | undefined>): Promise<{ runs: unknown[]; nextCursor: string | null }>;
  getRun(id: string): Promise<unknown>;
  getRunBatch(id: string): Promise<unknown>;
  triggerRun(body: { testId?: string; suiteId?: string; environmentId: string }): Promise<{ runIds: string[]; batchIds: string[] }>;
}

export function makeClient(token: string, baseUrl = process.env.BACKEND_URL ?? 'http://localhost:3000', fetchImpl: FetchLike = fetch): SiaClient {
  const authHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetchImpl(`${baseUrl}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetchImpl(`${baseUrl}${path}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };
  const del = async (path: string): Promise<void> => {
    const res = await fetchImpl(`${baseUrl}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  };
  const qs = (q?: Record<string, string | number | undefined>): string => {
    if (!q) return '';
    const parts = Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };

  return {
    startDriven: (input) => post('/recordings/driven/start', input),
    action: (sessionId, step) => post(`/recordings/driven/${sessionId}/action`, step),
    observe: (sessionId) => get(`/recordings/driven/${sessionId}/observe`),
    stopDriven: (sessionId) => post(`/recordings/driven/${sessionId}/stop`, {}),
    createTest: (projectId, input) => post(`/projects/${projectId}/tests`, input),
    validateSteps: (input) => post('/tests/validate', input),
    listTests: (projectId) => get(`/projects/${projectId}/tests`),
    getTest: (testId) => get(`/tests/${testId}`),
    deleteTest: (testId) => del(`/tests/${testId}`),
    getCapabilities: () => get('/me/capabilities'),
    listProjects: () => get('/projects'),
    listRuns: (projectId, q) => get(`/projects/${projectId}/runs${qs(q)}`),
    getRun: (id) => get(`/runs/${id}`),
    getRunBatch: (id) => get(`/run-batches/${id}`),
    triggerRun: (body) => post('/mcp/trigger', body)
  };
}
