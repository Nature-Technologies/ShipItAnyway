// k6 load test: many test runs triggered in parallel.
//
// Models "huge number of tests running at parallel" against the SIA backend:
//   - trigger_storm : escalating arrival-rate of POST /tests/:id/run (enqueue path)
//   - read_under_load: concurrent pollers on GET /projects/:id/runs + GET /runs/:id
//
// Two backend limits dominate the result — know them before reading numbers:
//   1. Global rate limit  = 100 req/min per IP   (backend/src/index.ts, @fastify/rate-limit)
//   2. Worker concurrency = 3 by default         (TEST_WORKER_CONCURRENCY, batch-sequencer.ts)
// So beyond ~1.6 req/s the API returns 429, and enqueued runs drain 3-at-a-time regardless
// of how fast you push. 429s are tracked as `rate_limited`, NOT as failures.
// For a true stress test of throughput, raise both (see README) and re-run.
//
// Run (EMAIL + PASSWORD are required):
//   k6 run -e EMAIL=you@example.com -e PASSWORD=... load-tests/parallel-runs.js
//   k6 run -e EMAIL=you@example.com -e PASSWORD=... -e MAX_RPS=50 -e DURATION=2m load-tests/parallel-runs.js

import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL; // required — pass via -e EMAIL=...
const PASSWORD = __ENV.PASSWORD; // required — pass via -e PASSWORD=...

// Peak arrival rate (requests/sec) the trigger storm ramps up to.
const MAX_RPS = Number(__ENV.MAX_RPS || 30);
const DURATION = __ENV.DURATION || '1m';
const READ_VUS = Number(__ENV.READ_VUS || 10);

// Custom metrics.
const runsEnqueued = new Counter('runs_enqueued'); // 202 responses = a run accepted onto the queue
const rateLimited = new Rate('rate_limited'); // share of trigger calls bounced by the 100/min limit
const triggerLatency = new Trend('trigger_latency', true);
const readLatency = new Trend('read_latency', true);

export const options = {
  scenarios: {
    trigger_storm: {
      executor: 'ramping-arrival-rate',
      exec: 'triggerRun',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: Math.ceil(MAX_RPS / 3), duration: '15s' },
        { target: MAX_RPS, duration: '15s' },
        { target: MAX_RPS, duration: DURATION },
        { target: 0, duration: '10s' },
      ],
    },
    read_under_load: {
      executor: 'constant-vus',
      exec: 'readRuns',
      vus: READ_VUS,
      duration: DURATION,
      startTime: '30s', // start once runs exist to read
    },
  },
  thresholds: {
    // Only genuine failures (5xx, network, unexpected status) count here.
    trigger_errors: ['rate<0.01'],
    read_errors: ['rate<0.01'],
    // Accepted enqueues should stay fast; rate-limited ones are excluded from this trend.
    trigger_latency: ['p(95)<800'],
    read_latency: ['p(95)<1000'],
  },
};

const triggerErrors = new Rate('trigger_errors');
const readErrors = new Rate('read_errors');

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

// One login, one discovery pass — shared by every VU. Avoids the 10-logins/5min auth limit.
export function setup() {
  if (!EMAIL || !PASSWORD) {
    fail('Set credentials via env: -e EMAIL=... -e PASSWORD=...');
  }
  const login = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (login.status !== 200) {
    fail(`login failed (${login.status}): ${login.body}`);
  }
  const token = login.json('token');

  let projectId = __ENV.PROJECT_ID;
  let testId = __ENV.TEST_ID;
  let environmentId = __ENV.ENV_ID;

  if (!projectId || !testId) {
    const projects = http.get(`${BASE_URL}/projects`, authHeaders(token));
    if (projects.status !== 200) fail(`GET /projects failed (${projects.status})`);
    const withTests = projects.json().find((p) => p.tests && p.tests.length > 0);
    if (!withTests) fail('No project with at least one test found — create a test first, or pass -e TEST_ID');
    projectId = projectId || withTests.id;

    const tests = http.get(`${BASE_URL}/projects/${projectId}/tests`, authHeaders(token));
    if (tests.status !== 200) fail(`GET tests failed (${tests.status})`);
    testId = testId || tests.json()[0].id;
  }

  if (!environmentId) {
    const envs = http.get(`${BASE_URL}/projects/${projectId}/environments`, authHeaders(token));
    if (envs.status === 200 && envs.json().length > 0) environmentId = envs.json()[0].id;
  }

  // Probe once: does this test require a dataCaseIndex? (400 if we guess wrong either way.)
  const probe = http.post(
    `${BASE_URL}/tests/${testId}/run`,
    JSON.stringify(environmentId ? { environmentId } : {}),
    authHeaders(token)
  );
  const needsDataCase = probe.status === 400 && String(probe.body).includes('test data case');

  console.log(
    `setup: project=${projectId} test=${testId} env=${environmentId || 'none'} ` +
      `needsDataCase=${needsDataCase} (probe status ${probe.status})`
  );
  return { token, projectId, testId, environmentId, needsDataCase };
}

export function triggerRun(data) {
  const body = {};
  if (data.environmentId) body.environmentId = data.environmentId;
  if (data.needsDataCase) body.dataCaseIndex = 0;

  const res = http.post(
    `${BASE_URL}/tests/${data.testId}/run`,
    JSON.stringify(body),
    { ...authHeaders(data.token), tags: { name: 'trigger_run' } }
  );

  const limited = res.status === 429;
  rateLimited.add(limited);

  if (res.status === 202) {
    runsEnqueued.add(1);
    triggerLatency.add(res.timings.duration);
    triggerErrors.add(false);
  } else if (limited) {
    triggerErrors.add(false); // expected under the global limit — not a defect
  } else {
    triggerErrors.add(true);
    check(res, { 'trigger accepted or rate-limited': () => false });
  }
}

export function readRuns(data) {
  const list = http.get(
    `${BASE_URL}/projects/${data.projectId}/runs?limit=50`,
    { ...authHeaders(data.token), tags: { name: 'list_runs' } }
  );
  const listOk = list.status === 200 || list.status === 429;
  readErrors.add(!listOk);
  if (list.status === 200) {
    readLatency.add(list.timings.duration);
    const runs = list.json('runs') || [];
    // Follow one run detail to exercise the read/redaction path under load.
    if (runs.length > 0) {
      const detail = http.get(
        `${BASE_URL}/runs/${runs[0].id}`,
        { ...authHeaders(data.token), tags: { name: 'run_detail' } }
      );
      readErrors.add(!(detail.status === 200 || detail.status === 429));
      if (detail.status === 200) readLatency.add(detail.timings.duration);
    }
  }
}
