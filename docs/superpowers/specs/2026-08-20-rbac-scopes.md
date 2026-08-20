# Spec — Scope-Based RBAC: Scopes as the Permission Gates (Roadmap 2.1)

**Status:** Ready for planning
**Roadmap item:** Phase 2.1 — "Scopes as the permission gates"
**Plan:** `docs/superpowers/plans/2026-08-20-rbac-scopes.md` (to be written)

## Problem

Authorization today is a single `ProjectMember.role` enum (`OWNER`/`EDITOR`/`VIEWER`)
checked by hardcoded `allowedRoles` arrays passed to `requireProjectRole` in every route.
You cannot grant one capability (e.g. "trigger runs") without granting the whole tier.
Every new route (CI, MCP, reports in Phases 3–4) would hardcode another role array.

This item replaces role comparison with **scope checks** — atomic, feature-level
capabilities — without changing who-can-do-what today. It is the enforcement layer only;
where scopes *come from* (groups) is Roadmap 2.2. 2.1 ships behind a resolver shim that
derives scopes from the existing `role` column, so it lands independently.

## Verified current state (facts the plan relies on)

- **Single choke point.** All route authz flows through `requireProjectRole(projectId,
  userId, allowedRoles)` (`project-access.ts:108`), which calls `getProjectAccess`
  (`:51`) then `hasProjectRole` (`:47`). 40 call sites across 11 route files (grep-verified,
  see mapping table below).
- **`getProjectAccess`** returns `{ project, member }` where `member` is the full
  `ProjectMember` row including `role` (`project-access.ts:51-71`).
- **Role ranks are dead.** `ROLE_RANK` + `roleAtLeast` (`project-access.ts:18-22,138-140`)
  have **no callers** anywhere (grep: only the definition). Removable.
- **Read vs write split follows the role array exactly:**
  - `['OWNER','EDITOR','VIEWER']` = read endpoints (GET lists/details).
  - `['OWNER','EDITOR']` = write/trigger endpoints.
  - `['OWNER']` (`PROJECT_OWNER_ROLES`, `projects.ts:41`) = member/project management.
- **Secret reveal is role-derived, not a separate gate.** `environments.ts:15` admits
  VIEWER, then `redactEnvironmentVariables(vars, viewerOnly)` masks values when the caller
  is VIEWER (`project-access.ts:147-153`, `maskSecretValue` → `••••••`). So "see unmasked
  secrets" = EDITOR+OWNER today, expressed only as a runtime branch on `role`.
- **`getAccessibleProjectIds`** (`project-access.ts:73-85`) returns every project where the
  user has an ACTIVE membership (any role). Used by `runs.ts` cross-project listing.
- **`canCreateProject`** (`project-access.ts:87-106`) = protected-admin OR holds
  `OWNER`/`EDITOR` in *any* project. Project creation authority — deferred to 2.3
  (superadmin), left as-is in 2.1.
- **JWT preHandler** (`index.ts:105-145`) authenticates only (verifies token, confirms user
  still exists). It does **not** load roles/scopes — authz stays per-route. 2.1 keeps this.
- **Protected admin** (`isProtectedAdminEmail`, `project-access.ts:35`) bypasses some checks
  in `projects.ts` (`:410,531,610,645`). Untouched by 2.1; folded into superadmin in 2.3.

## Scope catalog

