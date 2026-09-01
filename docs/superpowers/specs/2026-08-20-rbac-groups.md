# Spec — Scope-Based RBAC: Groups (capability) + Teams (membership) (Roadmap 2.2)

**Status:** Ready for planning
**Roadmap item:** Phase 2.2 — "Groups as bundles of scopes (roles reframed)", extended with
**Teams** (membership substrate; not in the original roadmap text — see Roadmap note).
**Plan:** `docs/superpowers/plans/2026-08-20-rbac-groups.md` (to be written)
**Depends on:** 2.1 (`docs/superpowers/specs/2026-08-20-rbac-scopes.md`) — the scope catalog,
`requireScope`/`can`, and the `resolveScopes` shim this item replaces.

## Model (confirmed with product)

Two orthogonal concepts:

- **Group = capability.** A named set of scopes. A user holds groups **globally**
  (`UserGroup(userId, groupId)` — no project). A user's capability is the union of their
  groups' scopes, and it is the same wherever they have access.
- **Team = membership.** A named collection of **users**, assigned to **projects**
  (many-to-many). Being on a team assigned to a project makes you a **member** of that
  project. A Team **enforces no scopes** — it only answers *who can see which projects*.

**Effective authority = Team (where) × Group (what).** On project P, a user may perform
`scope` iff they are a member of P (via any team assigned to P) **and** `scope` is in the
union of their groups' scopes. A **global group** (`Group.isGlobal`, e.g. `SUPERADMIN`)
applies without the membership gate — its scopes hold on every project.

> **Roadmap note:** ROADMAP.md 2.2 predates the Team concept and describes per-project group
> assignment. Update its wording to "global groups (capability) + teams (membership)"; the
> intent (union of scopes, seeded default tiers, superadmin as a global group) is unchanged.

## Problem

After 2.1, every route calls `requireScope(projectId, userId, scope)`, but scopes still come
from the `ProjectMember.role` enum via the `resolveScopes` shim (2.1 R2). This item makes
capability data-driven (groups) and membership a first-class collection (teams), retiring the
per-project `role` tier. The three legacy tiers seed as default groups; one team per existing
project preserves who-can-see-what.

## Verified current state

- **`ProjectMember`** (`schema.prisma:168-184`): `id, projectId, userId?, email, role
  ProjectRole, status @default(ACTIVE)`, `@@unique([projectId,email])`, `userId` nullable
  (PENDING invites have no user). Today this is *both* the membership record and the role
  carrier. Teams take over membership; `ProjectMember` is retained only as the **invite/email
  record** (2.4) — see R7.
- **`enum ProjectRole { OWNER EDITOR VIEWER }`** (`:206-210`) — retired once unreferenced.
- **`User`** (`:35-41`), **`Project`** (`:10-22`).
- **`resolveScopes(member)`** shim (2.1 R2) is the only reader of `role`; its body is replaced
  here and its signature changes (R4).
- **`getAccessibleProjectIds`** (`project-access.ts:73-85`) = projects with an ACTIVE
  membership; becomes team-derived (R5).
- **`canCreateProject`** (`:87-106`) reads `role` — breaks on column drop; rewritten (R6).
- **`getProjectAccess`** (`:51-71`) resolves `{project, member}` from `ProjectMember`; membership
  half moves to teams (R4/R5).
- **`seedProjectOwners`** (`seed.ts:41-68`) sets `role:'OWNER'`; rewritten (R7).
- Boot runs `prisma migrate deploy && prisma db seed` (`backend/Dockerfile:25`); seed must be
  idempotent. The migration must self-seed system groups (INSERT ... ON CONFLICT), not depend
  on seed order.

## Requirements

