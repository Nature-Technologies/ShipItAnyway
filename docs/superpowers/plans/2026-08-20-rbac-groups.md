# Scope-Based RBAC: Groups (capability) + Teams (membership) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make capability data-driven (Groups = a global bundle of scopes) and membership a first-class collection (Teams = users → projects), retiring the per-project `ProjectMember.role` tier. Effective authority on project P = **Team (where) × Group (what)**: `requireScope(P, user, scope)` allows iff `scope` is in a global group's scopes (bypasses membership) **or** the user is a member of P via some team **and** `scope` is in a membership group's scopes.

**Architecture:** Add `Group`/`GroupScope` (capability), `UserGroup` (global user↔group, no project), `Team`/`TeamMember`/`TeamProject` (membership), and a Prisma `Scope` enum (underscored). Ship it via Prisma **expand/contract**: an additive migration adds the tables, **self-seeds** the four system groups (`INSERT … ON CONFLICT`), and **backfills** teams + max-role groups from existing `ProjectMember` rows — leaving `role` in place so the codebase stays green; a later **contract** migration drops `ProjectMember.role` and retires `enum ProjectRole` once nothing reads them. The 2.1 `resolveScopes` shim body and `requireScope` internals are replaced to read groups+teams. `ProjectMember` survives only as the invite/email bridge (dropped in 2.4).

**Tech Stack:** Node 22, Fastify 5, Prisma (PostgreSQL), TypeScript strict. Tests: `node:test` + `node:assert/strict` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-rbac-groups.md`

## Global Constraints

- Node 22 (backend), TypeScript strict. Prisma migrations are timestamped dirs `<YYYYMMDDHHMMSS>_<snake_case>/migration.sql`; boot runs `prisma migrate deploy && prisma db seed` (`backend/Dockerfile:25`), so **seed must be idempotent** and the **migration must self-seed** system groups (`INSERT … ON CONFLICT`) rather than depend on seed order.
- Create migrations via `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name <name>`, then **hand-edit** the generated `migration.sql` to add the self-seed + backfill SQL before it is applied.
- Run backend tests with `cd backend && npx dotenv -e ../.env -- tsx --test tests/<file>.test.ts`. Integration tests require the compose `db` + `redis` services up. Route/DB tests use `Fastify().inject` + a `preHandler` stub setting `req.user`, real Prisma, and the harness helpers in `backend/tests/data-case-run.test.ts`.
- **One scope representation end-to-end:** the Prisma-generated `Scope` enum (underscored, e.g. `runs_read`) is authoritative. Task 3 re-exports it as the `Scope` type, replacing 2.1's literal-union shim type — no `to/fromDbScope` converter.
- **Expand/contract discipline:** every task must leave `tsc --noEmit` and the existing test suite green. `ProjectMember.role` is dropped only in the final task, after the resolver, seed, and harness stop reading it.
- Branding stays "ShipItAnyway".

**Consumes from 2.1** (already present in `backend/src/utils/project-access.ts`): `requireScope(projectId, userId, scope)`, `can(...)`, the `Scope` type, and the `resolveScopes` shim (reads `ProjectMember.role`). This plan replaces the shim body + `requireScope` internals and standardizes the `Scope` type on the Prisma enum. 2.1 route call sites already pass underscored scope literals.

---

### Task 1: Schema — `Scope` enum + Group/Team tables + expand migration (self-seed + backfill)

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `enum Scope`; `Group`, `GroupScope`, `UserGroup`, `Team`, `TeamMember`, `TeamProject`; back-relations on `User` ~35-41 and `Project` ~10-22; add `ProjectMember.invitedGroupId?`/`invitedTeamId?` ~168-184 — **do not** drop `role` yet)
- Create: `backend/src/constants/rbac.ts` (single source of truth for the four system groups + their scope sets)
- Create: `backend/prisma/migrations/<new-timestamp>_add_rbac_groups_teams/migration.sql` (hand-edited: self-seed + backfill)
- Test: `backend/tests/rbac-migration.test.ts`

**Interfaces:**
- Consumes: existing `ProjectMember(projectId, userId?, email, role, status)` rows, `getProtectedAdminEmails()` semantics (protected-admin emails from `ADMIN_EMAIL` + `FALLBACK_ADMIN_EMAIL`).
- Produces:
  - Prisma models `Group`, `GroupScope`, `UserGroup`, `Team`, `TeamMember`, `TeamProject` and `enum Scope` (15 underscored values).
  - `SYSTEM_GROUPS: { name; isGlobal; scopes: Scope[] }[]` in `backend/src/constants/rbac.ts` (VIEWER/EDITOR/OWNER/SUPERADMIN, all `isSystem`).
  - A migrated DB where the four system groups exist with the exact R2 scope sets, one `Team` per project holds that project's active members, each user holds their max-role group, and each protected-admin `User` holds SUPERADMIN.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-migration.test.ts`. It asserts the migration's **self-seed** (deterministic against the migrated+seeded dev DB) — the four system groups exist with the exact scope sets + flags:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { SYSTEM_GROUPS } from '../src/constants/rbac';

