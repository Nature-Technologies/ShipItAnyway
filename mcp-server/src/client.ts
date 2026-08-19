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

export const client = {
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
};

export type DrivenClient = typeof client;
