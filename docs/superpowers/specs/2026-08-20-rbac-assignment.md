# Spec — Scope-Based RBAC: Assignment Authority — Teams, Groups, Superadmin (Roadmap 2.3)

**Status:** Ready for planning
**Roadmap item:** Phase 2.3 — "Assignment authority (delegatable)"
**Plan:** `docs/superpowers/plans/2026-08-20-rbac-assignment.md` (to be written)
**Depends on:** 2.2 (`docs/superpowers/specs/2026-08-20-rbac-groups.md`) — Group/Team model,
resolver, `requireScope`.

## Decisions (confirmed with product)

Because a **Group is global capability** (a user's scopes are the same on every project) but a
**Team is per-project membership**, authority splits along that seam:

- **Superadmin owns capability.** Only a superadmin (member of an `isGlobal` group, i.e.
  `SUPERADMIN`) may: assign/unassign **user ↔ group**, and **create/edit/delete custom group
  definitions** (which scopes a group bundles). System groups stay immutable.
- **Teams are delegated.** Holders of the new **`teams_manage`** scope may create/edit/delete
  teams, manage team membership, and attach/detach a team to a **project they have authority
  on**. Attaching a team to project P is gated by `requireScope(P, teams_manage)`.

This deliberately keeps global capability grants centralized (safe) and delegates only "who is
in my project." A brand-new user with no groups can be added to a team (by a delegate) but has
zero scopes until a superadmin grants them a group — membership and capability are **separate
acts**. (Default-group-on-invite is a 2.4 concern.)

### Amends the scope catalog (2.1/2.2)
- **Remove `groups_assign`** — group assignment is not delegable, so a delegable scope for it
  is meaningless.
- **Add `teams_manage`** — team CRUD + membership + team↔project attach/detach.
- **Re-seed OWNER**: its bundle loses `groups_assign`, gains `teams_manage`. (SUPERADMIN still
  has every scope, so superadmins keep team authority too.) Update 2.2 R2 seed accordingly.

## Problem

Today member management lives in `projects.ts` and is gated by `PROJECT_OWNER_ROLES` (`['OWNER']`)
with `role`-based semantics that 2.2 removes. This item builds the management surface for the
new model: **team endpoints** (delegated) and **group/assignment endpoints** (superadmin), and
promotes the `ADMIN_EMAIL` allowlist to first-class superadmin.

## Verified current state (to be replaced)

- **Member endpoints, all `PROJECT_OWNER_ROLES`** (`projects.ts`):
  - `GET  /projects/:id/members` (`:471`) — list members (role-ordered).
  - `POST /projects/:id/members` (`:511`) — create user (password if new) + upsert membership
    with a role.
  - `PATCH /projects/:id/members/:memberId` (`:589`) — change role.
  - `DELETE /projects/:id/members/:memberId` (`:629`) — remove membership.
- **Invariants embedded in those endpoints** (all keyed on `role`, so they must be reframed):
  - Protected admin must be added/kept as `OWNER` (`:531,610`), and cannot be removed
    (`:645`).
  - "Project must have at least one owner" via `getProjectOwnersCount` (`:614-617,649-652`).
- **`POST /projects`** (`:403-429`) is **protected-admin-only** (`:410`) and creates an OWNER
  `ProjectMember` for the creator.
- **`isProtectedAdminEmail`** (`project-access.ts:35`) — env `ADMIN_EMAIL` + fallback. To be
  superseded by superadmin group membership (2.2 R3 already grants these emails SUPERADMIN).
- `ProjectMemberCreateSchema`/`UpdateSchema` (`projects.ts:43-51`) carry `role` — removed.

## Requirements

### R1 — `requireSuperadmin` helper
`async function requireSuperadmin(userId): Promise<void>` — passes iff the user holds an
`isGlobal` group (any group with `isGlobal=true`; today only `SUPERADMIN`). 403 otherwise,
same `statusCode` error shape. Reuses `resolveUserScopes` (2.2 R4): global set non-empty ⇒ the
group is global ⇒ superadmin. (Equivalently check `UserGroup → Group.isGlobal`.)

### R2 — Group-definition endpoints (superadmin only)
- `GET  /groups` — list all groups with `isSystem`, `isGlobal`, and their scopes.
- `POST /groups` `{ name, scopes: Scope[] }` — create a custom group (`isSystem=false`,
  `isGlobal=false`). Validate each scope ∈ catalog; unique name.
- `PATCH /groups/:id` `{ name?, scopes? }` — edit a **custom** group; **409/400 if
  `isSystem`**. Setting `scopes` replaces the `GroupScope` set.
- `DELETE /groups/:id` — delete a **custom** group; reject if `isSystem`; cascade removes its
  `UserGroup` rows (users lose that capability). Reject if it is the last `isGlobal` group
  (protects superadmin — see R6).

### R3 — User ↔ group assignment (superadmin only)
- `GET  /users` — list users (id, email) for the assignment UI. Superadmin only.
- `GET  /users/:id/groups` — the user's groups.
- `PUT  /users/:id/groups` `{ groupIds: string[] }` — set the user's global group set
  (replace-semantics; validates ids exist). This is the single global-capability grant point.
- **Guard:** removing `SUPERADMIN`/the last `isGlobal` assignment that would leave **zero
  superadmins** is rejected (R6).

### R4 — Team endpoints (delegated via `teams_manage`, or superadmin)
Team objects are global (many-to-many with projects); project attachment is project-gated.
- `POST /teams` `{ name }` — create. Requires the caller to hold `teams_manage` (any group;
  capability is global) or be superadmin.
- `GET /teams` — list teams the caller can manage (superadmin: all; else teams the caller is a
  member of or that are attached to a project where they have `teams_manage`). Planning to
  finalize the exact visibility filter.
- `PATCH /teams/:id` `{ name }`, `DELETE /teams/:id` — same `teams_manage`/superadmin gate.
- `POST /teams/:id/members` `{ userId }`, `DELETE /teams/:id/members/:userId` — manage
  membership. `teams_manage`/superadmin.
- `POST /teams/:id/projects` `{ projectId }` — attach; gated `requireScope(projectId,
  teams_manage)` so the caller must have authority **on that specific project**.
- `DELETE /teams/:id/projects/:projectId` — detach; same project gate.

### R5 — Rework `/projects/:id/members` and `POST /projects`
- `GET /projects/:id/members` → gated `members_read`; returns the **derived** member list:
  union of users across all teams attached to the project, each annotated with the team(s)
  they come from and their effective groups/scopes (from `resolveUserScopes`). No `role`.
- **Remove** `POST/PATCH/DELETE /projects/:id/members` (role-based). Adding a person to a
  project is now: superadmin grants groups (R3) + a `teams_manage` delegate adds them to a
  team attached to the project (R4). New-user creation with a password moves to the invite
  flow (2.4).
- `POST /projects` → **superadmin only** (`requireSuperadmin`), replacing the
  `isProtectedAdminEmail` check (`:410`). Behavior preserved (only admins create projects).
  The creator, being superadmin (global), already has access; no per-project OWNER row is
  created (teams grant others access).

### R6 — Superadmin floor invariant (replaces the per-project owner floor)
The old "≥1 owner per project" invariant (`getProjectOwnersCount`) is meaningless when
capability is global. Replace with a system-wide floor: **at least one superadmin must always
exist.** Enforce in R2 (group delete), R3 (user↔group set), and any `isGlobal` toggle:
reject the operation if it would drop the count of users holding an `isGlobal` group to zero.
Retire `getProjectOwnersCount` and the protected-admin add/keep/remove special-cases
(`projects.ts:531,610,645`) — superseded by the superadmin group + this floor.

### R7 — Retire `ADMIN_EMAIL` runtime checks
`isProtectedAdminEmail` and `getProtectedAdminEmails` (`project-access.ts:28-37`) are no
longer used for authorization (superadmin group is the source of truth). Keep `ADMIN_EMAIL`
**only** as the seed input that bootstraps the first `SUPERADMIN` assignment (2.2 R3/R7); drop
its use in `projects.ts`, `auth.ts` (`isSystemAdmin` in `/auth/me` becomes "holds an isGlobal
group"). Confirm no other caller during planning.

## Explicitly out of scope
- **Invite flow / PENDING → active, default group on invite, mailer** — Roadmap 2.4.
- **Frontend** (team builder, group assignment UI, superadmin console) — Roadmap 2.5. This
  item ships endpoints + `/auth/me` capability flags only.
- **Token/service-account → group mapping** (CI, MCP) — Phase 4.
- Fine-grained per-team roles or nested teams — not in this model.

## Acceptance criteria
- Scope catalog: `groups_assign` gone, `teams_manage` present; OWNER group seeds with
  `teams_manage`; the 2.2 seed reflects this.
- A superadmin can CRUD custom groups, edit their scopes, and set any user's groups; a
  non-superadmin is 403'd on every `/groups` and `/users/:id/groups` endpoint even with
  `teams_manage`.
- System groups reject edit/delete (409/400).
- A `teams_manage` holder can create a team, manage its members, and attach it to a project
  **they have authority on**, but is 403'd attaching it to a project where they lack
  `teams_manage` (project-gated by `requireScope`).
- `GET /projects/:id/members` returns the team-derived union with effective scopes; the old
  role-mutation endpoints return 404 (removed).
- `POST /projects` is superadmin-only; a former non-admin owner can no longer create projects
  (unchanged from today's admin-only behavior).
- The system refuses any operation that would leave zero superadmins.
- No authorization path calls `isProtectedAdminEmail`/`getProjectOwnersCount` after this item.

## Test approach
`node:test` + `node:assert/strict` via `tsx --test`; `Fastify().inject` + real Prisma per
`backend/tests/data-case-run.test.ts`.
- **Authority matrix:** superadmin vs `teams_manage`-holder vs plain member vs outsider
  against each endpoint class (group-def, user↔group, team CRUD, team↔project attach,
  members list, project create) → assert allow/403.
- **Project-gated attach:** a `teams_manage` holder attaches to an authorized project (allow)
  and an unauthorized one (403).
- **Superadmin floor:** attempts to remove the last superadmin via user↔group set, group
  delete, and isGlobal toggle all rejected.
- **Derived members:** two teams (overlapping users) attached to one project → `GET members`
  returns the correct de-duplicated union with each user's effective scopes.
- **System-group immutability:** PATCH/DELETE on VIEWER/EDITOR/OWNER/SUPERADMIN rejected.