test('system groups are self-seeded with exact scope sets and flags', async () => {
  try {
    for (const spec of SYSTEM_GROUPS) {
      const group = await prisma.group.findUnique({
        where: { name: spec.name },
        include: { scopes: true }
      });
      assert.ok(group, `${spec.name} group missing`);
      assert.equal(group!.isSystem, true);
      assert.equal(group!.isGlobal, spec.isGlobal);
      assert.deepEqual(
        group!.scopes.map((s) => s.scope).sort(),
        [...spec.scopes].sort()
      );
    }
    const superadmin = SYSTEM_GROUPS.find((g) => g.name === 'SUPERADMIN')!;
    assert.equal(superadmin.isGlobal, true);
    assert.equal(superadmin.scopes.length, 15); // every Scope
  } finally {
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-migration.test.ts`
Expected: FAIL — `../src/constants/rbac` missing / `prisma.group` undefined (model not generated).

- [ ] **Step 3: Add the scope catalog constant**

Create `backend/src/constants/rbac.ts` (the exact R2 tiers; `Scope` comes from the client generated in Step 5, so type as the Prisma enum):

```ts
import { Scope } from '@prisma/client';

const READ: Scope[] = [
  Scope.runs_read, Scope.checks_read, Scope.schedules_read,
  Scope.environments_read, Scope.alerts_read, Scope.members_read
];
const EDITOR_ADD: Scope[] = [
  Scope.runs_trigger, Scope.checks_edit, Scope.schedules_edit,
  Scope.environments_edit, Scope.alerts_edit, Scope.environments_reveal_secrets
];
const OWNER_ADD: Scope[] = [
  Scope.project_manage, Scope.project_delete, Scope.teams_manage
];

const VIEWER_SCOPES = READ;
const EDITOR_SCOPES = [...READ, ...EDITOR_ADD];
const OWNER_SCOPES = [...EDITOR_SCOPES, ...OWNER_ADD];
const ALL_SCOPES = Object.values(Scope);

export const SYSTEM_GROUPS: { name: string; isGlobal: boolean; scopes: Scope[] }[] = [
  { name: 'VIEWER', isGlobal: false, scopes: VIEWER_SCOPES },
  { name: 'EDITOR', isGlobal: false, scopes: EDITOR_SCOPES },
  { name: 'OWNER', isGlobal: false, scopes: OWNER_SCOPES },
  { name: 'SUPERADMIN', isGlobal: true, scopes: ALL_SCOPES }
];

// Highest role a legacy ProjectMember could hold → the group a user is flattened to.
export const ROLE_TO_GROUP: Record<'OWNER' | 'EDITOR' | 'VIEWER', string> = {
  OWNER: 'OWNER', EDITOR: 'EDITOR', VIEWER: 'VIEWER'
};
```

- [ ] **Step 4: Add the models + enum to `schema.prisma`**

Add the `Scope` enum and models exactly per spec R1 (`enum Scope { runs_read runs_trigger checks_read checks_edit schedules_read schedules_edit environments_read environments_edit environments_reveal_secrets alerts_read alerts_edit members_read teams_manage project_manage project_delete }`, and `Group`, `GroupScope`, `UserGroup`, `Team`, `TeamMember`, `TeamProject`). Then:

- On `model User` (~35-41) add: `groups UserGroup[]` and `teamMemberships TeamMember[]`.
- On `model Project` (~10-22) add: `teams TeamProject[]`.
- On `model ProjectMember` (~168-184) add: `invitedGroupId String?` and `invitedTeamId String?` (nullable; record invite intent for PENDING rows). **Keep** `role ProjectRole` for now.

- [ ] **Step 5: Create the expand migration, then hand-edit it**

Run: `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name add_rbac_groups_teams`
This generates the `CREATE TYPE "Scope" …`, `CREATE TABLE "Group"/"GroupScope"/"UserGroup"/"Team"/"TeamMember"/"TeamProject"`, and `ALTER TABLE "ProjectMember" ADD COLUMN "invitedGroupId"/"invitedTeamId"`. Append the **self-seed + backfill** to the generated `migration.sql` (idempotent, ordered):

```sql
-- Self-seed system groups (INSERT … ON CONFLICT so re-apply is a no-op)
INSERT INTO "Group" ("id","name","isSystem","isGlobal","createdAt") VALUES
  ('grp_viewer','VIEWER',true,false,CURRENT_TIMESTAMP),
  ('grp_editor','EDITOR',true,false,CURRENT_TIMESTAMP),
  ('grp_owner','OWNER',true,false,CURRENT_TIMESTAMP),
  ('grp_superadmin','SUPERADMIN',true,true,CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Group → scopes (must match SYSTEM_GROUPS in backend/src/constants/rbac.ts)
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_viewer', s FROM unnest(ARRAY[
  'runs_read','checks_read','schedules_read','environments_read','alerts_read','members_read'
]::"Scope"[]) AS s
ON CONFLICT DO NOTHING;
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_editor', s FROM unnest(ARRAY[
  'runs_read','checks_read','schedules_read','environments_read','alerts_read','members_read',
  'runs_trigger','checks_edit','schedules_edit','environments_edit','alerts_edit','environments_reveal_secrets'
]::"Scope"[]) AS s
ON CONFLICT DO NOTHING;
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_owner', s FROM unnest(ARRAY[
  'runs_read','checks_read','schedules_read','environments_read','alerts_read','members_read',
  'runs_trigger','checks_edit','schedules_edit','environments_edit','alerts_edit','environments_reveal_secrets',
  'project_manage','project_delete','teams_manage'
]::"Scope"[]) AS s
ON CONFLICT DO NOTHING;
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_superadmin', s FROM unnest(enum_range(NULL::"Scope")) AS s
ON CONFLICT DO NOTHING;

