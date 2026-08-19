// ponytail: single configured service token; swap for a Phase-2 scoped project token
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const BACKEND_TOKEN = process.env.BACKEND_TOKEN ?? '';

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${BACKEND_TOKEN}`,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}${path}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  // 204 No Content — nothing to parse
}

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

export const client = {
  // ── recording session ───────────────────────────────────────────────────────
  startDriven(input: { projectId: string; url: string; device?: string }): Promise<{ sessionId: string; steps: Step[]; view: PageView }> {
    return post<{ sessionId: string; steps: Step[]; view: PageView }>('/recordings/driven/start', input);
  },
  action(sessionId: string, step: Step): Promise<{ step: Step; view: PageView }> {
    return post<{ step: Step; view: PageView }>(`/recordings/driven/${sessionId}/action`, step);
  },
  observe(sessionId: string): Promise<{ view: PageView }> {
    return get<{ view: PageView }>(`/recordings/driven/${sessionId}/observe`);
  },
  stopDriven(sessionId: string): Promise<{ steps: Step[] }> {
    return post<{ steps: Step[] }>(`/recordings/driven/${sessionId}/stop`, {});
  },

  // ── test persistence ──────────────────────────────────────────────────────────
  createTest(projectId: string, input: CreateTestInput): Promise<Test> {
    return post<Test>(`/projects/${projectId}/tests`, input);
  },
  validateSteps(input: { projectId: string; url: string; steps: Step[]; device?: string }): Promise<ValidationReport> {
    return post<ValidationReport>('/tests/validate', input);
  },
  listTests(projectId: string): Promise<Test[]> {
    return get<Test[]>(`/projects/${projectId}/tests`);
  },
  getTest(testId: string): Promise<Test> {
    return get<Test>(`/tests/${testId}`);
  },
  deleteTest(testId: string): Promise<void> {
    return del(`/tests/${testId}`);
  },
};

export type DrivenClient = typeof client;
