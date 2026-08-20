# Spec — Scope-Based RBAC: Frontend Permission Gating + Access UI (Roadmap 2.5)

**Status:** Ready for planning
**Roadmap item:** Phase 2.5 — "Frontend permission gating"
**Plan:** `docs/superpowers/plans/2026-08-20-rbac-frontend.md` (to be written)
**Depends on:** 2.2 (scopes/groups/teams) · 2.3 (team + group/assignment endpoints) · 2.4
(invite endpoints + public accept page). This item is the UI over all of them.

## Problem

The frontend gates entirely on **role**:
- `AuthContext` exposes `canCreateProject`, `isSystemAdmin` — no scopes
  (`AuthContext.tsx:10-11,65,96`).
- `ProjectPage` computes `currentUserRole → isViewer/isEditor/isOwner` (`ProjectPage.tsx:544-546`)
  then `canWriteProject/canManageMembers/canManageSchedules/canManageEnvironments`
  (`:547-550`), used to gate ~every tab, button, and handler (`:660,962,1281,1456,1626,2047…`).
- Member management is a **role dropdown + add-with-password modal** calling
  `updateProjectMember`/`deleteProjectMember`/`POST members` (`:534,1393,1413-1435`) — endpoints
  **removed in 2.3 R5**.
- Types hardcode `ProjectRole`, `ProjectMemberStatus`, `currentUserRole`
  (`types/index.ts:110,116-125,137`).

After 2.2–2.4 authority is **scopes** (global capability via groups) × **teams** (membership),
superadmin owns capability, invites replace add-with-password. The UI must follow.

## Verified current state
- Gating flags: `ProjectPage.tsx:544-551`; usages at `:660,672,684,717,962,972,982,1013,1034,
  1048,1281,1307,1393,1413,1416,1424,1456,1626,2047,2050`.
- Member modal/handlers: `:530-537,1281-1435`.
- Source of role: `GET /projects/:id` sets `currentUserRole` (`projects.ts:219` path;
  `types/index.ts:110,137`).
- Auth state + `/auth/me` wiring: `AuthContext.tsx:23-24,65-72,96-106`.
- API client role calls live in `api/client.ts` (grep-flagged) — `updateProjectMember`,
  `deleteProjectMember`, `POST members`, member types.

## Requirements

### R1 — Server sends effective scopes, not role
- `GET /projects/:id` returns **`currentUserScopes: Scope[]`** (the caller's effective scopes
  on this project = global group scopes ∪ membership group scopes if team-member; from 2.2
  R4) instead of `currentUserRole`. Drop `currentUserRole`/`ProjectRole`/`ProjectMemberStatus`
  from `types/index.ts`; add `Scope` (mirror of the backend catalog).
- `/auth/me` + `/auth/login` (2.3 R7): `isSystemAdmin` → **`isSuperadmin`** (holds an
  `isGlobal` group). Keep `canCreateProject`. Optionally include the user's **global** scopes
  for cross-project gating (e.g. showing the superadmin console) — decide in planning; the
  minimal set is `isSuperadmin` + per-project `currentUserScopes`.

### R2 — `can()` gating primitive
- Add a small helper/hook: `useCan(scopes)` → `can(scope)` = `scopes.includes(scope)`, driven
  by `currentUserScopes` from the loaded project. Replace every role flag:
  | Old flag (`ProjectPage.tsx`) | New check |
  |---|---|
  | `isOwner`/`canManageMembers` (`:546,548`) | `can('teams:manage')` (team/membership); superadmin for group grants |
  | `canWriteProject` (`:547`) | per-feature scope at each site (below) |
  | `canManageSchedules` (`:549`) | `can('schedules:edit')` |
  | `canManageEnvironments` (`:550`) | `can('environments:edit')` |
  | check create/edit buttons | `can('checks:edit')` |
  | run/trigger buttons | `can('runs:trigger')` |
  | alerts/channel edits | `can('alerts:edit')` |
  | `isViewer` read-only banner (`:1626`) | no `*:edit` scope present |
- Gate the **guard clauses** in handlers too (`:660,962,1281,…`) on the matching scope, not
  just the buttons — belt and braces (server already enforces via `requireScope`).