-- Backfill 1: one Team per Project + TeamProject, with active members as TeamMembers
INSERT INTO "Team" ("id","name","createdAt")
SELECT 'team_' || p."id", p."name" || ' Members', CURRENT_TIMESTAMP
FROM "Project" p
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TeamProject" ("teamId","projectId")
SELECT 'team_' || p."id", p."id" FROM "Project" p
ON CONFLICT DO NOTHING;

INSERT INTO "TeamMember" ("teamId","userId")
SELECT DISTINCT 'team_' || pm."projectId", pm."userId"
FROM "ProjectMember" pm
WHERE pm."status" = 'ACTIVE' AND pm."userId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill 2: each user → the group of their MAX role across all projects (OWNER>EDITOR>VIEWER)
INSERT INTO "UserGroup" ("userId","groupId")
SELECT ranked."userId",
       CASE ranked.max_rank WHEN 3 THEN 'grp_owner' WHEN 2 THEN 'grp_editor' ELSE 'grp_viewer' END
FROM (
  SELECT pm."userId" AS "userId",
         MAX(CASE pm."role" WHEN 'OWNER' THEN 3 WHEN 'EDITOR' THEN 2 ELSE 1 END) AS max_rank
  FROM "ProjectMember" pm
  WHERE pm."status" = 'ACTIVE' AND pm."userId" IS NOT NULL
  GROUP BY pm."userId"
) ranked
ON CONFLICT DO NOTHING;

-- Backfill 3: protected-admin emails present as Users → SUPERADMIN (global).
-- Replace the email list with getProtectedAdminEmails() values for this deployment
-- (ADMIN_EMAIL + FALLBACK_ADMIN_EMAIL 'admin@shipitanyway.app', lower-cased).
INSERT INTO "UserGroup" ("userId","groupId")
SELECT u."id", 'grp_superadmin'
FROM "User" u
WHERE lower(u."email") IN ('admin@shipitanyway.app')
ON CONFLICT DO NOTHING;

-- Backfill 4: record invite intent on PENDING (userId IS NULL) ProjectMember rows
UPDATE "ProjectMember" pm SET
  "invitedTeamId"  = 'team_' || pm."projectId",
  "invitedGroupId" = CASE pm."role" WHEN 'OWNER' THEN 'grp_owner'
                                    WHEN 'EDITOR' THEN 'grp_editor' ELSE 'grp_viewer' END
WHERE pm."userId" IS NULL;
```

Apply it (the `prisma migrate dev` invocation that generated the file applies it once; if the file was already applied before editing, create the migration empty-then-edit is avoided by editing **before** first apply — so run `prisma migrate dev` again only if it reports the migration as pending). On prod, `migrate deploy` applies the whole file.

> The historical team/group backfill is a **one-shot** data migration; its correctness for pre-existing rows is verified once at apply time (Step 7 manual check) and behaviorally guaranteed by the resolver tests in Task 3. The automated test here pins the self-seed, which is re-runnable and deterministic.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-migration.test.ts`
Expected: PASS — four groups with exact scope sets + flags.