### R1 — Schema: Groups, Teams, and the `Scope` enum
```prisma
enum Scope {
  runs_read runs_trigger
  checks_read checks_edit
  schedules_read schedules_edit
  environments_read environments_edit environments_reveal_secrets
  alerts_read alerts_edit
  members_read teams_manage
  project_manage project_delete
}

model Group {
  id        String   @id @default(cuid())
  name      String   @unique          // VIEWER EDITOR OWNER SUPERADMIN + custom
  isSystem  Boolean  @default(false)   // seeded: not deletable, scopes authoritative
  isGlobal  Boolean  @default(false)   // scopes apply without team membership (SUPERADMIN)
  createdAt DateTime @default(now())
  scopes    GroupScope[]
  users     UserGroup[]
}

model GroupScope {
  groupId String
  scope   Scope
  group   Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([groupId, scope])
}

model UserGroup {                       // capability: user holds group GLOBALLY
  userId  String
  groupId String
  user    User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group   Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([userId, groupId])
  @@index([groupId])
}

model Team {                            // membership: collection of users → projects
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  members   TeamMember[]
  projects  TeamProject[]
}

model TeamMember {
  teamId String
  userId String
  team   Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([teamId, userId])
  @@index([userId])
}

model TeamProject {
  teamId    String
  projectId String
  team      Team    @relation(fields: [teamId], references: [id], onDelete: Cascade)
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@id([teamId, projectId])
  @@index([projectId])
}
```
Add back-relations on `User` (`groups UserGroup[]`, `teamMemberships TeamMember[]`) and
`Project` (`teams TeamProject[]`).
> Prisma enums can't contain `:`, so `Scope` uses underscores; keep one representation
> end-to-end (either standardize 2.1's `Scope` type on underscores, or add a `to/fromDbScope`
> converter). Decide in planning.

### R2 — Seed default groups (idempotent, `isSystem`)
- **VIEWER** (isGlobal=false) → `*_read`.
- **EDITOR** → VIEWER + `runs_trigger, checks_edit, schedules_edit, environments_edit,
  alerts_edit, environments_reveal_secrets`.
- **OWNER** → EDITOR + `project_manage, project_delete, teams_manage`.
- **SUPERADMIN** (isGlobal=true) → every `Scope`.
Upsert by `name`; for system groups the `GroupScope` set is authoritative (delete-absent on
boot so drift self-corrects). Both the **migration** (self-seed, for the backfill) and
`seed.ts` create these.

### R3 — Data migration: `ProjectMember.role` + membership → Groups + Teams
In the migration that adds the tables, before dropping `role`:
1. **Teams from projects.** For each `Project`, create one `Team` (name e.g. `"<project>
   Members"`), a `TeamProject(team, project)`, and a `TeamMember(team, userId)` for every
   ACTIVE `ProjectMember` with non-null `userId`. This preserves **membership exactly**.
2. **Groups from roles (flattened).** Global-per-user capability cannot hold two different
   roles for one user, so assign each user the group matching the **highest role they held in
   any project** (OWNER > EDITOR > VIEWER): one `UserGroup(userId, <maxRoleGroup>)`.
   > ⚠ **Intentional consequence of the global-capability model:** a user who was OWNER on
   > project A and VIEWER on project B becomes OWNER-capable on *both* (but still only a
   > member of the projects their teams cover). This is a deliberate flattening; the
   > alternative (per-team group assignment) was considered and declined.
3. **Superadmin.** For each protected-admin email present as a `User`, insert
   `UserGroup(userId, SUPERADMIN)`.
4. **PENDING invites** (`userId IS NULL`): no team/group yet. Record intent on the retained
   `ProjectMember` (add `invitedGroupId String?`, `invitedTeamId String?`; backfill from
   `role`/project). The invite flow (2.4) materializes them on accept.
5. Drop `ProjectMember.role`; retire `enum ProjectRole` if unreferenced.

### R4 — Resolver + `requireScope` (the 2.1 seam closes here)
Replace the shim. Two helpers:
```ts
async function memberOf(userId, projectId): Promise<boolean>
  // exists TeamMember(userId, teamId) ∧ TeamProject(teamId, projectId)
async function resolveUserScopes(userId): Promise<{ membershipScopes: Set<Scope>; globalScopes: Set<Scope> }>
  // union GroupScope of user's UserGroups, split by group.isGlobal
```
`requireScope(projectId, userId, scope)`:
- if `scope ∈ globalScopes` → **allow** (no membership needed).
- else if `await memberOf(userId, projectId)` **and** `scope ∈ membershipScopes` → allow.
- else 403 (404 if the project row is missing), preserving `ProjectAccessError.statusCode`
  so every existing catch block / `getProjectAccessStatusCode` is unchanged.
