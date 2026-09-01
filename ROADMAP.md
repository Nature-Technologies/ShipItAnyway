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
Cron-scheduled checks already exist and genuinely fire (~70% done): in-memory `node-cron` timers in `scheduler.ts` enqueue runs, full CRUD in `schedules.ts`, and a management UI in `SchedulesPage.tsx`. Runs already carry `scheduleId`. Remaining work is timezone correctness and robustness.

- **Optional per-schedule timezone (default UTC).** Add a nullable `Schedule.timezone`. When unset, everything stays UTC — the server already runs UTC and all stored datetimes are UTC (verified), so the cron is interpreted as UTC. When a timezone is set from the UI, honor it with real DST/locale rules: pass it to node-cron (`cron.schedule(cron, cb, { timezone })`) and to next-run display (`cron-parser` `parseExpression(cron, { tz })`). Pin `TZ=UTC` on the backend container so the default is guaranteed, not implicit. Today node-cron gets no timezone (`scheduler.ts:16`) so it fires in server tz while the UI shows a misleading browser-tz label — this closes that gap.
- **Browser shows local, server/DB stay UTC.** Persisted timestamps already follow this (stored UTC, displayed in the viewer's tz). Keep that invariant; only the schedule's *firing rule* carries an optional tz.
- **Missed-run handling / HA.** In-memory node-cron has no catch-up (a run due during downtime is lost) and no multi-instance dedupe (two backends fire every schedule twice). Move to BullMQ repeatable jobs (Redis-backed, dedup-by-repeat-key, restart-safe) or add boot-time reconciliation (`lastRunAt` vs computed next run) + a Redis lock.
- **Explicit `trigger` field** on `TestRun` (Manual/Schedule/CI) instead of inferring from `scheduleId != null`.
- **Schedule-scoped "run now"** so a manual fire from the schedules page is tagged with `scheduleId` and appears in that schedule's history (currently it doesn't).
- Make skipped/failed data-driven scheduler rows (`scheduler.ts:38-48`) render meaningfully instead of an empty detail page.
- **Affects:** Execution (`scheduler.ts`) · API routes (`schedules.ts`, `runs.ts`) · Data model (`Schedule.timezone`, `TestRun.trigger`) · Infra (`TZ=UTC`, BullMQ repeatable jobs / Redis lock) · Frontend (`SchedulesPage.tsx` timezone picker + local⇄UTC display).
- **Depends on:** 1.1 (a check to schedule).

---

## Phase 2 — Access foundation: scope-based RBAC

Cross-cutting rewrite of authorization. Landed **before** the external integrations (Phase 4) so CI and MCP get scoped service accounts/tokens from day one, instead of retrofitting every new route later.

Today permission is a single `ProjectMember.role` enum checked by hardcoded `allowedRoles` arrays in every route (`requireProjectRole`, `project-access.ts:108`). You cannot grant one feature without the whole tier.

Two orthogonal concepts (decided 2026-08-20 — see `docs/superpowers/specs/2026-08-20-rbac-*.md`):
**Group = capability** (a named set of scopes, held globally by a user) and **Team = membership**
(a collection of users assigned to projects; enforces no scopes). Effective authority on a
project = Team (where) × Group (what).

### 2.1 Scopes as the permission gates
- Atomic, feature-level capabilities: `runs:read`, `runs:trigger`, `checks:read`, `checks:edit`, `schedules:read`, `schedules:edit`, `environments:read`, `environments:edit`, `environments:reveal-secrets`, `alerts:read`, `alerts:edit`, `members:read`, `teams:manage`, `project:manage`, `project:delete`.
- Enforcement becomes `requireScope(scope, projectId?)` / `can(user, scope, project?)`, replacing role comparisons.
- Ships behind a resolver shim that derives scopes from the existing `ProjectMember.role`, so it lands before the group/team tables of 2.2.
- **Affects:** Auth & access (new policy layer in `project-access.ts`; retire unused `roleAtLeast`) · **every** API route (swap `['OWNER','EDITOR']` arrays for `requireScope`) · `getAccessibleProjectIds` → "projects where user has any `*:read`".

### 2.2 Groups (capability) + Teams (membership)
- **Group = named set of scopes, held globally per user** (`UserGroup(userId, groupId)`). Effective scopes = union of the user's groups' scopes, the same wherever they have access. `Group.isGlobal` groups apply without membership (superadmin).
- **Team = collection of users, assigned to projects (many-to-many)**; team assignment *is* project membership. A team enforces no scopes.
- `requireScope(P, user, scope)` = scope ∈ global-group scopes, OR (member of P via a team AND scope ∈ the user's group scopes).
- Seed the existing tiers as default groups so current behavior is preserved (VIEWER→`{*:read}`, EDITOR→+`{*:edit, runs:trigger}`, OWNER→+`{project:manage, project:delete, teams:manage}`), plus a global `SUPERADMIN` group with every scope. One team per existing project preserves membership. Note: global-per-user capability flattens a multi-role user to their max role.
- **Affects:** Data model (new `Group`, `GroupScope`, `UserGroup`, `Team`, `TeamMember`, `TeamProject` tables + `Scope` enum; migrate `ProjectMember.role` → groups + teams; drop `role`; `seed.ts` seeds default + superadmin groups).

### 2.3 Assignment authority (delegatable)
- **Superadmin owns capability** — a first-class global group (`SUPERADMIN`, `isGlobal`) replacing the `ADMIN_EMAIL` allowlist. Only a superadmin assigns user↔group (global capability) and creates/edits custom group definitions.
- **Teams are delegated** — holders of `teams:manage` create/edit teams, manage membership, and attach a team to a project they have authority on (`requireScope(project, teams:manage)`). Membership and capability are separate acts.
- System-wide "at least one superadmin" floor replaces the per-project "at least one owner" invariant.
- **Affects:** Auth & access (`constants/admin.ts`/`isProtectedAdminEmail` retired for authz) · API routes (new `/groups`, `/users/:id/groups`, `/teams` endpoints; `projects.ts` member endpoints removed; `POST /projects` superadmin-only).

### 2.4 Real invite flow (close dead `PENDING` state)
- `PENDING` status + the frontend "Pending" tag exist but nothing produces them; `POST members` always wrote `ACTIVE` with a required password.
- Add a first-class `Invite` model (hashed token, TTL, single-use): invite → email link → user sets own password → active, with an **auto-VIEWER capability floor** on accept plus any invited team membership. Retires `ProjectMember`/`ProjectMemberStatus` entirely. No self-signup by design.
- **Affects:** API routes (`auth.ts` public accept endpoints; new `/invites`) · New services (mailer — nodemailer + `SMTP_*`, console fallback; shared with Phase 3) · Data model (new `Invite`/`InviteStatus`; drop `ProjectMember`) · Frontend (public accept page).

### 2.5 Frontend permission gating
- Gate UI on effective scopes (`can(scope)`) instead of `isOwner/isEditor/isViewer`; server sends `currentUserScopes` per project and `isSuperadmin`. Per-project team management + invite UI (delegated); a superadmin Access console for groups and user↔group assignment replaces the role dropdown.
- **Affects:** Frontend (`ProjectPage.tsx`, `AuthContext.tsx`, `api/client.ts`, new Access console + accept page).

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