- [ ] **Step 7: Manually verify the historical backfill (one-shot)**

Against a DB that had pre-existing `ProjectMember` rows (e.g. a staging copy), after `migrate deploy` run:

```sql
-- one team per project holding exactly the active members
SELECT p."id", count(tm.*) FROM "Project" p
  JOIN "TeamProject" tp ON tp."projectId"=p."id"
  LEFT JOIN "TeamMember" tm ON tm."teamId"=tp."teamId" GROUP BY p."id";
-- each user's single max-role group; PENDING rows carry invited*.
SELECT ug."userId", g."name" FROM "UserGroup" ug JOIN "Group" g ON g."id"=ug."groupId";
SELECT "email","invitedTeamId","invitedGroupId" FROM "ProjectMember" WHERE "userId" IS NULL;
```

Expected: member counts equal today's active memberships; multi-role users hold their highest tier's group; protected admins additionally hold SUPERADMIN; PENDING rows have `invited*` set.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma backend/src/constants/rbac.ts backend/tests/rbac-migration.test.ts
git commit -m "feat(rbac): add Scope enum, Group/Team tables + expand migration (self-seed + backfill)"
```

---

### Task 2: Seed system groups idempotently + rewrite `seedProjectOwners`

**Files:**
- Modify: `backend/prisma/seed.ts` (add `seedSystemGroups()`; rewrite `seedProjectOwners` ~41-68 → assign SUPERADMIN global group)
- Test: `backend/tests/rbac-seed.test.ts`

**Interfaces:**
- Consumes: `SYSTEM_GROUPS` (Task 1), `getProtectedAdminEmails()` / `FALLBACK_ADMIN_EMAIL`.
- Produces:
  - `seedSystemGroups(): Promise<void>` — upserts the four groups by `name`; for each, the `GroupScope` set is **authoritative** (delete-absent then re-add) so drift self-corrects on boot.
  - `seedProjectOwners(userId)` rewritten to grant `UserGroup(userId, SUPERADMIN)` idempotently (no per-project `ProjectMember` role row). Same fresh-install effect: the admin can act on every project via the global group.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-seed.test.ts`. Invoke the seed helpers twice and assert stability + admin SUPERADMIN:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { seedSystemGroups, seedAdminSuperGroup } from '../prisma/seed';

