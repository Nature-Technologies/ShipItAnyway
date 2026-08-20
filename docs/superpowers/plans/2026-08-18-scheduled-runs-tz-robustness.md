# Scheduled Runs: Timezone & Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled test runs timezone-correct, explicitly triggered, schedule-linkable on manual fire, meaningful for data-driven tests, and restart/HA-safe by moving firing from in-memory `node-cron` to BullMQ Job Schedulers.

**Architecture:** Keep BullMQ/Redis execution. Add an optional per-schedule IANA timezone; pin the container to UTC so the default is deterministic. Store the run trigger as a column instead of inferring it. Add a schedule-scoped run endpoint. Reuse the existing `TestRunBatch` path so a scheduled data-driven test runs every enabled data row. Replace `node-cron` with BullMQ Job Schedulers (one scheduler per schedule) for restart-safe, deduped firing.

**Tech Stack:** Fastify 5, Prisma (PostgreSQL), BullMQ 5.76 + ioredis, `cron-parser` 4, Zod, React + Ant Design, TypeScript. Tests: `node:test` + `node:assert/strict` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-18-scheduled-runs-tz-robustness.md`

## Global Constraints

- Node 22 (backend), TypeScript strict. Prisma migrations are timestamped dirs `<YYYYMMDDHHMMSS>_<snake_case>/migration.sql`; boot runs `prisma migrate deploy` (`backend/Dockerfile:25`).
- All stored datetimes are and stay UTC. Only a schedule's firing rule carries an optional timezone.
- Run tests with `cd backend && npx dotenv -e ../.env -- tsx --test tests/<file>.test.ts` (backend) and `cd frontend && npx tsx --test tests/<file>.test.ts` (frontend). Backend integration tests require the compose `db` + `redis` services running.
- Run enqueues MUST go through `enqueueTestRun` (`backend/src/queue/batch-sequencer.ts`) for a deterministic `test-run-<id>` jobId.
- `bullmq@^5.76` and `cron-parser@^4.9` are already installed. Branding stays "ShipItAnyway".

---

### Task 1: Pin the backend container to UTC

**Files:**
- Modify: `backend/Dockerfile` (add `ENV TZ=UTC` before the `CMD`)
- Modify: `docker-compose.override.yml` (add `TZ: UTC` to the `x-backend-env` anchor, ~lines 12-27)

**Interfaces:**
- Produces: guaranteed `process.env.TZ === 'UTC'` at runtime, so an unset `Schedule.timezone` fires in UTC.

- [ ] **Step 1: Add `ENV TZ=UTC` to the Dockerfile**

In `backend/Dockerfile`, immediately above the final `CMD` line: `ENV TZ=UTC`

- [ ] **Step 2: Add `TZ` to the compose backend env anchor**

In `docker-compose.override.yml`, inside the `x-backend-env` mapping: `TZ: UTC`

- [ ] **Step 3: Verify the config resolves**

Run: `docker compose config | grep -i "TZ"`
Expected: `TZ: UTC` under the backend service environment.

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile docker-compose.override.yml
git commit -m "chore: pin backend container to TZ=UTC for deterministic scheduling"
```

> No unit test: config-only change; verification is the `docker compose config` check.

---

### Task 2: Add `Schedule.timezone` and a validation helper; tz-aware next-run display

**Files:**
- Modify: `backend/prisma/schema.prisma` (Schedule model, ~line 107)
- Create: `backend/prisma/migrations/<new-timestamp>_add_schedule_timezone/migration.sql`
- Create: `backend/src/utils/timezone.ts`
- Modify: `backend/src/routes/schedules.ts` (Zod schemas ~9-27; `getNextRunAt` ~100-109; list route ~150-152)
- Test: `backend/tests/schedule-timezone.test.ts`

**Interfaces:**
- Produces:
  - `isValidTimezone(tz: string): boolean`
  - `getNextRunAt(cron: string, referenceDate: Date, timezone?: string | null): Date | null` (extended signature)
  - `Schedule.timezone: string | null` on the model and API responses.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/schedule-timezone.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidTimezone } from '../src/utils/timezone';
import { getNextRunAt } from '../src/routes/schedules';

