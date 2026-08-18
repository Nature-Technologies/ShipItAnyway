# ShipItAnyway Roadmap

UI Test Automation Platform — phased delivery plan.

Each phase is an independently shippable increment. Features are ordered by dependency: foundations that many later features build on land first, and cross-cutting rewrites (access control) land before the external integrations that would otherwise have to be retrofitted.

## Project sections (impact legend)

Used below under each feature's **Affects** line.

- **Data model** — `backend/prisma/schema.prisma`, `migrations/`, `seed.ts`
- **Auth & access** — `backend/src/utils/project-access.ts`, `constants/admin.ts`, `index.ts` (JWT preHandler)
- **API routes** — `backend/src/routes/*` (`tests`, `runs`, `schedules`, `environments`, `channels`, `suites`, `export`, `recordings`, `projects`, `auth`, `webhooks`, `dashboard`)
- **Execution** — `backend/src/queue/worker.ts`, `services/scheduler.ts`
- **New services** — mailer, GitHub, MCP server (to be added)
- **Frontend** — `frontend/src/pages/*`, `components/*`, `context/AuthContext.tsx`, `api/client.ts`
- **Infra/CI** — `Dockerfile`(s), `docker-compose*.yml`, `.github/`

---

## Phase 1 — Core authoring & execution

Ships the primary product loop: record a check by acting on a site, run it, read the result. Extends what already exists (worker, scheduler, recordings).

### 1.1 Agent-driven test authoring
An agent (or human) performs any action a human can on a target site, and the steps are recorded as a reproducible check.

- Drive a real browser (navigate, click, type, select, upload, assert).
- Capture each action as a structured, replayable step; persist for deterministic re-run.
- **Affects:** Execution (`worker.ts` action/record loop) · API routes (`recordings.ts`, `tests.ts`, `runs.ts`) · Data model (recording/step-schema fields on `Test`/`TestRun`) · Frontend (record + step-editor UI, `RunResultPage`).
- **Depends on:** nothing (foundation).

### 1.2 Scheduled test runs (finish existing)
Cron-scheduled checks already exist (`scheduler.ts`, `Schedule` trigger) — harden and complete.

- Per-check / per-project cron; timezone-aware; schedule-triggered runs in history.
- Make skipped/failed scheduler rows render meaningfully instead of empty.
- **Affects:** Execution (`scheduler.ts`) · API routes (`schedules.ts`) · Data model (`Schedule`) · Frontend (schedule config).
- **Depends on:** 1.1 (a check to schedule).

---

## Phase 2 — Access foundation: scope-based RBAC

Cross-cutting rewrite of authorization. Landed **before** the external integrations (Phase 4) so CI and MCP get scoped service accounts/tokens from day one, instead of retrofitting every new route later.

Today permission is a single `ProjectMember.role` enum checked by hardcoded `allowedRoles` arrays in every route (`requireProjectRole`, `project-access.ts:108`). You cannot grant one feature without the whole tier.

### 2.1 Scopes as the permission gates
- Atomic, feature-level capabilities: `runs:read`, `runs:trigger`, `checks:edit`, `schedules:edit`, `environments:edit`, `environments:reveal-secrets`, `alerts:edit`, `members:read`, `groups:assign`, `project:manage`, `project:delete`.
- Enforcement becomes `requireScope(scope, projectId?)` / `can(user, scope, project?)`, replacing role comparisons.
- **Affects:** Auth & access (new policy layer in `project-access.ts`; retire unused `roleAtLeast`) · **every** API route (swap `['OWNER','EDITOR']` arrays for `requireScope`) · `getAccessibleProjectIds` → "projects where user has any `*:read`".

### 2.2 Groups as bundles of scopes (roles reframed)
- A group is a named set of scopes. Seed the existing tiers as default groups so current behavior is preserved:
  - VIEWER → `{*:read}` (secrets stay masked — no `*:reveal-secrets`).
  - EDITOR → VIEWER + `{*:edit, runs:trigger}`.
  - OWNER → EDITOR + `{project:manage, project:delete, members:*, groups:assign}`.
- A user's effective scopes = union of their groups' scopes (per project for project-scoped groups; global groups apply everywhere).
- **Affects:** Data model (new `Group`, `GroupScope`, `UserGroup` tables; migrate `ProjectMember.role` → default-group assignments; `seed.ts` seeds default groups).