### R3 — Replace member management with Teams + invites (per project, delegated)
On the project **Members tab** (`ProjectTabKey 'members'`, gated `can('members:read')`):
- **Derived member list** from `GET /projects/:id/members` (2.3 R5): each user with their
  team(s) and effective scopes/groups. No role column.
- **Team controls** (gated `can('teams:manage')`):
  - View teams attached to the project; create a team + attach it; detach.
  - Add/remove existing users to/from a team (`/teams/:id/members`).
- **Invite** (replaces add-with-password modal): a modal collecting `email` + optional team;
  calls `POST /invites` (2.4). The **group/capability field appears only for superadmins**
  (2.3: capability is superadmin-only). Show **pending invites** (`GET /invites`) with
  revoke.
- **Remove** `updateProjectMember`/`deleteProjectMember`/add-with-password and their modal
  state (`:530-537,1281-1435`) and the `api/client.ts` calls.

### R4 — Superadmin Access console (global)
New top-level area, route-guarded on `isSuperadmin` (hidden otherwise):
- **Groups:** list groups (system vs custom, their scopes); create/edit/delete **custom**
  groups with a scope multi-select; system groups shown read-only (2.3 R2).
- **Users & assignment:** list users (`GET /users`); assign/unassign each user's **global
  groups** (`PUT /users/:id/groups`) (2.3 R3). Surface the superadmin-floor error (2.3 R6)
  inline.
- **Teams (global view):** optional — manage teams and their project attachments across
  projects (superadmin sees all). Per-project team management already covered in R3.

### R5 — Public accept-invite page (from 2.4 R7)
`AcceptInvitePage` at `/accept-invite?token=` — unauthenticated route: validate token
(`GET /auth/invite`), collect password, `POST /auth/accept-invite`, then redirect to login (or
auto-login if 2.4 returns a token). Already specced in 2.4; listed here as the frontend router
must register it as public and exclude it from the auth guard.

### R6 — Project creation gating
`canCreateProject` still drives the "New project" affordance (`ProjectsPage.tsx`). With 2.3 R5
`POST /projects` superadmin-only, `canCreateProject` reflects that; keep the existing gate,
just ensure it reads the new flag. No role references remain in `ProjectsPage.tsx`.

## Explicitly out of scope
- Backend behavior (all in 2.2–2.4); this item only consumes the new endpoints + payload
  fields (`currentUserScopes`, `isSuperadmin`).
- Token/service-account UI (CI/MCP) — Phase 4.
- Visual redesign beyond swapping controls; reuse existing AntD components/patterns.
- Real-time scope updates (a user regains access without reload) — a page refresh re-reads
  `/auth/me` + project; live push is out of scope.

## Acceptance criteria
- No `ProjectRole`/`currentUserRole`/`isOwner`/`isEditor`/`isViewer`/`isSystemAdmin` remain in
  the frontend (grep-clean); gating is `can(scope)` + `isSuperadmin`.
- A user with only read scopes sees every edit/trigger/manage control hidden or disabled and
  the read-only banner; matching the server's 403s (no dead buttons).
- A `teams:manage` user can create/attach teams, manage membership, and invite (email + team)
  on their project, but sees **no** group/capability field and no superadmin console.
- A superadmin sees the Access console: manages custom groups, assigns user↔group, and the
  superadmin-floor error renders when they try to remove the last superadmin.
- The Members tab shows the team-derived member list with effective scopes; the old role
  dropdown and add-with-password modal are gone, along with their client calls.
- `/accept-invite` works unauthenticated end-to-end (invite → email/log link → set password →
  login).
- Creating a project is offered only when `canCreateProject` is true (superadmin).

## Test approach
Frontend pure helpers as unit tests (`node:test` via the existing frontend test setup, cf.
`frontend/tests/run-batch-utils.test.ts`):
- **`can()` / scope-gating helper:** truth table over representative scope sets (read-only,
  editor-equivalent, teams-manage, superadmin) → asserts which controls each unlocks.
- **Payload adapters:** mapping `currentUserScopes`/`isSuperadmin` into the gating flags.
- Component-level gating (which buttons render) is verified by the helper tests + manual/QA;
  no new e2e framework introduced (YAGNI — matches the repo's current frontend test depth).
- Backend contract (`currentUserScopes`, `isSuperadmin`, members payload) is covered by the
  2.2–2.4 route tests; this item asserts the client consumes those shapes.
