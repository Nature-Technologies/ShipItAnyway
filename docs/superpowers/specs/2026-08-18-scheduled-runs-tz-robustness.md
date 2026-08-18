# Spec — Scheduled Runs: Timezone Correctness & Robustness (Roadmap 1.2)

**Status:** Ready for planning
**Roadmap item:** Phase 1.2 — "Scheduled test runs (finish existing)"
**Plan:** `docs/superpowers/plans/2026-08-18-scheduled-runs-tz-robustness.md`

## Problem

Cron scheduling already fires (~70% done): in-memory `node-cron` timers in
`backend/src/services/scheduler.ts` enqueue runs, full CRUD in
`backend/src/routes/schedules.ts`, management UI in
`frontend/src/pages/SchedulesPage.tsx`. Runs carry `scheduleId`. Six gaps remain,
all verified against the code:

1. **Timezone mismatch.** `cron.schedule(cron, cb)` gets no `{ timezone }`
   (`scheduler.ts:16`) and `getNextRunAt` calls `parseExpression(cron, { currentDate })`
   with no `tz` (`schedules.ts:100-109`). Both run in the server's local zone. The UI
   only *displays* the browser zone (`SchedulesPage.tsx:23`, `Intl...resolvedOptions().timeZone`)
   as a cosmetic tag — it is never sent to the server. So a cron labelled "9am" in the UI
   fires at 9am server-time (UTC), and the label misleads any non-UTC user.
2. **No catch-up.** In-memory node-cron loses any occurrence due during downtime.
3. **No multi-instance dedupe.** Two backends would each fire every schedule.
4. **Trigger is inferred, never stored.** `dashboard.ts:41-43` derives Manual/Schedule
   from `scheduleId` null-ness. No room for a third source (CI, Phase 4).
5. **"Run now" from a schedule row doesn't link to the schedule.**
   `SchedulesPage.tsx:265-280` calls the generic run endpoints (`scheduleId = null`), so the
   run is labelled Manual and never appears in that schedule's history.
6. **Data-driven schedules auto-fail.** `scheduler.ts:37-51` writes an immediate `FAILED`
   `TestRun` with `DATA_DRIVEN_CASE_REQUIRED_ERROR` and `continue`s — the detail page is empty
   of meaningful step results.

## Verified current state (facts the plan relies on)

- **Container is UTC.** No `TZ=` anywhere in compose/Dockerfiles; base image
  `mcr.microsoft.com/playwright:v1.59.1-jammy` defaults UTC. All stored datetimes are UTC.
- **Queue = BullMQ over Redis.** `redis:7-alpine` present with healthcheck
  (`docker-compose.yml:19-28`); backend `depends_on redis`. Job data
  `{ testRunId, testId, environmentId? }`, queue name `test-runs`.
- **`Schedule`** (`schema.prisma:107-123`): has `cron`, `enabled`, `lastRunAt DateTime?`,
  XOR `suiteId`/`testId`, `environmentId?`. **No `timezone`, no `nextRunAt` column** (next-run
  computed on read).
- **`TestRun`** (`schema.prisma:49-74`): `scheduleId String?`, batch fields, `stepResults`,
  `tracePath`. **No `trigger` field.**
- **Scheduler bypasses `enqueueTestRun`** — calls `testQueue.add('run', …)` directly
  (`scheduler.ts:62`), so scheduled jobs get a random jobId, unlike manual/batch runs which use
  the deterministic `test-run-<id>` jobId (`batch-sequencer.ts:17-33`).
- **`RunStatus` enum:** `PENDING RUNNING PASSED FAILED`.
- Data-driven expansion already exists as `POST /tests/:id/runs/all-cases` +
  `TestRunBatch` machinery (`runs.ts`, `batch-sequencer.ts`) — reuse it, don't reinvent.
- Migrations: Prisma default `<YYYYMMDDHHMMSS>_<snake_case>/migration.sql`; latest is
  `20260715120000_add_test_run_batches`. `backend/Dockerfile:25` runs
  `prisma migrate deploy && prisma db seed && node dist/src/index.js` on boot.

## Requirements

### R1 — Optional per-schedule timezone (default UTC)
- Add nullable `Schedule.timezone String?`. Unset ⇒ UTC (guaranteed by R2).
- When set, honour real DST/locale rules: pass `{ timezone }` to `cron.schedule` and `{ tz }`
  to `parseExpression`. Reject non-IANA values on create/update.
- Frontend gains a timezone picker; when a schedule has a timezone, next-run and the cron
  description are shown in it, otherwise UTC.

