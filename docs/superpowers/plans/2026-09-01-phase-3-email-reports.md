# Phase 3.1 Environment Email Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-environment scheduled email report digests — pick checks, pick recipients, pick a cadence; on each fire, aggregate the runs since the last send and email a summary, with on-demand send/preview and a send-history record.

**Architecture:** A standalone `ReportConfig` model (own cron) drives a dedicated BullMQ repeatable-job queue that mirrors the existing schedule queue. On fire, a `report-runner` service aggregates runs (via aggregation logic extracted from `dashboard.ts` into `run-stats.ts`) over the window `(lastSentAt ?? createdAt, now]`, emails a digest through the existing mailer, and writes a `ReportSend` audit row. Routes follow the `channels.ts` pattern with `requireScope` gating on two new scopes.

**Tech Stack:** Fastify + Zod, Prisma (PostgreSQL), BullMQ + Redis, nodemailer, React + TanStack Query + axios, `node:test` + `tsx` for backend tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase-3-email-reports-design.md`

## Global Constraints

- Scope wire format: DB Prisma enum is underscored (`reports_read`); the API/UI speak colon form (`reports:read`). Convert only at the HTTP boundary via `toApiScope`/`fromApiScope` (`backend/src/constants/rbac.ts`). Internal `can()/requireScope` use the Prisma enum.
- All timestamps stored/compared in UTC. `timezone` fields are nullable → treated as `'UTC'` (matches `Schedule`).
- Prisma access is the singleton `import prisma from '../prisma'`. Never instantiate `PrismaClient` in routes/services.
- Backend tests run ONE FILE PER PROCESS: `cd backend && dotenv -e ../.env -- tsx --test tests/<file>.test.ts`. Each test file disconnects redis/prisma in a `finally`.
- Route error mapping uses `getProjectAccessStatusCode(error)` after `requireScope` throws.
- Migrations: `cd backend && pnpm prisma:migrate --name <name>` then `pnpm prisma:generate`.
- Frontend has no test runner; frontend tasks gate on `cd frontend && pnpm build` (typecheck) plus the stated manual check.
- Commit after every task with a `feat:`/`refactor:`/`test:` prefixed message.

---

### Task 1: Schema — ReportConfig, ReportSend, and report scopes

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_phase3_reports/migration.sql` (generated)
- Test: `backend/tests/report-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `ReportConfig { id, name, projectId, environmentId, cron, timezone?, recipients Json, checkIds Json, enabled, lastSentAt?, createdAt, updatedAt }` and `ReportSend { id, reportConfigId, status, trigger, windowStart, windowEnd, recipients Json, runCount, passed, failed, passRate, avgDurationMs?, error?, createdAt }`; enums `ReportSendStatus { SENT, SKIPPED_EMPTY, FAILED }`, `ReportSendTrigger { SCHEDULED, MANUAL }`; `Scope` enum gains `reports_read`, `reports_edit`.

- [ ] **Step 1: Add the two scope values to the `Scope` enum**

In `backend/prisma/schema.prisma`, add to `enum Scope` (after `alerts_edit`):

```prisma
  reports_read
  reports_edit
```

- [ ] **Step 2: Add the models + enums**

Append to `backend/prisma/schema.prisma`:

```prisma
model ReportConfig {
  id            String    @id @default(cuid())
  name          String
  projectId     String
  environmentId String
  cron          String
  timezone      String?
  recipients    Json      @default("[]")
  checkIds      Json      @default("[]")
  enabled       Boolean   @default(true)
  lastSentAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  project       Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  environment   Environment  @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  sends         ReportSend[]

  @@index([projectId])
  @@index([environmentId])
}

model ReportSend {
  id             String            @id @default(cuid())
  reportConfigId String
  status         ReportSendStatus
  trigger        ReportSendTrigger
  windowStart    DateTime
  windowEnd      DateTime
  recipients     Json              @default("[]")
  runCount       Int               @default(0)
  passed         Int               @default(0)
  failed         Int               @default(0)
  passRate       Int               @default(0)
  avgDurationMs  Int?
  error          String?
  createdAt      DateTime          @default(now())
  reportConfig   ReportConfig      @relation(fields: [reportConfigId], references: [id], onDelete: Cascade)

  @@index([reportConfigId])
}

enum ReportSendStatus {
  SENT
  SKIPPED_EMPTY
  FAILED
}

enum ReportSendTrigger {
  SCHEDULED
  MANUAL
}
```

- [ ] **Step 3: Add back-relations to Project and Environment**

In `model Project`, add: `reportConfigs ReportConfig[]`
In `model Environment`, add: `reportConfigs ReportConfig[]`

- [ ] **Step 4: Create migration and regenerate client**

Run: `cd backend && pnpm prisma:migrate --name phase3_reports && pnpm prisma:generate`
Expected: migration created and applied; client regenerated with `ReportConfig`/`ReportSend` types.

- [ ] **Step 5: Write the failing test**

Create `backend/tests/report-schema.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';