test('seedSystemGroups is idempotent and scope sets self-correct', async () => {
  try {
    await seedSystemGroups();
    // introduce drift, then re-seed
    const owner = await prisma.group.findUniqueOrThrow({ where: { name: 'OWNER' } });
    await prisma.groupScope.deleteMany({ where: { groupId: owner.id, scope: 'project_delete' } });
    await seedSystemGroups();
    const fixed = await prisma.groupScope.findFirst({
      where: { groupId: owner.id, scope: 'project_delete' }
    });
    assert.ok(fixed, 'authoritative re-seed restored the missing scope');

    const groups = await prisma.group.findMany({ where: { isSystem: true } });
    assert.equal(groups.length, 4);
  } finally {
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

(Export `seedSystemGroups` and a small `seedAdminSuperGroup(userId)` from `seed.ts`; guard the `main()` auto-run with `if (process.argv[1]?.includes('seed'))` or an `import.meta`-style check so importing the module in a test does not run the CLI seed.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-seed.test.ts`
Expected: FAIL — `seedSystemGroups` not exported.

- [ ] **Step 3: Implement `seedSystemGroups`**

In `backend/prisma/seed.ts`, add (reusing the Task 1 catalog so seed and migration never diverge):

```ts
import { SYSTEM_GROUPS } from '../src/constants/rbac';

export async function seedSystemGroups() {
  for (const spec of SYSTEM_GROUPS) {
    const group = await prisma.group.upsert({
      where: { name: spec.name },
      update: { isSystem: true, isGlobal: spec.isGlobal },
      create: { name: spec.name, isSystem: true, isGlobal: spec.isGlobal }
    });
    // GroupScope set is authoritative for system groups
    await prisma.groupScope.deleteMany({
      where: { groupId: group.id, scope: { notIn: spec.scopes } }
    });
    for (const scope of spec.scopes) {
      await prisma.groupScope.upsert({
        where: { groupId_scope: { groupId: group.id, scope } },
        update: {},
        create: { groupId: group.id, scope }
      });
    }
  }
}
```

- [ ] **Step 4: Rewrite `seedProjectOwners` → SUPERADMIN global group**

Replace `seedProjectOwners` (~41-68) with an idempotent `seedAdminSuperGroup(userId)` that upserts one `UserGroup(userId, SUPERADMIN)` (composite-id upsert) — no `ProjectMember` row, no `role`. In `main()`, call `await seedSystemGroups()` first, then `await seedAdminSuperGroup(ownerUser.id)`:

```ts
export async function seedAdminSuperGroup(userId: string) {
  const superadmin = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId: superadmin.id } },
    update: {},
    create: { userId, groupId: superadmin.id }
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/seed.ts backend/tests/rbac-seed.test.ts
git commit -m "feat(rbac): idempotent system-group seed + admin SUPERADMIN grant"
```

---

### Task 3: Resolver — replace the 2.1 shim, `memberOf`, `requireScope`, `getAccessibleProjectIds`, `canCreateProject`

**Files:**
- Modify: `backend/src/utils/project-access.ts` (replace `resolveScopes` shim body + `requireScope` internals from 2.1; add `memberOf`; rewrite `getAccessibleProjectIds` ~73-85 and `canCreateProject` ~87-106; re-export Prisma `Scope`)
- Modify: `backend/src/routes/projects.ts` (Step 4b — `currentUserRole` → `currentUserScopes` at `:20`, `:195`, `:365`; last `role` readers, produces the field 2.5 consumes)
- Modify: `backend/tests/data-case-run.test.ts` (harness `createProjectAccess` ~29-53 and the VIEWER member setup ~564-572 → teams + groups)
- Test: `backend/tests/rbac-resolver.test.ts`

**Interfaces:**
- Consumes: `Group`/`GroupScope`/`UserGroup`/`Team`/`TeamMember`/`TeamProject` (Task 1), 2.1's `requireScope`/`can` call sites and `ProjectAccessError.statusCode` convention.
- Produces:
  - `resolveScopes(userId: string, projectId: string): Promise<Set<Scope>>` — the **effective** scope set on P: `globalScopes ∪ (memberOf(P) ? membershipScopes : ∅)`. Replaces 2.1's `resolveScopes(member)`.
  - `memberOf(userId: string, projectId: string): Promise<boolean>` — exists `TeamMember(user) ∧ TeamProject(team, project)`.
  - `requireScope(projectId, userId, scope)` — allow iff `scope ∈ resolveScopes(userId, projectId)`; else 403, or 404 if the project row is missing (preserving `statusCode` so every 2.1 catch block / `getProjectAccessStatusCode` is unchanged). `can(...)` stays a pure `Set.has`.
  - `getAccessibleProjectIds(userId)` — team-derived project ids `∪ (globalScopes non-empty ? all project ids : ∅)`.
  - `canCreateProject(userId, email)` — true iff user holds a group granting `project_manage` or `checks_edit`, **or** any `isGlobal` group.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-resolver.test.ts` — the membership × capability truth table plus superadmin bypass, no-team 403, and secret masking. Build fixtures directly (groups already seeded by the migration):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { requireScope, getAccessibleProjectIds, getProjectAccessStatusCode } from '../src/utils/project-access';

async function grant(userId: string, groupName: string) {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.create({ data: { userId, groupId: g.id } });
}
async function team(projectId: string, userIds: string[]) {
  const t = await prisma.team.create({ data: { name: 'T', projects: { create: { projectId } } } });
  for (const userId of userIds) await prisma.teamMember.create({ data: { teamId: t.id, userId } });
  return t;
}

test('requireScope enforces membership × capability, superadmin bypass, no-team 403', async () => {
  const [projA, projB, projC] = await Promise.all(
    ['A', 'B', 'C'].map((n) => prisma.project.create({ data: { name: `rbac-${n}-${Date.now()}` } }))
  );
  const mk = (tag: string) => prisma.user.create({
    data: { email: `rbac-${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, passwordHash: 'x' }
  });
  const [viewer, editor, admin, noteam] = await Promise.all([mk('v'), mk('e'), mk('s'), mk('n')]);
  try {
    await grant(viewer.id, 'VIEWER'); await team(projA.id, [viewer.id]);
    await grant(editor.id, 'EDITOR'); await team(projA.id, [editor.id]); await team(projB.id, [editor.id]);
    await grant(admin.id, 'SUPERADMIN');                  // global, no team
    await grant(noteam.id, 'EDITOR');                     // capability but no team on projC

    // viewer: read on A yes, edit on A no, anything on B no (not a member)
    await assert.doesNotReject(requireScope(projA.id, viewer.id, 'runs_read'));
    await assert.rejects(requireScope(projA.id, viewer.id, 'checks_edit'), (e) => getProjectAccessStatusCode(e) === 403);
    await assert.rejects(requireScope(projB.id, viewer.id, 'runs_read'), (e) => getProjectAccessStatusCode(e) === 403);

    // editor: edit on A and B
    await assert.doesNotReject(requireScope(projB.id, editor.id, 'checks_edit'));

    // superadmin: passes on projC with NO team membership
    await assert.doesNotReject(requireScope(projC.id, admin.id, 'project_delete'));

    // capability without membership → 403 on projC
    await assert.rejects(requireScope(projC.id, noteam.id, 'checks_edit'), (e) => getProjectAccessStatusCode(e) === 403);

    // accessible ids: editor sees A+B; superadmin sees all
    assert.deepEqual((await getAccessibleProjectIds(editor.id)).sort(), [projA.id, projB.id].sort());
    assert.ok((await getAccessibleProjectIds(admin.id)).includes(projC.id));
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: [projA.id, projB.id, projC.id] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, editor.id, admin.id, noteam.id] } } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-resolver.test.ts`
Expected: FAIL — `requireScope` still reads `ProjectMember.role` via the 2.1 shim; no-team users are wrongly allowed / members wrongly denied.

- [ ] **Step 3: Rewrite the resolver in `project-access.ts`**

Replace the 2.1 shim + `requireScope` internals; re-export `Scope` from `@prisma/client` (drop 2.1's literal-union type). Keep the `ProjectAccessError`/`statusCode` shape:

```ts
import { Scope } from '@prisma/client';
export { Scope };

export async function memberOf(userId: string, projectId: string): Promise<boolean> {
  const hit = await prisma.teamMember.findFirst({
    where: { userId, team: { projects: { some: { projectId } } } },
    select: { teamId: true }
  });
  return Boolean(hit);
}

async function resolveUserScopes(userId: string): Promise<{ membershipScopes: Set<Scope>; globalScopes: Set<Scope> }> {
  const rows = await prisma.userGroup.findMany({
    where: { userId },
    select: { group: { select: { isGlobal: true, scopes: { select: { scope: true } } } } }
  });
  const membershipScopes = new Set<Scope>();
  const globalScopes = new Set<Scope>();
  for (const { group } of rows) {
    for (const { scope } of group.scopes) (group.isGlobal ? globalScopes : membershipScopes).add(scope);
  }
  return { membershipScopes, globalScopes };
}

export async function resolveScopes(userId: string, projectId: string): Promise<Set<Scope>> {
  const { membershipScopes, globalScopes } = await resolveUserScopes(userId);
  if (globalScopes.size === 0 && !(await memberOf(userId, projectId))) return globalScopes; // empty
  const effective = new Set<Scope>(globalScopes);
  if (await memberOf(userId, projectId)) for (const s of membershipScopes) effective.add(s);
  return effective;
}
```

> Optimization note (ponytail): `resolveScopes` calls `memberOf` at most twice; fold into one lookup if a hot route shows up — one query today, fine.

Rewrite `requireScope` to allow iff `scope ∈ resolveScopes(userId, projectId)`, else throw `403`, or `404` when `prisma.project.findUnique` is null (same `statusCode` convention as the current `requireProjectRole` ~108-130). `can(projectId, userId, scope)` returns `(await resolveScopes(...)).has(scope)`.

- [ ] **Step 4: Rewrite `getAccessibleProjectIds` + `canCreateProject`**

```ts
export async function getAccessibleProjectIds(userId: string): Promise<string[]> {
  const { globalScopes } = await resolveUserScopes(userId);
  if (globalScopes.size > 0) {
    const all = await prisma.project.findMany({ select: { id: true } });
    return all.map((p) => p.id);
  }
  const links = await prisma.teamProject.findMany({
    where: { team: { members: { some: { userId } } } },
    select: { projectId: true }
  });
  return [...new Set(links.map((l) => l.projectId))];
}

export async function canCreateProject(userId: string, _email: string): Promise<boolean> {
  const rows = await prisma.userGroup.findMany({
    where: { userId },
    select: { group: { select: { isGlobal: true, scopes: { select: { scope: true } } } } }
  });
  return rows.some(({ group }) =>
    group.isGlobal || group.scopes.some((s) => s.scope === 'project_manage' || s.scope === 'checks_edit')
  );
}
```

(`canCreateProject` no longer needs the `email`/`isProtectedAdminEmail` branch — the migration/seed already put protected admins in the SUPERADMIN `isGlobal` group. Keep the `_email` param for the 2.1 call-site signature.)

- [ ] **Step 4b: Emit `currentUserScopes` from `projects.ts` (last `role` readers + the field 2.5 consumes)**

`backend/src/routes/projects.ts` still reads `member.role` to emit `currentUserRole` at two sites, and types it at `:20` — these are the last `ProjectRole`/`.role` readers outside the invite bridge and would break `tsc` at Task 4's drop. Convert them to emit the caller's effective scopes (the exact field the 2.5 frontend gates on):

- `:20` in the response type: `currentUserRole: ProjectRole | null;` → `currentUserScopes: Scope[];` (import `Scope` from `../utils/project-access`; drop the `ProjectRole` import if now unused).
- Detail route `:365`: `currentUserRole: access.member.role,` → `currentUserScopes: Array.from(await resolveScopes(userId, project.id)),`.
- List route `:195`: `currentUserRole: project.members[0]?.role ?? null,` → `currentUserScopes: Array.from(await resolveScopes(userId, project.id)),`. This is inside the per-project map — make that map callback `async` and `await Promise.all(...)`, or resolve scopes for the accessible ids in one pass before building the list. **ponytail:** N per-project resolver calls here is fine at current project counts; batch only if it measurably hurts.

> Produces the `currentUserScopes: Scope[]` field on `GET /projects` and `GET /projects/:id` that Plan 2.5 (`AuthContext`/`ProjectPage` gating) consumes. No `currentUserRole` remains after this step.

- [ ] **Step 5: Update the test harness to teams + groups**

In `backend/tests/data-case-run.test.ts`, `createProjectAccess` (~42-50) currently creates a `ProjectMember` with `role: 'OWNER'` — that breaks when `role` drops (Task 4) and no longer authorizes under the resolver. Replace with: grant `UserGroup(user, OWNER)` and create a `Team` + `TeamMember(user)` + `TeamProject(project)`. Add a `createTeamMember(projectId, userId, groupName)` helper and use it for the VIEWER member (~564-572) too:

```ts
async function joinProject(projectId: string, userId: string, groupName: 'OWNER' | 'VIEWER') {
  const g = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId: g.id } }, update: {}, create: { userId, groupId: g.id }
  });
  await prisma.team.create({
    data: { name: 'harness', projects: { create: { projectId } }, members: { create: { userId } } }
  });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-resolver.test.ts` then re-run `tests/data-case-run.test.ts`.
Expected: PASS — resolver truth table green; the data-case route regression still passes with team+group authorization (masked env secrets for VIEWER, unmasked for OWNER — the existing `redactEnvironmentVariables` path now keyed off `can(..., 'environments_reveal_secrets')`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/project-access.ts backend/src/routes/projects.ts backend/tests/data-case-run.test.ts backend/tests/rbac-resolver.test.ts
git commit -m "feat(rbac): resolve scopes from groups+teams (membership × capability, superadmin bypass); emit currentUserScopes"
```

---

### Task 4: Contract migration — drop `ProjectMember.role`, retire `enum ProjectRole`

**Files:**
- Modify: `backend/prisma/schema.prisma` (remove `role` from `ProjectMember` ~173; remove `enum ProjectRole` ~206-210)
- Create: `backend/prisma/migrations/<new-timestamp>_drop_project_member_role/migration.sql`
- Modify: `backend/src/utils/project-access.ts` (purge remaining `ProjectRole`/`role` references — `ROLE_RANK` ~18-22, `hasProjectRole` ~47-49, `roleAtLeast` ~138-140, `requireProjectRole` ~108-130 if now unused, `getProjectOwnersCount` role filter ~155-159, `upsertProjectMember` `role` field ~161-188, `getProjectAccess` `member.role` typing ~51-71)
- Test: full-suite regression gate (no new test file — this is a pure removal verified by `tsc` + green suite)

**Interfaces:**
- Consumes: Task 3 (nothing reads `ProjectMember.role` anymore).
- Produces: `ProjectMember` without `role`; `enum ProjectRole` gone; `Scope`-based resolver is the sole authority.

- [ ] **Step 1: Confirm nothing still reads `role`**

Run: `cd backend && npx tsc --noEmit` and `grep -rn "ProjectRole\|\.role\b\|role:" backend/src` — expect only the definitions listed above in `project-access.ts` (invite/member-management helpers). The `projects.ts` `currentUserRole` readers were already converted in Task 3 Step 4b. Any remaining route call site still passing `role` belongs to 2.4's invite/member flow; drop the `role` field there or leave the retained `ProjectMember` write without it.

- [ ] **Step 2: Remove `role` + `ProjectRole` from the schema**

In `schema.prisma`: delete `role ProjectRole` from `model ProjectMember`; delete `enum ProjectRole`. `ProjectMember` keeps `projectId, email, userId?, status, invitedGroupId?, invitedTeamId?` (invite bridge only; full `Invite` model + drop lands in 2.4).

- [ ] **Step 3: Purge the role helpers in `project-access.ts`**

Delete `ROLE_RANK`, `hasProjectRole`, `roleAtLeast`, and `requireProjectRole` (unused after 2.1 moved routes to `requireScope`). Drop the `role` filter from `getProjectOwnersCount` (or delete it if unreferenced) and the `role` field from `upsertProjectMember`'s `where`/`update`/`create`. Fix `getProjectAccess`'s return type so `member` no longer carries `role`.

- [ ] **Step 4: Create the contract migration**

Run: `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name drop_project_member_role`
Expected generated SQL: `ALTER TABLE "ProjectMember" DROP COLUMN "role";` and `DROP TYPE "ProjectRole";`. No hand-edit needed (backfill already ran in Task 1).

- [ ] **Step 5: Verify the whole suite is green**

Run: `cd backend && npx tsc --noEmit` then `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-migration.test.ts tests/rbac-seed.test.ts tests/rbac-resolver.test.ts tests/data-case-run.test.ts`
Expected: PASS across all — `ProjectRole` unreferenced, resolver unaffected by the drop.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma backend/src/utils/project-access.ts
git commit -m "feat(rbac): drop ProjectMember.role and retire ProjectRole (contract migration)"
```

---

## Self-Review

**Spec coverage:** R1 (schema: `Scope` enum + Group/GroupScope/UserGroup/Team/TeamMember/TeamProject + back-relations) → Task 1. R2 (idempotent system-group seed, authoritative scope sets) → Task 1 self-seed + Task 2 `seedSystemGroups`. R3 (data migration: teams from projects, max-role group flattening, superadmin, PENDING `invited*`, then drop `role`) → Task 1 backfill (steps 1-4) + Task 4 drop (step 5). R4 (`memberOf`, `resolveUserScopes`, `requireScope` = global ∨ (member ∧ membership), preserved `statusCode`) → Task 3. R5 (`getAccessibleProjectIds` team-derived ∪ all-if-global) → Task 3. R6 (`canCreateProject` via `project_manage`/`checks_edit`/global group) → Task 3. R7 (`ProjectMember` retained as invite bridge; `seedProjectOwners` → SUPERADMIN) → Task 1 `invited*` cols + Task 2. Out-of-scope (team/group management endpoints, invite materialization, frontend) untouched — model + seed + migration + resolver only.

**Acceptance criteria:** four groups with exact scope sets + `isSystem`/`isGlobal` (Task 1 test); one team per project with active members, max-role group per user, admins SUPERADMIN, `role` dropped (Task 1 backfill + Task 4); `requireScope` truth table incl. superadmin bypass + no-team 403 + VIEWER-masked / EDITOR-unmasked secrets (Task 3 test); `getAccessibleProjectIds` = membership set for non-superadmins, all for superadmins (Task 3 test); `canCreateProject` same user set (Task 3, since backfill preserves capability); seed idempotent + self-correcting (Task 2 test); nothing references `ProjectRole` (Task 4 `tsc`/grep gate).

**Placeholder scan:** every step carries real code or an exact edit target with line numbers. The one non-automated item — the one-shot historical backfill — is a documented manual `psql` check (Task 1 Step 7), with its behavioral guarantee covered by the Task 3 resolver test; reason stated inline (mirrors the exemplar's config-only no-test note).

**Type consistency:** single `Scope` representation — the Prisma enum (underscored), re-exported from `project-access.ts` in Task 3, replacing 2.1's literal-union; `SYSTEM_GROUPS` (Task 1) types its `scopes` as `Scope[]` and is the sole catalog reused by both the migration SQL and `seedSystemGroups` (Task 2), so seed and migration cannot drift. `resolveScopes(userId, projectId) → Promise<Set<Scope>>` and `memberOf(userId, projectId) → Promise<boolean>` are consistent across Tasks 3/harness. `requireScope`/`can` keep their 2.1 signatures and `ProjectAccessError.statusCode` convention, so 2.1 catch blocks and `getProjectAccessStatusCode` are unchanged.

**Ordering / green-at-every-step:** Task 1 is additive (tables + `Scope` + `invited*`, `role` kept) → build stays green, self-seed test passes. Task 2 seeds groups + admin group (needs Task 1's models). Task 3 rewrites the resolver + harness to read groups/teams while `role` still exists but is no longer read. Task 4 (contract) drops `role`/`ProjectRole` only once Tasks 1-3 removed every reader — Prisma expand/contract, so no intermediate task fails to compile. Recommended order = task-number order.