### 2.3 Assignment authority (delegatable)
- **Superadmin** — promote today's `ADMIN_EMAIL` env allowlist to a first-class `User.isSuperadmin` (or a global group). Can assign any user to any group and manage groups/scopes.
- **Delegated:** any group holding `groups:assign` can assign users to groups within its project scope. Group management is gated by a scope, not hardcoded to OWNER.
- **Affects:** Auth & access (`constants/admin.ts` → DB flag) · Data model (`User.isSuperadmin`) · API routes (`projects.ts` member endpoints → group-assignment endpoints).

### 2.4 Real invite flow (close dead `PENDING` state)
- `PENDING` status + the frontend "Pending" tag exist but nothing produces them; `POST members` always writes `ACTIVE` with a required password.
- Add token-based email invites: invite → pending → user sets own password → active. No self-signup by design.
- **Affects:** API routes (`auth.ts`, `projects.ts`) · New services (mailer — shared with Phase 3) · Data model (`ProjectMember`/`UserGroup` status, invite token) · Frontend (invite form, pending state).

### 2.5 Frontend permission gating
- Group/scope management UI (assign users to groups, define group scopes) replacing the role dropdown; gate UI on effective scopes instead of `isOwner/isEditor/isViewer`.
- **Affects:** Frontend (`ProjectPage.tsx`, `AuthContext.tsx`, `api/client.ts`).

**Depends on:** Phase 1 routes existing (so their scopes are defined once, not rewritten).

---

## Phase 3 — Delivery & reporting

### 3.1 Environment-based scheduled email reports
Scheduled test-report digests to email addresses, scoped by environment.

- Per-environment report config (which checks, which recipients).
- Scheduled digest: pass rate, failures, flaky checks, avg duration.
- **Affects:** Execution (`scheduler.ts` report cron) · New services (mailer — reuses the Phase 2 invite mailer; digest/aggregation service) · API routes (new `reports` route or extend `channels.ts`) · Data model (`ReportConfig`, recipients) · Auth & access (gated by a `reports:*` scope) · Frontend (report config UI on environments).
- **Depends on:** Phase 1 (`scheduler`, runs to aggregate) · Phase 2 (mailer + `reports` scope).

---

## Phase 4 — External integrations

Both need stable run APIs (Phase 1) and scoped tokens / service accounts (Phase 2).

### 4.1 GitHub Actions CI integration
Trigger runs from CI and publish results back to GitHub.

- Trigger on push / PR / `workflow_dispatch`.
- Publish status back to GitHub (checks / commit status / PR annotations).
- Link the CI run to the platform's run-result page.
- **Affects:** API routes (`webhooks.ts` inbound triggers, run-trigger endpoint) · New services (GitHub client: status/checks API) · Auth & access (scoped API token / service account from Phase 2) · Data model (`TestRun` CI link fields) · Infra/CI (`.github/` workflow templates) · Frontend (run → CI link).
- **Depends on:** Phase 1 (run trigger + result) · Phase 2 (token auth).

### 4.2 MCP support
Expose test runs to any agent over MCP.

- Serve runs, checks, and results via an MCP server; let external agents query history and trigger runs.
- **Affects:** New services (MCP server package/entrypoint) · API routes (reuse run/read services) · Auth & access (scoped token maps to a group's scopes — e.g. read-only vs trigger) · Infra/CI (compose service for the MCP server).
- **Depends on:** Phase 1 (run/read APIs) · Phase 2 (token → scope mapping).

---

## Dependency summary

```
Phase 1  Core authoring + scheduling        (foundation)
   │
   ├── Phase 2  Scope-based RBAC             (rewrites auth on all P1 routes; adds tokens, mailer, invites)
   │       │
   │       ├── Phase 3  Email reports        (needs scheduler + mailer + reports scope)
   │       │
   │       └── Phase 4  GitHub CI + MCP       (needs stable run APIs + scoped tokens)
```

**Why RBAC (Phase 2) precedes the integrations:** it replaces `requireProjectRole` with `requireScope` across every route. Adding CI/MCP/report routes first would mean writing them against the old model and rewriting them later — landing RBAC before them means each new route is authored against the policy layer once.