`can(...)` stays a pure `Set.has` over the appropriate set.

### R5 — `getAccessibleProjectIds` becomes team-derived
Return `{ TeamProject.projectId : user ∈ that team } ∪ (globalScopes non-empty ? all projects :
∅)`. With the R3 team backfill, the non-superadmin result equals today's membership set.

### R6 — Rewrite `canCreateProject`
Replace the `role` query with: user holds a group granting `project_manage` or `checks_edit`
(any group — capability is global now), **or** holds an `isGlobal` group (superadmin). Same
users qualify as before the drop.

### R7 — `ProjectMember` retained as invite/email record only; update seed
- `ProjectMember` keeps `projectId, email, userId?, status, invitedGroupId?, invitedTeamId?`;
  `role` removed. Membership is answered by teams, not this table. **This retention is a
  temporary bridge for PENDING invites only — 2.4 introduces a first-class `Invite` model,
  migrates pending rows into it, and drops `ProjectMember` entirely.** (Full invite semantics: 2.4.)
- `seedProjectOwners` (`seed.ts:41-68`): stop setting `role`. For a fresh install the admin
  user gets `UserGroup(admin, SUPERADMIN)` (global) — no per-project team required, since a
  global group covers every project. Keep it idempotent (upsert on the composite ids).

## Explicitly out of scope
- **Team management + group-assignment endpoints** (create team, add/remove members, assign
  team↔project, create/edit custom groups, assign user↔group) — Roadmap 2.3, gated by
  `groups_assign`/`project_manage`. This item ships the **model + seed + migration + resolver**
  only.
- **Invite flow / PENDING materialization** — Roadmap 2.4 (this item only records intent).
- **Frontend** (team/group UI, scope-based gating) — Roadmap 2.5. `/auth/me` unchanged here.
- Any use of custom (non-system) groups — only the four seeded groups exist until 2.3.

## Acceptance criteria
- Migration adds `Group, GroupScope, UserGroup, Team, TeamMember, TeamProject, Scope`; seeds
  VIEWER/EDITOR/OWNER (`isSystem`) + SUPERADMIN (`isGlobal`) with the exact R2 scope sets;
  creates one team per project containing that project's active members; assigns each user
  their max-role group and each protected admin the SUPERADMIN group; drops
  `ProjectMember.role`.
- `requireScope` allows iff (global scope) or (team-member of the project **and** membership
  scope); the full 2.1 route matrix passes with users now authorized via teams+groups — same
  allow/403 outcomes, except deliberate capability flattening (R3.2) for multi-role users.
- A member with only the VIEWER group sees masked env secrets; EDITOR group → unmasked.
- A SUPERADMIN (global group) passes `requireScope` on a project with **no** team membership.
- A user on no team assigned to project P is 403'd on P even if their groups grant the scope.
- `getAccessibleProjectIds` equals today's membership set for non-superadmins; all projects
  for superadmins.
- `canCreateProject` returns the same user set as before the column drop.
- Seed is idempotent; system-group scope sets self-correct on boot; nothing references
  `ProjectRole` after migration.

## Test approach
`node:test` + `node:assert/strict` via `tsx --test`.
- **Migration/seed:** fresh DB → migrate+seed → assert four groups + exact `GroupScope` sets,
  `isGlobal`/`isSystem` flags; run twice → no change.
- **Resolver unit:** users with (a) VIEWER group + team on projA, (b) EDITOR group + teams on
  projA & projB, (c) global SUPERADMIN, (d) EDITOR group but no team on projC → assert
  `requireScope` outcomes per project (membership × capability truth table, incl. superadmin
  bypass and the no-team 403).
- **Route regression:** re-run the 2.1 allow/403 matrix with team+group authorization;
  `Fastify().inject` + real Prisma, per `backend/tests/data-case-run.test.ts`.
- **Migration backfill:** seed ProjectMembers across roles/projects incl. a multi-role user
  and a PENDING row → run migration → assert one team per project with correct members,
  max-role group per user, and `invitedGroupId/invitedTeamId` on the pending row.