test('isValidTimezone accepts IANA zones and rejects junk', () => {
  assert.equal(isValidTimezone('America/New_York'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Mars/Phobos'), false);
  assert.equal(isValidTimezone(''), false);
});

test('getNextRunAt honours the schedule timezone (DST-correct)', () => {
  const ref = new Date('2026-07-01T00:00:00.000Z'); // summer → EDT (UTC-4)
  const nextNy = getNextRunAt('0 9 * * *', ref, 'America/New_York');
  const nextUtc = getNextRunAt('0 9 * * *', ref, null);
  assert.ok(nextNy && nextUtc);
  assert.equal(nextNy!.getUTCHours(), 13);
  assert.equal(nextUtc!.getUTCHours(), 9);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-timezone.test.ts`
Expected: FAIL — `isValidTimezone` not exported / `getNextRunAt` arity mismatch.

- [ ] **Step 3: Create the timezone helper**

Create `backend/src/utils/timezone.ts`:

```ts
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Extend `getNextRunAt`**

In `backend/src/routes/schedules.ts`, replace `getNextRunAt` (~100-109) with (keep `export`):

```ts
import { parseExpression } from 'cron-parser';

export function getNextRunAt(
  cronExpression: string, referenceDate: Date, timezone?: string | null
): Date | null {
  try {
    return parseExpression(cronExpression, { currentDate: referenceDate, tz: timezone ?? 'UTC' })
      .next().toDate();
  } catch {
    return null;
  }
}
```

Update the list route (~150-152) to pass `schedule.timezone` as the 3rd arg.

- [ ] **Step 5: Add the column**

In `model Schedule` after `enabled`: `timezone      String?`

- [ ] **Step 6: Create the migration**

Run: `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name add_schedule_timezone`
Expected: `ALTER TABLE "Schedule" ADD COLUMN "timezone" TEXT;` + client regenerated.

- [ ] **Step 7: Accept + validate `timezone` in Zod**

Add to `ScheduleSchema` (~9-18) and `UpdateScheduleSchema` (~20-27), importing `isValidTimezone`:

```ts
timezone: z.string().refine(isValidTimezone, 'Invalid IANA timezone').optional().nullable(),
```

Persist `timezone` through `prisma.schedule.create/update`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-timezone.test.ts`
Expected: PASS.

> The firing engine consumes `timezone` in Task 7 (BullMQ scheduler `tz`), not here.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma backend/src/utils/timezone.ts backend/src/routes/schedules.ts backend/tests/schedule-timezone.test.ts
git commit -m "feat(schedules): optional per-schedule IANA timezone + tz-aware next-run"
```

---

### Task 3: Explicit `trigger` column on `TestRun`

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `enum RunTrigger`; `TestRun.trigger`)
- Create: `backend/prisma/migrations/<new-timestamp>_add_test_run_trigger/migration.sql` (with backfill)
- Modify: `backend/src/routes/runs.ts` (run creation ~95; all-cases ~113)
- Modify: `backend/src/routes/dashboard.ts` (`getTriggerLabel` ~41-43; filter builder ~111-114)
- Modify: `frontend/src/types/index.ts` (`DashboardRecentRun.trigger` union ~179)
- Test: `backend/tests/run-trigger.test.ts`

**Interfaces:**
- Produces: `TestRun.trigger: 'MANUAL' | 'SCHEDULE' | 'CI'` on every run and in API responses.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/run-trigger.test.ts` (copy the `buildApp`/`createProjectAccess`/`cleanup` helpers from `data-case-run.test.ts`, register `runRoutes`):

```ts
test('manual run is created with trigger MANUAL', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    const t = await prisma.test.create({
      data: { name: 'x', url: 'https://example.com', projectId: project.id,
        steps: [{ action: 'goto', value: 'https://example.com' }] }
    });
    const res = await app.inject({ method: 'POST', url: `/tests/${t.id}/run`, payload: {} });
    assert.equal(res.statusCode, 202);
    const run = await prisma.testRun.findUnique({ where: { id: res.json().testRunId } });
    assert.equal(run?.trigger, 'MANUAL');
  } finally {
    await app.close(); await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/run-trigger.test.ts`
Expected: FAIL — `trigger` unknown field.

- [ ] **Step 3: Add the enum + column**

In `schema.prisma`:

```prisma
enum RunTrigger {
  MANUAL
  SCHEDULE
  CI
}
```

In `model TestRun` after `status`: `trigger     RunTrigger @default(MANUAL)`

- [ ] **Step 4: Create the migration with backfill**

Run: `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name add_test_run_trigger`
Add to the generated `migration.sql` after the `ADD COLUMN`:

```sql
UPDATE "TestRun" SET "trigger" = 'SCHEDULE' WHERE "scheduleId" IS NOT NULL;
```

Apply the edited SQL against the dev DB (`prisma migrate dev` again picks up the edit only if unapplied; if already applied, run the `UPDATE` once manually). On prod, `migrate deploy` applies it.

- [ ] **Step 5: Set `trigger` at every creation site**

- `backend/src/routes/runs.ts`: add `trigger: 'MANUAL'` to both `prisma.testRun.create` data (single ~95, all-cases ~113).
- Scheduler-created runs get `trigger: 'SCHEDULE'` — handled in Task 4's `fireSchedule`.

- [ ] **Step 6: Read the column in the dashboard**

In `backend/src/routes/dashboard.ts`: `getTriggerLabel` (~41-43) →
`run.trigger === 'SCHEDULE' ? 'Schedule' : run.trigger === 'CI' ? 'CI' : 'Manual'`; filter builder
(~111-114) → filter on `trigger` equality (`manual → { trigger: 'MANUAL' }`, `schedule → { trigger: 'SCHEDULE' }`); ensure `trigger` is selected. Add `'CI'` to `DashboardRecentRun.trigger` in the frontend types.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/run-trigger.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma backend/src/routes/runs.ts backend/src/routes/dashboard.ts frontend/src/types/index.ts backend/tests/run-trigger.test.ts
git commit -m "feat(runs): store explicit run trigger (Manual/Schedule/CI)"
```

---

### Task 4: Extract `fireSchedule` + schedule-scoped "run now"

**Files:**
- Create: `backend/src/services/schedule-runner.ts`
- Modify: `backend/src/routes/schedules.ts` (add `POST /schedules/:id/run`)
- Modify: `frontend/src/pages/SchedulesPage.tsx` ("Run now" ~265-280)
- Modify: `frontend/src/api/client.ts` (add `runSchedule`)
- Test: `backend/tests/schedule-run-now.test.ts`

**Interfaces:**
- Consumes: `enqueueTestRun` (`batch-sequencer.ts`), `RunTrigger` (Task 3), `requireProjectRole`.
- Produces:
  - `fireSchedule(scheduleId: string, opts?: { trigger?: RunTrigger }): Promise<{ runIds: string[]; batchId?: string }>` — resolves the schedule's target test(s) (suite expansion), creates `TestRun`(s) with `scheduleId`/`environmentId`/`trigger` (default `'SCHEDULE'`), enqueues via `enqueueTestRun`, updates `lastRunAt`. (Data-driven branch added in Task 5.)
  - `POST /schedules/:id/run` → `202 { runIds, batchId? }`; `runSchedule(id)` client method.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/schedule-run-now.test.ts` (reuse harness helpers; register `scheduleRoutes`):

```ts
test('POST /schedules/:id/run creates a run linked to the schedule', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    await testQueue.pause();
    const t = await prisma.test.create({
      data: { name: 'x', url: 'https://example.com', projectId: project.id,
        steps: [{ action: 'goto', value: 'https://example.com' }] }
    });
    const schedule = await prisma.schedule.create({
      data: { name: 's', cron: '0 9 * * *', projectId: project.id, testId: t.id }
    });
    const res = await app.inject({ method: 'POST', url: `/schedules/${schedule.id}/run`, payload: {} });
    assert.equal(res.statusCode, 202);
    const run = await prisma.testRun.findUnique({ where: { id: res.json().runIds[0] } });
    assert.equal(run?.scheduleId, schedule.id);
  } finally {
    await testQueue.resume().catch(() => undefined);
    await app.close(); await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-run-now.test.ts`
Expected: FAIL — 404, route not registered.

- [ ] **Step 3: Implement `fireSchedule`**

Create `backend/src/services/schedule-runner.ts`. Move the run-creation logic currently inline in
`scheduler.ts` here: load schedule + target(s) (suite → spread `suite.testIds`, else single `testId`),
for each create a `PENDING` `TestRun` with `scheduleId`, `environmentId`, `trigger` (from `opts.trigger
?? 'SCHEDULE'`), `enqueueTestRun` it, then `prisma.schedule.update({ lastRunAt: new Date() })`. Return
`{ runIds }`.

- [ ] **Step 4: Register the route**

In `backend/src/routes/schedules.ts`:

```ts
fastify.post<{ Params: { id: string } }>('/schedules/:id/run', async (req, reply) => {
  const schedule = await loadScheduleOr404(req.params.id, reply);
  if (!schedule) return;
  await requireProjectRole(schedule.projectId, req.user.userId, ['OWNER', 'EDITOR']);
  return reply.code(202).send(await fireSchedule(schedule.id, { trigger: 'MANUAL' }));
});
```

- [ ] **Step 5: Wire the frontend "Run now"**

In `SchedulesPage.tsx` (~265-280) replace the generic run calls with `await runSchedule(schedule.id)`
then navigate to `/schedules/${schedule.id}/history`. Add
`runSchedule = (id: string) => api.post('/schedules/' + id + '/run')` to `api/client.ts`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-run-now.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/schedule-runner.ts backend/src/routes/schedules.ts frontend/src/pages/SchedulesPage.tsx frontend/src/api/client.ts backend/tests/schedule-run-now.test.ts
git commit -m "feat(schedules): fireSchedule service + schedule-scoped run-now"
```

---

### Task 5: Data-driven schedules run every enabled data row

**Files:**
- Modify: `backend/src/services/schedule-runner.ts` (data-driven branch)
- Test: `backend/tests/schedule-data-driven.test.ts`

**Interfaces:**
- Consumes: existing batch creation (`prisma.testRunBatch.create` + `enqueueTestRun` of the first case, per `runs.ts` all-cases), `hasTestDataCases` + `DATA_DRIVEN_CASE_REQUIRED_ERROR` (`backend/src/utils/test-data`).
- Produces: `fireSchedule` returns `{ runIds, batchId }` for data-driven targets with ≥1 enabled case.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/schedule-data-driven.test.ts` (reuse harness). Create a schedule whose test has
two enabled data cases; `await testQueue.pause()`; call `fireSchedule(schedule.id)` directly; assert a
`TestRunBatch` with `totalCases: 2`, two runs with that `batchId` and `scheduleId`, ordered by
`batchOrder`; drain in `finally`.

```ts
import { fireSchedule } from '../src/services/schedule-runner';
// ...
const result = await fireSchedule(schedule.id);
assert.ok(result.batchId);
const runs = await prisma.testRun.findMany({ where: { batchId: result.batchId! }, orderBy: { batchOrder: 'asc' } });
assert.equal(runs.length, 2);
assert.deepEqual(runs.map(r => r.scheduleId), [schedule.id, schedule.id]);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-data-driven.test.ts`
Expected: FAIL — no batch (current code writes one FAILED row).

- [ ] **Step 3: Implement batch expansion**

In `fireSchedule`, for each target test where `hasTestDataCases(test.testData)`:
- Collect enabled cases (index + snapshot), mirroring `runs.ts` all-cases.
- **Zero enabled cases:** keep one `FAILED` `TestRun` with `DATA_DRIVEN_CASE_REQUIRED_ERROR` (+ `scheduleId`/`trigger`).
- **≥1:** create a `TestRunBatch` (`testId`, `environmentId`, `totalCases`, `status: 'PENDING'`), one
  `PENDING` `TestRun` per enabled case (`batchId`, `batchOrder`, `dataCase*`, `scheduleId`, `trigger`),
  enqueue only the first via `enqueueTestRun` (the sequencer chains the rest). Return `{ runIds, batchId }`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-data-driven.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/schedule-runner.ts backend/tests/schedule-data-driven.test.ts
git commit -m "feat(schedules): scheduled data-driven tests run every enabled data row as a batch"
```

---

### Task 6: Migrate firing from node-cron to BullMQ Job Schedulers

**Files:**
- Create: `backend/src/queue/schedule-queue.ts` (BullMQ `Queue` + fire `Worker`)
- Rewrite: `backend/src/services/scheduler.ts` (`register`/`unregister`/`loadAll` use job schedulers, no node-cron)
- Modify: `backend/src/index.ts` (start the fire worker at boot ~203-204)
- Modify: `backend/src/routes/schedules.ts` (create/update/delete already call `schedulerService.register/unregister` — keep those calls; their bodies change)
- Test: `backend/tests/schedule-firing.test.ts`
- Modify: `backend/package.json` (remove `node-cron` + `@types/node-cron` if nothing else imports them — verify first)

**Interfaces:**
- Consumes: `redis` (`backend/src/redis`), `fireSchedule` (Task 4), `Schedule` rows.
- Produces:
  - `scheduleQueue: Queue` (name `schedule-fires`) and `startScheduleWorker(): Worker`.
  - `schedulerService.register(schedule)` → `scheduleQueue.upsertJobScheduler(schedule.id, { pattern: schedule.cron, tz: schedule.timezone ?? 'UTC' }, { name: 'fire', data: { scheduleId: schedule.id } })` when enabled; unregister when disabled.
  - `schedulerService.unregister(id)` → `scheduleQueue.removeJobScheduler(id)`.
  - `schedulerService.loadAll()` → upsert a scheduler for every enabled schedule (idempotent).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/schedule-firing.test.ts` (reuse harness). Verify registration creates exactly one
job scheduler and unregister removes it — deterministic, no waiting on wall-clock ticks:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { scheduleQueue } from '../src/queue/schedule-queue';
import { schedulerService } from '../src/services/scheduler';

test('register upserts one job scheduler; unregister removes it', async () => {
  const project = await prisma.project.create({ data: { name: `firing-${Date.now()}` } });
  const t = await prisma.test.create({
    data: { name: 'x', url: 'https://example.com', projectId: project.id, steps: [] }
  });
  const schedule = await prisma.schedule.create({
    data: { name: 's', cron: '0 9 * * *', projectId: project.id, testId: t.id, timezone: 'UTC' }
  });
  try {
    await schedulerService.register(schedule);
    let schedulers = await scheduleQueue.getJobSchedulers();
    assert.equal(schedulers.filter(s => s.key === schedule.id).length, 1);

    await schedulerService.unregister(schedule.id);
    schedulers = await scheduleQueue.getJobSchedulers();
    assert.equal(schedulers.filter(s => s.key === schedule.id).length, 0);
  } finally {
    await scheduleQueue.removeJobScheduler(schedule.id).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await scheduleQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-firing.test.ts`
Expected: FAIL — `schedule-queue` module missing / `register` still uses node-cron.

- [ ] **Step 3: Create the schedule queue + fire worker**

Create `backend/src/queue/schedule-queue.ts`:

```ts
import { Queue, Worker } from 'bullmq';
import redis from '../redis';
import { fireSchedule } from '../services/schedule-runner';

export const scheduleQueue = new Queue('schedule-fires', { connection: redis });

export function startScheduleWorker(): Worker {
  return new Worker(
    'schedule-fires',
    async (job) => { await fireSchedule(job.data.scheduleId as string); },
    { connection: redis }
  );
}
```

- [ ] **Step 4: Rewrite `scheduler.ts` around job schedulers**

Replace the node-cron `SchedulerService` with:

```ts
import type { Schedule } from '@prisma/client';
import prisma from '../prisma';
import { scheduleQueue } from '../queue/schedule-queue';

class SchedulerService {
  async register(schedule: Schedule): Promise<void> {
    if (!schedule.enabled) { await this.unregister(schedule.id); return; }
    await scheduleQueue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cron, tz: schedule.timezone ?? 'UTC' },
      { name: 'fire', data: { scheduleId: schedule.id } }
    );
  }
  async unregister(id: string): Promise<void> {
    await scheduleQueue.removeJobScheduler(id).catch(() => undefined);
  }
  async loadAll(): Promise<void> {
    const schedules = await prisma.schedule.findMany({ where: { enabled: true } });
    for (const s of schedules) await this.register(s);
  }
}

export const schedulerService = new SchedulerService();
```

(The `register`/`unregister` calls in `schedules.ts` create/update/delete routes now `await` these
async methods — add `await` where missing. `cron.validate` in the routes stays for input validation;
import it from `node-cron` only if still needed, otherwise validate with `cron-parser` try/catch.)

- [ ] **Step 5: Start the fire worker at boot**

In `backend/src/index.ts`, alongside `startTestWorker()` (~203), add `startScheduleWorker();` then keep
`await schedulerService.loadAll();` (~204) so schedulers are upserted on boot (idempotent; restart-safe).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/schedule-firing.test.ts`
Expected: PASS.

- [ ] **Step 7: Remove node-cron if unused**

Run: `grep -rn "node-cron" backend/src` — if only `scheduler.ts` referenced it (now gone) and the
routes no longer need `cron.validate`, remove `node-cron` + `@types/node-cron` from
`backend/package.json` and `pnpm install`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/queue/schedule-queue.ts backend/src/services/scheduler.ts backend/src/index.ts backend/src/routes/schedules.ts backend/package.json backend/tests/schedule-firing.test.ts
git commit -m "feat(schedules): fire via BullMQ Job Schedulers (restart-safe, deduped) instead of node-cron"
```

---

### Task 7: Frontend timezone picker + tz-aware display

**Files:**
- Create: `frontend/src/utils/scheduleTimezone.ts`
- Test: `frontend/tests/schedule-timezone.test.ts`
- Modify: `frontend/src/types/index.ts` (`Schedule` type ~287-303 — add `timezone?: string | null`)
- Modify: `frontend/src/api/client.ts` (create/update payloads include `timezone`)
- Modify: `frontend/src/pages/SchedulesPage.tsx` (form state ~155-163; modal ~520-666; next-run/desc rendering)

**Interfaces:**
- Consumes: `Schedule.timezone` (Task 2).
- Produces: `resolveScheduleTimezone(schedule: { timezone?: string | null }): string` → the zone or `'UTC'`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/schedule-timezone.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveScheduleTimezone } from '../src/utils/scheduleTimezone';

test('resolveScheduleTimezone falls back to UTC when unset', () => {
  assert.equal(resolveScheduleTimezone({ timezone: null }), 'UTC');
  assert.equal(resolveScheduleTimezone({}), 'UTC');
  assert.equal(resolveScheduleTimezone({ timezone: 'Asia/Kolkata' }), 'Asia/Kolkata');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx tsx --test tests/schedule-timezone.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/utils/scheduleTimezone.ts`:

```ts
export function resolveScheduleTimezone(schedule: { timezone?: string | null }): string {
  return schedule.timezone ?? 'UTC';
}
export const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx tsx --test tests/schedule-timezone.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire type + payloads + picker**

Add `timezone?: string | null` to the `Schedule` type and create/update payload types. In
`SchedulesPage.tsx`: add `selectedTimezone` state (default schedule's value or `'UTC'`), render an AntD
`<Select showSearch>` from `Intl.supportedValuesOf('timeZone')` in the modal, include
`timezone: selectedTimezone` in create/update, and format next-run/description with
`resolveScheduleTimezone(row)` (pass `{ timeZone }` to `toLocaleString`). Replace the cosmetic
`APP_TIMEZONE` tag (~23/571) with the selected zone.

- [ ] **Step 6: Manually verify in the running app**

Create a schedule with a non-UTC zone; confirm "Next Run" reads in that zone and the value round-trips
on edit; confirm it fires at the tz-correct UTC instant (Task 6).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/scheduleTimezone.ts frontend/tests/schedule-timezone.test.ts frontend/src/types/index.ts frontend/src/api/client.ts frontend/src/pages/SchedulesPage.tsx
git commit -m "feat(schedules): timezone picker and tz-aware next-run display"
```

---

## Self-Review

**Spec coverage:** R1 → Tasks 2,7 (column/validation/display) + Task 6 (tz into the BullMQ scheduler). R2 → Task 1. R3 → preserved (display invariant) + Task 7. R4 → Task 3. R5 → Task 4. R6 → Task 5. R7 (BullMQ migration) → Task 6. All mapped.

**Placeholder scan:** every code step carries real code or an exact edit target; Task 1 states its no-test reason.

**Type consistency:** `getNextRunAt(cron, ref, timezone?)` (Task 2). `fireSchedule(scheduleId, opts?) → { runIds, batchId? }` consistent across Tasks 4/5/6. `RunTrigger = MANUAL|SCHEDULE|CI` (Task 3). `schedulerService.register/unregister/loadAll` are async in Task 6 — Task 4's route calls must `await` them (noted). `scheduleQueue`/`startScheduleWorker` (Task 6) consistent. Frontend `resolveScheduleTimezone` matches its test.

**Ordering:** 1 independent. 2 before 6 (tz column feeds the scheduler `tz`). 3 before 4 (trigger). 4 before 5 and 6 (`fireSchedule`). 6 (BullMQ) after 4/5 so the fire worker calls the finished `fireSchedule`. 7 after 2. Recommended order = task number order.