Full set (the roadmap's list is illustrative; this is the enforced enumeration). Read
scopes exist per resource so VIEWER = union of `*:read`.

| Scope | Meaning |
|---|---|
| `runs:read` | View runs, batches, results |
| `runs:trigger` | Start a run / batch / all-cases |
| `checks:read` | View tests (checks), suites, fixtures, exports |
| `checks:edit` | Create/update/delete checks, suites, fixtures, recordings, export |
| `schedules:read` | View schedules |
| `schedules:edit` | Create/update/delete/run-now schedules |
| `environments:read` | View environments (secrets **masked**) |
| `environments:edit` | Create/update/delete environments |
| `environments:reveal-secrets` | See environment variable values unmasked |
| `alerts:read` | View notification channels |
| `alerts:edit` | Create/update/delete/test channels |
| `members:read` | View project members |
| `teams:manage` | Create/edit teams, manage membership, attach team↔project (defined here, enforced in 2.3) |
| `project:manage` | Rename project, manage members |
| `project:delete` | Delete the project |

> `teams:manage`, `project:manage`, `project:delete` are enumerated now so route swaps
> reference stable names; their *management* endpoints land in 2.3/2.5.

## Requirements

### R1 — Policy layer replaces role checks
Add to `project-access.ts` (or a new `policy.ts`):
- `type Scope` — string-literal union of the catalog above.
- `can(access: ProjectAccess, scope: Scope): boolean` — pure predicate over the resolved
  scope set.
- `async requireScope(projectId, userId, scope): Promise<ProjectAccess>` — mirrors
  `requireProjectRole`'s contract exactly: 404 if project missing, 403 if no access or scope
  absent, returns `ProjectAccess` on success (same `ProjectAccessError.statusCode` shape,
  so `getProjectAccessStatusCode` and every catch block keep working unchanged).

### R2 — Scope resolver shim (the 2.1↔2.2 seam)
- `resolveScopes(member: ProjectMember): Set<Scope>` maps the existing `role` to its scope
  set using the seed table in R4. This is the **only** place role is read.
- 2.2 replaces this function's body with a group-union lookup; **no route changes** when
  2.2 lands. The shim is the contract boundary.

### R3 — Swap all 40 call sites to `requireScope`
One scope per call site, chosen to preserve today's behavior exactly (mapping below).
Delete `requireProjectRole`, `hasProjectRole`, `roleAtLeast`, `ROLE_RANK` once unreferenced.

**Call-site → scope mapping** (grep-verified line numbers):

| File | Lines | Today | Scope |
|---|---|---|---|
| `runs.ts` | 61,128 | O,E | `runs:trigger` |
| `runs.ts` | 230,285,321 | O,E,V | `runs:read` |
| `tests.ts` | 45,66 | O,E,V | `checks:read` |
| `tests.ts` | 87,134,151 | O,E | `checks:edit` |
| `recordings.ts` | 30,75,96,111,124,144,157 | O,E | `checks:edit` |
| `export.ts` | 47,99 | O,E | `checks:edit` |
| `suites.ts` | 25 | O,E,V | `checks:read` |
| `suites.ts` | 45,87,131,154 | O,E | `checks:edit` |
| `fixtures.ts` | 37 | O,E,V | `checks:read` |
| `fixtures.ts` | 18 | O,E | `checks:edit` |
| `schedules.ts` | 107,165 | O,E,V | `schedules:read` |
| `schedules.ts` | 219,258,312,332 | O,E | `schedules:edit` |
| `environments.ts` | 15 | O,E,V | `environments:read` |
| `environments.ts` | 38,63,81 | O,E | `environments:edit` |
| `channels.ts` | 73 | O,E,V | `alerts:read` |
| `channels.ts` | 104,166,204,233 | O,E | `alerts:edit` |
| `projects.ts` | 219 | O,E,V | `members:read` |
| `projects.ts` | 439,458,474,514,592,632 | O | `project:manage` |

> `project:delete` distinguishes the delete endpoint from `project:manage` — 2.1 may map
> `projects.ts` delete to `project:delete` and the rest to `project:manage`; both seed only
> to OWNER, so behavior is identical either way. Confirm the delete line during planning.

### R4 — `resolveScopes` role→scope seed (behavior-preserving)
The shim must reproduce today's tiers precisely:

- **VIEWER** → all `*:read` (`runs:read`, `checks:read`, `schedules:read`,
  `environments:read`, `alerts:read`, `members:read`). **No** `environments:reveal-secrets`.
- **EDITOR** → VIEWER + `runs:trigger`, `checks:edit`, `schedules:edit`,
  `environments:edit`, `alerts:edit`, `environments:reveal-secrets`.
- **OWNER** → EDITOR + `project:manage`, `project:delete`, `teams:manage`.

### R5 — Replace the secret-reveal role branch with a scope
`environments.ts:15` computes `viewerOnly` from `role === 'VIEWER'`; change it to
`!can(access, 'environments:reveal-secrets')`. Same masking outcome today (VIEWER masked),
but now driven by a scope so a future group can grant reveal without full edit.

### R6 — `getAccessibleProjectIds` becomes scope-aware
Redefine as "projects where the user has any `*:read` scope" per the roadmap. With the R4
seed every ACTIVE member has reads, so the returned set is identical today. Implement as a
thin filter over memberships resolving scopes, keeping the existing return shape
(`string[]`).

## Explicitly out of scope
- **Groups / `Group`/`GroupScope`/`UserGroup` tables and the DB migration** — Roadmap 2.2.
  2.1 resolves scopes from the existing `role` column via the R2 shim.
- **Superadmin, `groups:assign` enforcement, invite flow, member→group endpoints** — 2.3/2.4.
- **Frontend scope gating** (`isOwner/isEditor/isViewer` → effective scopes) — Roadmap 2.5.
  2.1 leaves the frontend and `/auth/me` payload untouched.
- **`canCreateProject` redesign** — deferred to 2.3 (superadmin); left as-is.
- Per-endpoint scope granularity beyond the catalog (e.g. splitting suites from checks).

## Acceptance criteria
- Every former `requireProjectRole` call site now calls `requireScope` with the mapped
  scope; `requireProjectRole`/`hasProjectRole`/`roleAtLeast`/`ROLE_RANK` are deleted and the
  build has no references to them.
- A VIEWER can read runs/checks/schedules/environments/alerts/members and is 403'd on every
  edit/trigger/manage endpoint — identical to pre-change behavior (regression-tested).
- An EDITOR can trigger and edit but is 403'd on `project:manage`/`project:delete` endpoints.
- An OWNER retains full access.
- A VIEWER sees masked env secrets; EDITOR/OWNER see them unmasked — now via
  `environments:reveal-secrets`, not a `role` branch.
- `getAccessibleProjectIds` returns the same set as before for every fixture user.
- `requireScope` throws 404 for a missing project and 403 for a missing scope, with
  `statusCode` set so existing `getProjectAccessStatusCode` catch blocks are unchanged.

## Test approach
`node:test` + `node:assert/strict` via `tsx --test`, mirroring `backend/tests/*`.
- **Unit:** `resolveScopes` for each role → exact scope set (R4 table); `can` truth table.
- **Route regression:** `Fastify().inject` with a `preHandler` stub setting `req.user`, real
  Prisma, seeding a project with one OWNER/EDITOR/VIEWER member each; assert allow/403 on a
  representative read, edit, trigger, and manage endpoint per tier — proving behavior parity
  with the pre-swap matrix. Follows `backend/tests/data-case-run.test.ts`.
- **Secret masking:** GET environments as VIEWER (masked) vs EDITOR (unmasked).
