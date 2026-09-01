# Phase 3.1 — Environment-based scheduled email reports

Scheduled test-report digests emailed to recipients, scoped by environment. Reuses the Phase 1 BullMQ repeatable-job scheduler, the Phase 2 mailer, and the existing dashboard aggregation.

## Goal

Let a user configure recurring email digests per environment: pick checks, pick recipients, pick a cadence. On each fire, aggregate the runs since the last successful send and email a summary (pass rate, failures, flaky checks, avg duration). Also support firing on demand and previewing to self.

## Decisions (brainstorm 2026-09-01)

- **Standalone `ReportConfig`** with its own cron (not fields on `Environment`, not an extension of `Schedule`). Allows multiple independent reports per environment.
- **Selectable check subset**: `checkIds` list; empty = all checks in the environment.
- **Recipients are free-form emails** (`string[]`). The frontend resolves which match platform users (render as user name) vs external (render as an email pill); the backend stores plain emails.
- **Window = since last report sent**: `(lastSentAt ?? createdAt, now]`. No gaps, no overlaps.
- **Empty window → skip send, keep window open**: do not email, do not advance `lastSentAt`. The next fire covers the same window plus any new runs.
- **Manual actions**: both `send-now` (to configured recipients) and `preview` (to requesting user only).

## Data model

New model in `backend/prisma/schema.prisma`:

```prisma
model ReportConfig {
  id            String   @id @default(cuid())
  name          String
  projectId     String
  environmentId String
  cron          String
  timezone      String?
  recipients    Json     @default("[]")   // string[] of emails
  checkIds      Json     @default("[]")   // empty = all checks in env
  enabled       Boolean  @default(true)
  lastSentAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  project       Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  environment   Environment @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  @@index([projectId])
  @@index([environmentId])
}
```

- `projectId` carries scope enforcement (`requireScope(projectId, ...)`).
- `environmentId` is the run filter; cascade-delete with the environment.
- Add back-relations `reportConfigs ReportConfig[]` to `Project` and `Environment`.
- New migration. `timezone` follows the Schedule convention (nullable → UTC).

## Scopes

Add to the `Scope` enum: `reports_read`, `reports_edit`.

Seed into default groups in `backend/prisma/seed.ts`:
- VIEWER tier gains `reports_read`
- EDITOR tier gains `reports_edit`
- SUPERADMIN already receives every scope

## Aggregation refactor

Extract the shared aggregation out of `backend/src/routes/dashboard.ts` into `backend/src/services/run-stats.ts`:
- day-bucketing, pass/fail/total counts, pass rate, avg duration, flaky detection.
- `dashboard.ts` calls the extracted helpers; behaviour unchanged.
- `report-runner.ts` calls the same helpers over the report window.

This is the roadmap's "digest/aggregation service". Only the shared math moves; no unrelated dashboard changes.

## Scheduling + execution

Mirror the proven schedule path:

- `backend/src/queue/report-queue.ts` — BullMQ `report-fires` queue + worker, copied from `schedule-queue.ts`. Worker calls `sendReport(reportConfigId)`.
- `backend/src/services/report-scheduler.ts` — `register(config)` via `upsertJobScheduler(config.id, { pattern: config.cron, tz: config.timezone ?? 'UTC' }, { name: 'fire', data: { reportConfigId } })`; `unregister(id)`; `loadAll()` on boot; `stopAll()` no-op (matches scheduler). Called from CRUD and startup, alongside the existing scheduler wiring in `index.ts`.

`backend/src/services/report-runner.ts` — `sendReport(id)`:
1. Load config (skip if `!enabled`).
2. Compute window `(lastSentAt ?? createdAt, now]`.
3. Query terminal runs (`PASSED`/`FAILED`) with `environmentId = config.environmentId` and, if `checkIds` non-empty, `testId in checkIds`.
4. **Zero runs → return without sending; leave `lastSentAt` unchanged.**
5. Else build the digest via `run-stats`, send to each recipient, set `lastSentAt = now`.

Variants:
- `send-now`: same logic as a scheduled fire — configured recipients, honors the empty-window skip (zero runs → no send, `lastSentAt` unchanged), advances `lastSentAt` on a real send.
- `preview`: requesting user only, does NOT advance `lastSentAt`, and ignores the empty-window skip so the user always sees output (renders an empty/"all quiet" digest if the window has no runs).

## Mailer

Add `sendReportEmail(to, digest)` to `backend/src/services/mailer.ts`. HTML + text body: pass rate, failures list, flaky checks, avg duration, window range, environment/project names. One mail per recipient (no cross-recipient address disclosure).

## API — new `backend/src/routes/reports.ts`

- `GET  /projects/:projectId/reports` — `reports_read`
- `POST /projects/:projectId/reports` — `reports_edit`; register with scheduler
- `PATCH /reports/:id` — `reports_edit`; re-register (or unregister if disabled)
- `DELETE /reports/:id` — `reports_edit`; unregister
- `POST /reports/:id/send-now` — `reports_edit`; fire to configured recipients now
- `POST /reports/:id/preview` — `reports_edit`; render + send to requesting user only

Follow the `channels.ts` pattern: zod schemas, `getAuthUser`, `requireScope`, `getProjectAccessStatusCode` error mapping. Register the route in `index.ts`.

## Frontend

Report config UI attached to the environment (per roadmap):
- List / create / edit / delete report configs for an environment.
- Recipients input: a chip/pill field. Autocomplete suggests platform users by email → renders the matched user's name; a non-user email renders as a plain email pill (Gmail-style).
- Cron + timezone picker reusing the schedules-page pattern.
- Check-subset selector (multi-select over the environment's checks; empty = all).
- `send-now` and `preview` buttons.
- Gate all UI on `can('reports_read')` / `can('reports_edit')`.
- New `frontend/src/api/client.ts` functions consumed via TanStack Query (list/create/update/delete/send-now/preview).

## Out of scope (YAGNI)

- Digest CSV/attachment export.
- Per-recipient unsubscribe / delivery tracking.
- A persisted report-send history table (rely on `lastSentAt` + mailer logs).

Add any of these when a concrete need arises.

## Affected files

- Data model: `schema.prisma`, new migration, `seed.ts`.
- Auth: `Scope` enum + group seeds (no `project-access.ts` logic change — `requireScope` already generic).
- Execution: new `report-queue.ts`, `report-scheduler.ts`, `report-runner.ts`; `index.ts` wiring.
- Services: new `run-stats.ts` (extracted); `mailer.ts` (+`sendReportEmail`).
- API: new `reports.ts`; `index.ts` route registration.
- Frontend: environment report UI, `api/client.ts`.

## Dependencies

- Phase 1 (scheduler + runs to aggregate) — done.
- Phase 2 (mailer + scope layer) — done.