test('ReportConfig + ReportSend persist and relate', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({ data: { name: `report-schema-${suffix}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  try {
    const config = await prisma.reportConfig.create({
      data: {
        name: 'Nightly', projectId: project.id, environmentId: env.id,
        cron: '0 8 * * *', recipients: ['a@example.com'], checkIds: []
      }
    });
    assert.equal(config.enabled, true);
    assert.equal(config.lastSentAt, null);

    const send = await prisma.reportSend.create({
      data: {
        reportConfigId: config.id, status: 'SENT', trigger: 'SCHEDULED',
        windowStart: new Date(0), windowEnd: new Date(),
        recipients: ['a@example.com'], runCount: 3, passed: 2, failed: 1, passRate: 67
      }
    });
    const withSends = await prisma.reportConfig.findUniqueOrThrow({
      where: { id: config.id }, include: { sends: true }
    });
    assert.equal(withSends.sends.length, 1);
    assert.equal(withSends.sends[0].id, send.id);

    // cascade: deleting the environment removes the config
    await prisma.environment.delete({ where: { id: env.id } });
    assert.equal(await prisma.reportConfig.count({ where: { id: config.id } }), 0);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 6: Run the test**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/report-schema.test.ts
git commit -m "feat: add ReportConfig/ReportSend models and report scopes"
```

---

### Task 2: Seed report scopes into the default groups

**Files:**
- Modify: `backend/src/constants/rbac.ts`
- Test: `backend/tests/report-scopes-seed.test.ts`

**Interfaces:**
- Consumes: `Scope.reports_read`, `Scope.reports_edit` (Task 1); `seedSystemGroups` (`backend/prisma/seed.ts`).
- Produces: VIEWER group includes `reports_read`; EDITOR/OWNER include `reports_edit`; SUPERADMIN unchanged (already `ALL_SCOPES`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/report-scopes-seed.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { seedSystemGroups } from '../prisma/seed';

test('default groups include report scopes', async () => {
  try {
    await seedSystemGroups();
    const load = async (name: string) => {
      const g = await prisma.group.findUniqueOrThrow({ where: { name }, include: { scopes: true } });
      return new Set(g.scopes.map((s) => s.scope));
    };
    assert.ok((await load('VIEWER')).has('reports_read'));
    assert.ok(!(await load('VIEWER')).has('reports_edit'));
    assert.ok((await load('EDITOR')).has('reports_edit'));
    assert.ok((await load('OWNER')).has('reports_edit'));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-scopes-seed.test.ts`
Expected: FAIL — VIEWER lacks `reports_read`.

- [ ] **Step 3: Add scopes to the group definitions**

In `backend/src/constants/rbac.ts`:
- Add `Scope.reports_read` to the `READ` array.
- Add `Scope.reports_edit` to the `EDITOR_ADD` array.

- [ ] **Step 4: Re-seed and run the test**

Run: `cd backend && pnpm prisma:seed && dotenv -e ../.env -- tsx --test tests/report-scopes-seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/constants/rbac.ts backend/tests/report-scopes-seed.test.ts
git commit -m "feat: seed report scopes into default groups"
```

---

### Task 3: Extract shared run aggregation into `run-stats.ts`

**Files:**
- Create: `backend/src/services/run-stats.ts`
- Modify: `backend/src/routes/dashboard.ts`
- Test: `backend/tests/run-stats.test.ts`

**Interfaces:**
- Produces:
  - `type RunStat = { status: 'PASSED' | 'FAILED' | 'PENDING' | 'RUNNING'; durationMs: number | null }`
  - `summarize(runs: RunStat[]): { total: number; passed: number; failed: number; passRate: number; avgDurationMs: number | null }`
  - `type FlakyInput = { testId: string; testName: string; status: RunStat['status'] }`
  - `flakyChecks(runs: FlakyInput[], limit?: number): Array<{ testId: string; testName: string; totalRuns: number; passed: number; failed: number; passRate: number }>`
- Consumed by: `dashboard.ts` (Task 3) and `report-runner.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/run-stats.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, flakyChecks } from '../src/services/run-stats';

test('summarize computes counts, pass rate, avg duration', () => {
  const s = summarize([
    { status: 'PASSED', durationMs: 100 },
    { status: 'PASSED', durationMs: 300 },
    { status: 'FAILED', durationMs: null }
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.passed, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.passRate, 67);
  assert.equal(s.avgDurationMs, 200); // null durations excluded from the average
});

test('summarize handles the empty set', () => {
  assert.deepEqual(summarize([]), { total: 0, passed: 0, failed: 0, passRate: 0, avgDurationMs: null });
});

test('flakyChecks returns only tests with both a pass and a fail', () => {
  const rows = flakyChecks([
    { testId: 't1', testName: 'A', status: 'PASSED' },
    { testId: 't1', testName: 'A', status: 'FAILED' },
    { testId: 't2', testName: 'B', status: 'PASSED' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].testId, 't1');
  assert.equal(rows[0].passRate, 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/run-stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `run-stats.ts`**

Create `backend/src/services/run-stats.ts`:

```typescript
import type { RunStatus } from '@prisma/client';

export type RunStat = { status: RunStatus; durationMs: number | null };

export function summarize(runs: RunStat[]) {
  const total = runs.length;
  const passed = runs.filter((r) => r.status === 'PASSED').length;
  const failed = runs.filter((r) => r.status === 'FAILED').length;
  const durations = runs.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
    : null;
  return { total, passed, failed, passRate: total ? Math.round((passed / total) * 100) : 0, avgDurationMs };
}

export type FlakyInput = { testId: string; testName: string; status: RunStatus };

export function flakyChecks(runs: FlakyInput[], limit = 10) {
  const grouped = new Map<string, { testName: string; passed: number; failed: number; total: number }>();
  for (const r of runs) {
    const g = grouped.get(r.testId) ?? { testName: r.testName, passed: 0, failed: 0, total: 0 };
    g.total += 1;
    if (r.status === 'PASSED') g.passed += 1;
    if (r.status === 'FAILED') g.failed += 1;
    grouped.set(r.testId, g);
  }
  return [...grouped.entries()]
    .filter(([, g]) => g.passed > 0 && g.failed > 0)
    .map(([testId, g]) => ({
      testId, testName: g.testName, totalRuns: g.total, passed: g.passed, failed: g.failed,
      passRate: g.total ? Math.round((g.passed / g.total) * 100) : 0
    }))
    .sort((a, b) => b.totalRuns - a.totalRuns)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/run-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in `dashboard.ts`**

In `backend/src/routes/dashboard.ts`, import `{ summarize }` from `../services/run-stats` and replace the inline `total`/`passed`/`failed`/`avgDurationMs` computation in the `/dashboard` handler (around lines 145-150) with:

```typescript
const { total, passed, failed, avgDurationMs } = summarize(runs);
```

Leave the `byDay`, `activeIssues`, and `flakyChecks` blocks as-is (they carry dashboard-only fields); this step only proves the extracted `summarize` is wired without behaviour change.

- [ ] **Step 6: Typecheck the backend**

Run: `cd backend && pnpm build`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/run-stats.ts backend/src/routes/dashboard.ts backend/tests/run-stats.test.ts
git commit -m "refactor: extract run aggregation into run-stats service"
```

---

### Task 4: Digest email in the mailer

**Files:**
- Modify: `backend/src/services/mailer.ts`
- Test: `backend/tests/report-email.test.ts`

**Interfaces:**
- Consumes: `sendMail` (existing in `mailer.ts`).
- Produces:
  - `type ReportDigest = { projectName: string; environmentName: string; reportName: string; windowStart: Date; windowEnd: Date; total: number; passed: number; failed: number; passRate: number; avgDurationMs: number | null; failures: Array<{ checkName: string; error: string | null }>; flaky: Array<{ checkName: string; passRate: number }> }`
  - `sendReportEmail(to: string, digest: ReportDigest): Promise<unknown>`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/report-email.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

delete process.env.SMTP_HOST; // force jsonTransport (log) mode
import { sendReportEmail } from '../src/services/mailer';

test('sendReportEmail renders the digest summary', async () => {
  const info = await sendReportEmail('ops@example.com', {
    projectName: 'Acme', environmentName: 'staging', reportName: 'Nightly',
    windowStart: new Date('2026-08-31T00:00:00Z'), windowEnd: new Date('2026-09-01T00:00:00Z'),
    total: 10, passed: 8, failed: 2, passRate: 80, avgDurationMs: 1500,
    failures: [{ checkName: 'Login', error: 'timeout' }],
    flaky: [{ checkName: 'Search', passRate: 60 }]
  });
  const message = JSON.parse((info as unknown as { message: string }).message);
  assert.equal(message.to[0].address, 'ops@example.com');
  assert.match(message.subject, /Nightly/);
  assert.match(message.subject, /staging/);
  assert.ok(message.text.includes('80%'));
  assert.ok(message.text.includes('Login'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-email.test.ts`
Expected: FAIL — `sendReportEmail` not exported.

- [ ] **Step 3: Implement `sendReportEmail`**

Append to `backend/src/services/mailer.ts`:

```typescript
export type ReportDigest = {
  projectName: string;
  environmentName: string;
  reportName: string;
  windowStart: Date;
  windowEnd: Date;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number | null;
  failures: Array<{ checkName: string; error: string | null }>;
  flaky: Array<{ checkName: string; passRate: number }>;
};

export async function sendReportEmail(to: string, d: ReportDigest) {
  const range = `${d.windowStart.toISOString()} → ${d.windowEnd.toISOString()}`;
  const avg = d.avgDurationMs == null ? 'n/a' : `${d.avgDurationMs} ms`;
  const failureLines = d.failures.length
    ? d.failures.map((f) => `- ${f.checkName}: ${f.error ?? 'failed'}`).join('\n')
    : '- none';
  const flakyLines = d.flaky.length
    ? d.flaky.map((f) => `- ${f.checkName} (${f.passRate}% pass)`).join('\n')
    : '- none';

  const text =
    `${d.reportName} — ${d.projectName} / ${d.environmentName}\n` +
    `Window: ${range}\n\n` +
    `Runs: ${d.total} | Passed: ${d.passed} | Failed: ${d.failed} | Pass rate: ${d.passRate}% | Avg: ${avg}\n\n` +
    `Failures:\n${failureLines}\n\nFlaky:\n${flakyLines}\n`;

  const html =
    `<h2>${d.reportName}</h2>` +
    `<p><strong>${d.projectName} / ${d.environmentName}</strong><br/>Window: ${range}</p>` +
    `<p>Runs: ${d.total} · Passed: ${d.passed} · Failed: ${d.failed} · Pass rate: ${d.passRate}% · Avg: ${avg}</p>` +
    `<h3>Failures</h3><ul>${d.failures.map((f) => `<li>${f.checkName}: ${f.error ?? 'failed'}</li>`).join('') || '<li>none</li>'}</ul>` +
    `<h3>Flaky</h3><ul>${d.flaky.map((f) => `<li>${f.checkName} (${f.passRate}% pass)</li>`).join('') || '<li>none</li>'}</ul>`;

  return sendMail({ to, subject: `[${d.environmentName}] ${d.reportName} report`, text, html });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mailer.ts backend/tests/report-email.test.ts
git commit -m "feat: add report digest email to mailer"
```

---

### Task 5: Report runner (window, aggregation, skip-empty, ReportSend rows)

**Files:**
- Create: `backend/src/services/report-runner.ts`
- Test: `backend/tests/report-runner.test.ts`

**Interfaces:**
- Consumes: `summarize`, `flakyChecks` (Task 3); `sendReportEmail`, `ReportDigest` (Task 4); `prisma`.
- Produces:
  - `sendReport(reportConfigId: string): Promise<ReportSend | null>` — scheduled path; honors skip-empty; writes a `ReportSend`; returns the row (or `null` if the config is missing/disabled).
  - `runReport(reportConfigId: string, opts: { trigger: 'SCHEDULED' | 'MANUAL'; overrideRecipients?: string[]; forceSend?: boolean }): Promise<ReportSend | null>` — the shared engine. `overrideRecipients` replaces configured recipients (preview → self); `forceSend: true` sends even on an empty window and never advances `lastSentAt` (preview).
- Consumed by: `report-queue.ts` (Task 6) and `reports.ts` routes (Task 7).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/report-runner.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST; // jsonTransport
import prisma from '../src/prisma';
import { sendReport, runReport } from '../src/services/report-runner';

async function fixture() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({ data: { name: `runner-${suffix}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  const check = await prisma.test.create({
    data: { name: 'Login', url: 'https://x.test', projectId: project.id, environmentId: env.id, steps: [] }
  });
  const config = await prisma.reportConfig.create({
    data: { name: 'Nightly', projectId: project.id, environmentId: env.id, cron: '0 8 * * *', recipients: ['ops@example.com'], checkIds: [] }
  });
  return { project, env, check, config };
}

test('empty window → SKIPPED_EMPTY, lastSentAt unchanged', async () => {
  const { project, config } = await fixture();
  try {
    const send = await sendReport(config.id);
    assert.equal(send?.status, 'SKIPPED_EMPTY');
    const after = await prisma.reportConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.equal(after.lastSentAt, null);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('runs in window → SENT, lastSentAt advanced, counts recorded', async () => {
  const { project, env, check, config } = await fixture();
  try {
    await prisma.testRun.create({ data: { testId: check.id, environmentId: env.id, status: 'PASSED', durationMs: 100, finishedAt: new Date() } });
    await prisma.testRun.create({ data: { testId: check.id, environmentId: env.id, status: 'FAILED', error: 'boom', durationMs: 200, finishedAt: new Date() } });
    const send = await sendReport(config.id);
    assert.equal(send?.status, 'SENT');
    assert.equal(send?.runCount, 2);
    assert.equal(send?.passed, 1);
    assert.equal(send?.failed, 1);
    const after = await prisma.reportConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.notEqual(after.lastSentAt, null);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('preview forceSend on empty window sends but does not advance lastSentAt or log SKIPPED', async () => {
  const { project, config } = await fixture();
  try {
    const send = await runReport(config.id, { trigger: 'MANUAL', overrideRecipients: ['me@example.com'], forceSend: true });
    assert.equal(send, null); // preview is throwaway: no ReportSend row
    const after = await prisma.reportConfig.findUniqueOrThrow({ where: { id: config.id } });
    assert.equal(after.lastSentAt, null);
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('checkIds filters the window to selected checks', async () => {
  const { project, env, config } = await fixture();
  try {
    const other = await prisma.test.create({ data: { name: 'Other', url: 'https://y.test', projectId: project.id, environmentId: env.id, steps: [] } });
    await prisma.testRun.create({ data: { testId: other.id, environmentId: env.id, status: 'PASSED', durationMs: 50, finishedAt: new Date() } });
    await prisma.reportConfig.update({ where: { id: config.id }, data: { checkIds: ['nonexistent-id'] } });
    const send = await sendReport(config.id);
    assert.equal(send?.status, 'SKIPPED_EMPTY'); // the only run belongs to a non-selected check
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `report-runner.ts`**

Create `backend/src/services/report-runner.ts`:

```typescript
import type { Prisma, ReportSend } from '@prisma/client';
import prisma from '../prisma';
import { summarize, flakyChecks } from './run-stats';
import { sendReportEmail, type ReportDigest } from './mailer';

export async function runReport(
  reportConfigId: string,
  opts: { trigger: 'SCHEDULED' | 'MANUAL'; overrideRecipients?: string[]; forceSend?: boolean }
): Promise<ReportSend | null> {
  const config = await prisma.reportConfig.findUnique({
    where: { id: reportConfigId },
    include: { project: true, environment: true }
  });
  if (!config || !config.enabled) return null;

  const windowStart = config.lastSentAt ?? config.createdAt;
  const windowEnd = new Date();
  const checkIds = (config.checkIds as string[]) ?? [];
  const recipients = opts.overrideRecipients ?? ((config.recipients as string[]) ?? []);
  const isPreview = opts.forceSend === true;

  const where: Prisma.TestRunWhereInput = {
    environmentId: config.environmentId,
    startedAt: { gt: windowStart, lte: windowEnd },
    status: { in: ['PASSED', 'FAILED'] },
    ...(checkIds.length > 0 ? { testId: { in: checkIds } } : {})
  };

  const runs = await prisma.testRun.findMany({
    where,
    select: { status: true, durationMs: true, error: true, testId: true, test: { select: { name: true } } }
  });

  // Empty window: scheduled/send-now skip (log SKIPPED_EMPTY, keep window open);
  // preview forces a render but writes no row and does not advance the cursor.
  if (runs.length === 0 && !isPreview) {
    return prisma.reportSend.create({
      data: {
        reportConfigId: config.id, status: 'SKIPPED_EMPTY', trigger: opts.trigger,
        windowStart, windowEnd, recipients, runCount: 0, passed: 0, failed: 0, passRate: 0
      }
    });
  }

  const stats = summarize(runs);
  const failures = runs
    .filter((r) => r.status === 'FAILED')
    .map((r) => ({ checkName: r.test.name, error: r.error }));
  const flaky = flakyChecks(runs.map((r) => ({ testId: r.testId, testName: r.test.name, status: r.status })))
    .map((f) => ({ checkName: f.testName, passRate: f.passRate }));

  const digest: ReportDigest = {
    projectName: config.project.name, environmentName: config.environment.name, reportName: config.name,
    windowStart, windowEnd, total: stats.total, passed: stats.passed, failed: stats.failed,
    passRate: stats.passRate, avgDurationMs: stats.avgDurationMs, failures, flaky
  };

  let error: string | null = null;
  try {
    for (const to of recipients) await sendReportEmail(to, digest);
  } catch (e) {
    error = e instanceof Error ? e.message : 'send failed';
  }

  if (isPreview) return null; // throwaway: no audit row, no cursor advance

  if (!error) {
    await prisma.reportConfig.update({ where: { id: config.id }, data: { lastSentAt: windowEnd } });
  }

  return prisma.reportSend.create({
    data: {
      reportConfigId: config.id, status: error ? 'FAILED' : 'SENT', trigger: opts.trigger,
      windowStart, windowEnd, recipients, runCount: stats.total, passed: stats.passed,
      failed: stats.failed, passRate: stats.passRate, avgDurationMs: stats.avgDurationMs, error
    }
  });
}

export function sendReport(reportConfigId: string): Promise<ReportSend | null> {
  return runReport(reportConfigId, { trigger: 'SCHEDULED' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-runner.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/report-runner.ts backend/tests/report-runner.test.ts
git commit -m "feat: add report runner with window aggregation and skip-empty"
```

---

### Task 6: Report queue + scheduler + startup wiring

**Files:**
- Create: `backend/src/queue/report-queue.ts`
- Create: `backend/src/services/report-scheduler.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/tests/report-scheduler.test.ts`

**Interfaces:**
- Consumes: `redis` (`../redis`); `sendReport` (Task 5); `prisma`; `ReportConfig` type.
- Produces:
  - `report-queue.ts`: `export const reportQueue: Queue`; `startReportWorker(): void`; `stopReportWorker(): Promise<void>`.
  - `report-scheduler.ts`: `reportScheduler.register(config: ReportConfig): Promise<void>`; `reportScheduler.unregister(id: string): Promise<void>`; `reportScheduler.loadAll(): Promise<void>`; `reportScheduler.stopAll(): void`.
- Consumed by: `index.ts` (startup) and `reports.ts` routes (Task 7).

- [ ] **Step 1: Write `report-queue.ts`**

Create `backend/src/queue/report-queue.ts` (mirrors `schedule-queue.ts`):

```typescript
import { Queue, Worker } from 'bullmq';
import redis from '../redis';
import { sendReport } from '../services/report-runner';

export const reportQueue = new Queue('report-fires', { connection: redis });

let reportWorker: Worker | null = null;

export function startReportWorker(): void {
  reportWorker = new Worker(
    'report-fires',
    async (job) => { await sendReport(job.data.reportConfigId as string); },
    { connection: redis }
  );
  reportWorker.on('failed', (job, err) =>
    console.error(`[ReportWorker] job ${job?.id} (reportConfigId=${job?.data?.reportConfigId}) failed:`, err)
  );
}

export async function stopReportWorker(): Promise<void> {
  await reportWorker?.close();
  reportWorker = null;
}
```

- [ ] **Step 2: Write `report-scheduler.ts`**

Create `backend/src/services/report-scheduler.ts` (mirrors `scheduler.ts`):

```typescript
import type { ReportConfig } from '@prisma/client';
import prisma from '../prisma';
import { reportQueue } from '../queue/report-queue';

class ReportSchedulerService {
  async register(config: ReportConfig): Promise<void> {
    if (!config.enabled) { await this.unregister(config.id); return; }
    await reportQueue.upsertJobScheduler(
      config.id,
      { pattern: config.cron, tz: config.timezone ?? 'UTC' },
      { name: 'fire', data: { reportConfigId: config.id }, opts: { removeOnComplete: true, removeOnFail: 100 } }
    );
  }

  async unregister(id: string): Promise<void> {
    await reportQueue.removeJobScheduler(id).catch(() => undefined);
  }

  stopAll(): void { /* intentional no-op — BullMQ schedulers persist in Redis */ }

  async loadAll(): Promise<void> {
    const configs = await prisma.reportConfig.findMany({ where: { enabled: true } });
    for (const c of configs) await this.register(c);
    console.log(`[ReportScheduler] Loaded ${configs.length} report configs`);
  }
}

export const reportScheduler = new ReportSchedulerService();
```

- [ ] **Step 3: Wire startup and shutdown in `index.ts`**

In `backend/src/index.ts`:
- Add imports near the other queue imports:
  ```typescript
  import { startReportWorker, stopReportWorker, reportQueue } from './queue/report-queue';
  import { reportScheduler } from './services/report-scheduler';
  ```
- After `await schedulerService.loadAll();` (line ~224), add:
  ```typescript
  startReportWorker();
  await reportScheduler.loadAll();
  ```
- In the `shutdown` handler, after `await stopScheduleWorker();` / `await scheduleQueue.close();` add:
  ```typescript
  await stopReportWorker();
  await reportQueue.close();
  ```

- [ ] **Step 4: Write the failing test**

Create `backend/tests/report-scheduler.test.ts` (mirrors `schedule-firing.test.ts`):

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { reportQueue } from '../src/queue/report-queue';
import { reportScheduler } from '../src/services/report-scheduler';

test('register upserts one report job scheduler; unregister removes it', async () => {
  const project = await prisma.project.create({ data: { name: `report-sched-${Date.now()}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  const config = await prisma.reportConfig.create({
    data: { name: 'Nightly', projectId: project.id, environmentId: env.id, cron: '0 8 * * *', timezone: 'UTC' }
  });
  try {
    await reportScheduler.register(config);
    let schedulers = await reportQueue.getJobSchedulers();
    assert.equal(schedulers.filter((s) => s.key === config.id).length, 1);

    await reportScheduler.unregister(config.id);
    schedulers = await reportQueue.getJobSchedulers();
    assert.equal(schedulers.filter((s) => s.key === config.id).length, 0);
  } finally {
    await reportQueue.removeJobScheduler(config.id).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await reportQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 5: Run the test**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/report-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd backend && pnpm build`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/queue/report-queue.ts backend/src/services/report-scheduler.ts backend/src/index.ts backend/tests/report-scheduler.test.ts
git commit -m "feat: add report queue, scheduler, and startup wiring"
```

---

### Task 7: Reports API routes

**Files:**
- Create: `backend/src/routes/reports.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/tests/reports-routes.test.ts`

**Interfaces:**
- Consumes: `getAuthUser`, `requireScope`, `getProjectAccessStatusCode` (`../utils/project-access`); `reportScheduler` (Task 6); `runReport` (Task 5); `prisma`.
- Produces route `reportRoutes(fastify)`:
  - `GET  /projects/:projectId/reports` — `reports_read`
  - `POST /projects/:projectId/reports` — `reports_edit`; registers scheduler
  - `PATCH /reports/:id` — `reports_edit`; re-registers (or unregisters if now disabled)
  - `DELETE /reports/:id` — `reports_edit`; unregisters
  - `POST /reports/:id/send-now` — `reports_edit`; `runReport(id, { trigger: 'MANUAL' })`
  - `POST /reports/:id/preview` — `reports_edit`; `runReport(id, { trigger: 'MANUAL', overrideRecipients: [<caller email>], forceSend: true })`
  - `GET  /reports/:id/sends` — `reports_read`; newest-first, capped at 50

- [ ] **Step 1: Write the failing test**

Create `backend/tests/reports-routes.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST;
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { joinProject } from './helpers/rbac';
import { reportQueue } from '../src/queue/report-queue';
import { reportRoutes } from '../src/routes/reports';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(reportRoutes);
  return app;
}

async function access(group: 'OWNER' | 'VIEWER' = 'OWNER') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { email: `reports-${suffix}@example.com`, passwordHash: 'x' } });
  const project = await prisma.project.create({ data: { name: `Reports ${suffix}` } });
  const env = await prisma.environment.create({ data: { name: 'staging', projectId: project.id } });
  await joinProject(project.id, user.id, group);
  return { user, project, env };
}

test('create → list → send-now → sends history', async () => {
  const { user, project, env } = await access('OWNER');
  const app = await buildApp(user.id, user.email);
  try {
    const create = await app.inject({
      method: 'POST', url: `/projects/${project.id}/reports`,
      payload: { name: 'Nightly', environmentId: env.id, cron: '0 8 * * *', recipients: ['ops@example.com'], checkIds: [] }
    });
    assert.equal(create.statusCode, 201);
    const id = create.json().id as string;

    const list = await app.inject({ method: 'GET', url: `/projects/${project.id}/reports` });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().length, 1);

    const send = await app.inject({ method: 'POST', url: `/reports/${id}/send-now`, payload: {} });
    assert.equal(send.statusCode, 200);
    assert.equal(send.json().status, 'SKIPPED_EMPTY'); // no runs yet

    const sends = await app.inject({ method: 'GET', url: `/reports/${id}/sends` });
    assert.equal(sends.statusCode, 200);
    assert.equal(sends.json().length, 1);
  } finally {
    await reportQueue.removeJobScheduler(create ? create.json().id : '').catch(() => undefined);
    await app.close();
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await reportQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('viewer cannot create a report (403)', async () => {
  const { user, project, env } = await access('VIEWER');
  const app = await buildApp(user.id, user.email);
  try {
    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/reports`,
      payload: { name: 'Nightly', environmentId: env.id, cron: '0 8 * * *', recipients: [], checkIds: [] }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await reportQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

> Note: the `create` reference in the first test's `finally` is defined inside the `try`; hoist `let create;` above the `try` when implementing so the cleanup can read the created id. (Kept inline here for readability.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/reports-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reports.ts`**

Create `backend/src/routes/reports.ts`:

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireScope } from '../utils/project-access';
import { reportScheduler } from '../services/report-scheduler';
import { runReport } from '../services/report-runner';

const CreateSchema = z.object({
  name: z.string().min(1),
  environmentId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1).optional(),
  recipients: z.array(z.string().email()).default([]),
  checkIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true)
});

const UpdateSchema = CreateSchema.partial();

export async function reportRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/reports', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireScope(req.params.projectId, userId, 'reports_read');
      return await prisma.reportConfig.findMany({
        where: { projectId: req.params.projectId }, orderBy: { createdAt: 'asc' }
      });
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/reports', async (req, reply) => {
    const result = CreateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const { userId } = getAuthUser(req);
    try {
      await requireScope(req.params.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const config = await prisma.reportConfig.create({
      data: { ...result.data, projectId: req.params.projectId }
    });
    await reportScheduler.register(config);
    return reply.status(201).send(config);
  });

  fastify.patch<{ Params: { id: string } }>('/reports/:id', async (req, reply) => {
    const result = UpdateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) return reply.status(404).send({ error: 'Report not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const config = await prisma.reportConfig.update({ where: { id: req.params.id }, data: result.data });
    await reportScheduler.register(config); // register() unregisters when enabled === false
    return config;
  });

  fastify.delete<{ Params: { id: string } }>('/reports/:id', async (req, reply) => {
    try {
      const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      const { userId } = getAuthUser(req);
      await requireScope(existing.projectId, userId, 'reports_edit');
      await reportScheduler.unregister(req.params.id);
      await prisma.reportConfig.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Not found' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/reports/:id/send-now', async (req, reply) => {
    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const { userId } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    const send = await runReport(req.params.id, { trigger: 'MANUAL' });
    return reply.send(send);
  });

  fastify.post<{ Params: { id: string } }>('/reports/:id/preview', async (req, reply) => {
    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const { userId, email } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_edit');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    await runReport(req.params.id, { trigger: 'MANUAL', overrideRecipients: [email], forceSend: true });
    return reply.send({ ok: true, previewedTo: email });
  });

  fastify.get<{ Params: { id: string } }>('/reports/:id/sends', async (req, reply) => {
    const existing = await prisma.reportConfig.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const { userId } = getAuthUser(req);
    try {
      await requireScope(existing.projectId, userId, 'reports_read');
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    return prisma.reportSend.findMany({
      where: { reportConfigId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 50
    });
  });
}
```

> `getAuthUser` returns `{ userId, email }` — confirm the `email` field is present (it is set from the JWT payload); the preview endpoint relies on it.

- [ ] **Step 4: Register the route in `index.ts`**

In `backend/src/index.ts`, add `import { reportRoutes } from './routes/reports';` with the other route imports, and `await fastify.register(reportRoutes);` alongside the other `fastify.register(...Routes)` calls.

- [ ] **Step 5: Run the test**

Run: `cd backend && dotenv -e ../.env -- tsx --test tests/reports-routes.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Typecheck**

Run: `cd backend && pnpm build`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/index.ts backend/tests/reports-routes.test.ts
git commit -m "feat: add reports API routes with scope gating"
```

---

### Task 8: Frontend types + API client

**Files:**
- Modify: `frontend/src/types/index.ts` (or the file where `Environment`/`Schedule` types live — grep first)
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces (TypeScript types + client fns):
  - `type ReportConfig = { id: string; name: string; projectId: string; environmentId: string; cron: string; timezone: string | null; recipients: string[]; checkIds: string[]; enabled: boolean; lastSentAt: string | null; createdAt: string; updatedAt: string }`
  - `type ReportSend = { id: string; reportConfigId: string; status: 'SENT' | 'SKIPPED_EMPTY' | 'FAILED'; trigger: 'SCHEDULED' | 'MANUAL'; windowStart: string; windowEnd: string; recipients: string[]; runCount: number; passed: number; failed: number; passRate: number; avgDurationMs: number | null; error: string | null; createdAt: string }`
  - `type ReportConfigPayload = { name: string; environmentId: string; cron: string; timezone?: string; recipients: string[]; checkIds: string[]; enabled?: boolean }`
  - `getReports(projectId)`, `createReport(projectId, payload)`, `updateReport(id, payload)`, `deleteReport(id)`, `sendReportNow(id)`, `previewReport(id)`, `getReportSends(id)`
- Consumed by: Task 9 UI.

- [ ] **Step 1: Locate the types file**

Run: `grep -rn "export type Environment" frontend/src/types`
Confirm the file (expected `frontend/src/types/index.ts`).

- [ ] **Step 2: Add the types**

Add `ReportConfig`, `ReportSend`, `ReportConfigPayload` (signatures above) to the types file.

- [ ] **Step 3: Add client functions**

In `frontend/src/api/client.ts`, import the new types and add:

```typescript
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
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && pnpm build`
Expected: build succeeds (types resolve, no unused-import errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types frontend/src/api/client.ts
git commit -m "feat: add report API client and types"
```

---

### Task 9: Frontend Reports tab (config CRUD, recipients chip, send/preview, history)

**Files:**
- Create: `frontend/src/pages/ProjectPage/components/tabs/ReportsTab.tsx`
- Create: `frontend/src/pages/ProjectPage/components/modals/ReportModal.tsx`
- Modify: `frontend/src/pages/ProjectPage/index.tsx` (register the tab + nav entry — grep for how `EnvironmentsTab`/`SchedulesTab` are registered)

**Interfaces:**
- Consumes: client fns + types (Task 8); `getEnvironments`, `getTests`, `getUsers` (existing client fns) for the environment selector, check multiselect, and recipient suggestions; the project scope helper `can('reports_read'|'reports_edit')` used elsewhere in `ProjectPage`.
- Produces: a "Reports" tab in `ProjectPage`, gated on `can('reports_read')`; create/edit/delete gated on `can('reports_edit')`.

- [ ] **Step 1: Find the tab registration pattern**

Run: `grep -rn "EnvironmentsTab\|SchedulesTab\|activeTab\|can('" frontend/src/pages/ProjectPage/index.tsx`
Note how tabs are declared, how `can(scope)` is obtained, and how a tab component receives `projectId`.

- [ ] **Step 2: Build `ReportModal.tsx`**

Create the modal mirroring `ChannelModal.tsx`/`EnvironmentModal.tsx` conventions (same form/props/close pattern). It must include:
- `name` text input.
- Environment `<select>` populated from `getEnvironments(projectId)`.
- Cron + timezone inputs — reuse `frontend/src/utils/scheduleTimezone.ts` and the `ScheduleFormModal.tsx` cron field pattern.
- Check multiselect from `getTests(projectId)` filtered to the chosen environment; empty selection ⇒ `checkIds: []` (= all).
- Recipients chip input: free-text email entry (Enter/comma to add, validated as email); as the user types, suggest matches from `getUsers()` (best-effort — if the request 403s, silently fall back to free entry). A recipient that matches a known user renders as a pill showing the user's email/name; a non-user renders as a plain email pill. Both are stored identically as the email string in `recipients`.
- Submit calls `createReport`/`updateReport` via TanStack Query mutations (invalidate the reports query on success), following the mutation pattern already used in the sibling modals.

- [ ] **Step 3: Build `ReportsTab.tsx`**

Create the tab mirroring `SchedulesTab.tsx`:
- `useQuery` on `getReports(projectId)` — list each report (name, environment name, cron, recipient count, `lastSentAt`, enabled toggle).
- "New report" button (gated on `can('reports_edit')`) opens `ReportModal`.
- Per row: Edit (gated), Delete (gated, `deleteReport` mutation), **Send now** (`sendReportNow`, gated), **Preview** (`previewReport`, gated), and an expandable **History** panel that `useQuery`s `getReportSends(id)` and lists sends (createdAt, status badge, window, runCount, passRate, recipient count).
- Show a toast/inline note on send-now: `SENT` → "sent", `SKIPPED_EMPTY` → "no runs in window", `FAILED` → the error.

- [ ] **Step 4: Register the tab in `ProjectPage`**

Add "Reports" to the tab list and route it to `ReportsTab`, gated so it only appears when `can('reports_read')` is true — matching the gating used for the existing tabs found in Step 1.

- [ ] **Step 5: Typecheck / build**

Run: `cd frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Bring up the stack (`pnpm dev` or the Docker debug stack). As an OWNER/EDITOR user:
1. Open a project → **Reports** tab → create a report against an environment with a cron, 2 recipients (one a platform user, one external), and no checks selected.
2. Confirm it lists with the right environment + recipient count.
3. Click **Preview** → confirm the backend logs a digest email to your own address (jsonTransport in dev) and no `ReportSend` row is added.
4. Click **Send now** with no recent runs → expect a "no runs in window" result and a `SKIPPED_EMPTY` row in History.
5. Trigger a run against that environment, then **Send now** → expect `SENT` in History with correct counts.
6. Log in as a VIEWER → confirm the Reports tab is read-only (no New/Edit/Delete/Send).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ProjectPage
git commit -m "feat: add Reports tab with config CRUD, send/preview, and history"
```

---

## Self-Review

**Spec coverage:**
- Standalone `ReportConfig` own cron → Task 1, 6, 7. ✓
- Selectable check subset (empty = all) → Task 1 (`checkIds`), Task 5 (filter), Task 9 (multiselect). ✓
- Free-form email recipients, UI resolves user vs external pill → Task 1 (`recipients`), Task 9 (chip). ✓
- Window since last send → Task 5 (`lastSentAt ?? createdAt`). ✓
- Empty window → skip, keep open → Task 5 (`SKIPPED_EMPTY`, no cursor advance). ✓
- Send-now + preview-to-self → Task 5 (`runReport`), Task 7 (routes), Task 9 (buttons). ✓
- `reports_read`/`reports_edit` scopes + seed → Task 1, 2; enforced Task 7; gated Task 9. ✓
- Aggregation service (extract from dashboard) → Task 3. ✓
- Digest content (pass rate, failures, flaky, avg duration) → Task 4 + Task 5. ✓
- Report-send history model + endpoint + UI → Task 1 (`ReportSend`), Task 7 (`GET /sends`), Task 9 (History panel). ✓
- Out of scope (CSV, unsubscribe) → not implemented, per spec. ✓

**Type consistency:** `runReport`/`sendReport` signatures match between Task 5 (definition), Task 6 (queue), and Task 7 (routes). `ReportDigest` defined in Task 4, consumed in Task 5. `summarize`/`flakyChecks` defined in Task 3, consumed in Task 5. Client fn names in Task 8 match usage in Task 9. ✓

**Known follow-up (not blocking):** the `dashboard.ts` `flakyChecks`/`activeIssues` blocks keep their richer dashboard-only shape and are intentionally not migrated to `run-stats.flakyChecks` in Task 3 (different output fields); only `summarize` is shared. This is deliberate, not a gap.