### R2 — Guarantee the UTC default
- Pin `TZ=UTC` on the backend container (Dockerfile `ENV` + compose `x-backend-env`) so an
  unset `Schedule.timezone` is deterministically UTC, not implicit.

### R3 — Keep the display invariant
- Persisted timestamps stay UTC in server/DB and render in the viewer's zone. Only a
  schedule's *firing rule* carries an optional tz. No change to how run timestamps are stored.

### R4 — Explicit `trigger` on `TestRun`
- Add `enum RunTrigger { MANUAL SCHEDULE CI }`, `TestRun.trigger RunTrigger @default(MANUAL)`.
- Backfill existing rows: `scheduleId IS NOT NULL ⇒ SCHEDULE`, else `MANUAL`.
- Every creation site sets it explicitly; `dashboard.ts` reads the column instead of inferring.
- `CI` is defined now (cheap) for Phase 4; nothing produces it yet.

### R5 — Schedule-scoped "run now"
- New `POST /schedules/:id/run` creates a `TestRun` (or batch, per R6) with `scheduleId` set and
  `trigger = MANUAL`, so a manual fire from the schedules page shows in that schedule's history.
- Frontend "Run now" calls this instead of the generic endpoints.

### R6 — Data-driven schedules render meaningfully
- Instead of writing one immediate `FAILED` row, the scheduler expands a data-driven target into
  a `TestRunBatch` (reusing the `runs/all-cases` path) so each enabled case runs and the history
  shows a real batch. If a data-driven target has zero enabled cases, keep the single explanatory
  `FAILED` row (unchanged behaviour, but that's now the only failure case).

### R7 — Restart-safe, deduped firing via BullMQ (decision: migrate off node-cron)
- **Replace the in-memory `node-cron` firing engine with BullMQ Job Schedulers** (repeatable jobs,
  Redis-backed). Each schedule becomes one job scheduler keyed by `schedule.id`
  (`queue.upsertJobScheduler(schedule.id, { pattern: cron, tz }, { name: 'fire', data: { scheduleId } })`);
  a dedicated worker runs `fireSchedule(scheduleId)` on each tick.
- This gives, by design: **restart-safety** (schedulers persist in Redis, survive process death),
  **multi-instance dedupe** (one delayed job per tick regardless of instance count), and **one
  natural catch-up** (a tick that came due during downtime fires once on restart). No manual Redis
  lock or reconciliation loop needed.
- Timezone (R1) is passed as the scheduler's `tz` option. CRUD upserts/removes the scheduler
  (`removeJobScheduler(id)` on delete/disable). `loadAll()` upserts a scheduler for every enabled
  schedule (idempotent).
- The fire worker enqueues actual runs through `enqueueTestRun` so scheduled jobs get the
  deterministic `test-run-<id>` jobId like every other run.

## Explicitly out of scope
- Backfilling *every* missed occurrence during a long outage (BullMQ fires one catch-up tick on
  restart; that is enough — we do not replay a full missed series).
- Per-schedule data-case selection UI (the batch expansion runs all enabled cases).
- Removing `node-cron` from `package.json` if any non-scheduler code still imports it (verify; it is
  only used by the scheduler today, so it should become removable).

## Acceptance criteria
- A schedule with `timezone: "America/New_York"` and cron `0 9 * * *` fires at 13:00/14:00 UTC
  (DST-correct) and its next-run label reads in New York time; an unset schedule fires at 09:00 UTC.
- Bad timezone (`"Mars/Phobos"`) is rejected 400 on create/update.
- Every new `TestRun` has a `trigger`; dashboard trigger labels come from the column; existing rows
  are backfilled.
- "Run now" on a schedule produces a run that appears in that schedule's history.
- A data-driven schedule tick produces a `TestRunBatch` with one run per enabled case.
- Each schedule maps to exactly one BullMQ job scheduler; disabling/deleting removes it; two backend
  instances fire a given tick only once (BullMQ dedupe); a tick due during a restart fires once on boot.
- `TZ=UTC` present in the backend container config.

## Test approach
`node:test` + `node:assert/strict`, run with `tsx --test` (mirrors the `test:trace` script).
Backend route/DB tests use `Fastify().inject` with a `preHandler` stub setting `req.user`, real
Prisma + real Redis/`testQueue` (pause/drain between), following
`backend/tests/data-case-run.test.ts`. Pure helpers (next-run-in-tz, missed-occurrence,
tz-resolution) get unit tests. Frontend helper (`resolveScheduleTimezone`) tested as a pure util
like `frontend/tests/run-batch-utils.test.ts`.
