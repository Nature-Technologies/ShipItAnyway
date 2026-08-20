# RBAC Assignment Authority: Teams, Groups, Superadmin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the management surface for the scope-based RBAC model: **superadmin-only** group-definition and user↔group assignment endpoints, **delegated** (`teams_manage`) team CRUD / membership / team↔project attach endpoints, a team-derived project member list, superadmin-only project creation, a system-wide "≥1 superadmin" floor, and retirement of the `ADMIN_EMAIL` runtime authorization checks.

**Architecture:** Authority splits along the Group/Team seam. **Capability is global and centralized** — only a superadmin (a user holding an `isGlobal` group, i.e. `SUPERADMIN`) may assign user↔group or CRUD custom group definitions; system groups stay immutable. **Membership is delegated** — any holder of the new `teams_manage` scope (superadmins included, since `SUPERADMIN` bundles every scope) may CRUD teams and manage their members, while attaching a team to a specific project P is project-gated by `requireScope(P, teams_manage)`. The per-project "≥1 owner" floor is replaced by a system-wide "≥1 superadmin" floor. New endpoints live in three new route files (`groups.ts`, `teams.ts`, `users.ts`); the shared authority helpers extend `project-access.ts`.

**Tech Stack:** Node 22, Fastify 5, Prisma (PostgreSQL), Zod, TypeScript strict. Tests: `node:test` + `node:assert/strict` via `tsx --test`, `Fastify().inject` + real Prisma. Branding stays "ShipItAnyway".

**Spec:** `docs/superpowers/specs/2026-08-20-rbac-assignment.md`

**Consumes from 2.2** (`docs/superpowers/specs/2026-08-20-rbac-groups.md`): `Group` / `GroupScope` / `UserGroup` / `Team` / `TeamMember` / `TeamProject` models + the `Scope` enum exist; `requireScope(projectId, userId, scope)` and `resolveUserScopes(userId): Promise<{ membershipScopes: Set<Scope>; globalScopes: Set<Scope> }>` exist in `project-access.ts`; the `SUPERADMIN` (`isGlobal=true`, `isSystem=true`) group is seeded, and the amended `OWNER` group bundles `teams_manage`. This plan does **not** re-migrate the `Scope` enum (2.2 already seeds `teams_manage` and drops `groups_assign`) — it only consumes `teams_manage`.

## Global Constraints

- Node 22 backend, TS strict. Prisma migrations timestamped; boot runs `prisma migrate deploy && prisma db seed` (`backend/Dockerfile:25`).
- Backend tests: `cd backend && npx dotenv -e ../.env -- tsx --test tests/<file>.test.ts`. Need compose `db`+`redis`. node:test + node:assert/strict.
- Route/DB tests: `Fastify().inject` + preHandler stub setting `req.user`, real Prisma; helpers from `backend/tests/data-case-run.test.ts`.
- Zod for request validation (see existing routes for the `safeParse` pattern). Branding "ShipItAnyway".

---

### Task 1: Shared authority helpers (`requireSuperadmin`, superadmin floor, `requireTeamsManage`)

**Files:**
- Modify: `backend/src/utils/project-access.ts` (add helpers near `requireProjectRole` ~108-130; `getProjectOwnersCount` ~155-159 retired in Task 6)
- Test: `backend/tests/rbac-authority-helpers.test.ts`

**Interfaces:**
- Produces:
  - `isSuperadmin(userId: string): Promise<boolean>` — true iff the user holds any `isGlobal` group.
  - `requireSuperadmin(userId: string): Promise<void>` — resolves iff `isSuperadmin`; else throws a `ProjectAccessError` with `statusCode = 403` (same shape `getProjectAccessStatusCode` already reads).
  - `countSuperadmins(): Promise<number>` — distinct count of users holding an `isGlobal` group (the floor).
  - `requireTeamsManage(userId: string): Promise<void>` — resolves iff `teams_manage` ∈ (`membershipScopes` ∪ `globalScopes`) from `resolveUserScopes`; else `statusCode = 403`. Superadmins pass (their global group bundles every scope).
- Consumes: `resolveUserScopes` (2.2 R4), `prisma`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-authority-helpers.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import redis from '../src/redis';
import {
  isSuperadmin, requireSuperadmin, countSuperadmins, requireTeamsManage
} from '../src/utils/project-access';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `helper-${uniq()}@example.com`, passwordHash: 'x' } });

test('superadmin + teams_manage helpers key on group membership', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const ownerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'OWNER' } });   // has teams_manage
  const viewerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } }); // no teams_manage
  const admin = await makeUser();
  const delegate = await makeUser();
  const plain = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });
  await prisma.userGroup.create({ data: { userId: delegate.id, groupId: ownerGroup.id } });
  await prisma.userGroup.create({ data: { userId: plain.id, groupId: viewerGroup.id } });

  try {
    assert.equal(await isSuperadmin(admin.id), true);
    assert.equal(await isSuperadmin(delegate.id), false);
    await requireSuperadmin(admin.id); // resolves
    await assert.rejects(requireSuperadmin(delegate.id), (e: any) => e.statusCode === 403);
    assert.ok((await countSuperadmins()) >= 1);

    await requireTeamsManage(admin.id);    // superadmin passes
    await requireTeamsManage(delegate.id); // teams_manage holder passes
    await assert.rejects(requireTeamsManage(plain.id), (e: any) => e.statusCode === 403);
  } finally {
    for (const u of [admin, delegate, plain]) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    }
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-authority-helpers.test.ts`
Expected: FAIL — `isSuperadmin`/`requireSuperadmin`/`countSuperadmins`/`requireTeamsManage` not exported.

- [ ] **Step 3: Implement the helpers**

In `backend/src/utils/project-access.ts`, add (import `Scope` from `@prisma/client` if not already; `resolveUserScopes` is exported by 2.2 in this same file):

```ts
export async function isSuperadmin(userId: string): Promise<boolean> {
  const count = await prisma.userGroup.count({
    where: { userId, group: { isGlobal: true } }
  });
  return count > 0;
}

function forbidden(): ProjectAccessError {
  const error = new Error('Forbidden') as ProjectAccessError;
  error.statusCode = 403;
  return error;
}

export async function requireSuperadmin(userId: string): Promise<void> {
  if (!(await isSuperadmin(userId))) throw forbidden();
}

export async function countSuperadmins(): Promise<number> {
  const rows = await prisma.userGroup.findMany({
    where: { group: { isGlobal: true } },
    select: { userId: true },
    distinct: ['userId']
  });
  return rows.length;
}

export async function requireTeamsManage(userId: string): Promise<void> {
  const { membershipScopes, globalScopes } = await resolveUserScopes(userId);
  if (!membershipScopes.has('teams_manage') && !globalScopes.has('teams_manage')) {
    throw forbidden();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-authority-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/project-access.ts backend/tests/rbac-authority-helpers.test.ts
git commit -m "feat(rbac): shared authority helpers (requireSuperadmin, superadmin floor, requireTeamsManage)"
```

---

### Task 2: Group-definition endpoints (superadmin only)

**Files:**
- Create: `backend/src/routes/groups.ts`
- Modify: `backend/src/index.ts` (register `groupRoutes` alongside the other route registrations ~200-211)
- Test: `backend/tests/rbac-groups.test.ts`

**Interfaces:**
- Consumes: `requireSuperadmin`, `getAuthUser`, `getProjectAccessStatusCode` (`project-access.ts`); `Scope` (`@prisma/client`).
- Produces:
  - `GET /groups` → `[{ id, name, isSystem, isGlobal, scopes: Scope[] }]`.
  - `POST /groups` `{ name, scopes: Scope[] }` → `201` custom group (`isSystem=false`, `isGlobal=false`); `409` on duplicate name.
  - `PATCH /groups/:id` `{ name?, scopes? }` → `409` if `isSystem`; setting `scopes` replaces the `GroupScope` set.
  - `DELETE /groups/:id` → `204`; `409` if `isSystem` (this also protects `SUPERADMIN`, the only `isGlobal` group, keeping the superadmin floor intact); cascade removes `UserGroup` rows.
  - `groupRoutes(fastify)` registered in `index.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-groups.test.ts`. Reuse the harness shape from `data-case-run.test.ts` (a `Fastify()` with a `preHandler` stub setting `req.user = { userId, email }`, real Prisma):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { groupRoutes } from '../src/routes/groups';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const makeUser = () =>
  prisma.user.create({ data: { email: `grp-${uniq()}@example.com`, passwordHash: 'x' } });

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(groupRoutes);
  return app;
}

test('superadmin CRUDs custom groups; non-superadmin 403; system groups immutable', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const admin = await makeUser();
  const outsider = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });

  const adminApp = await buildApp(admin.id, admin.email);
  const outsiderApp = await buildApp(outsider.id, outsider.email);
  let createdId: string | undefined;
  try {
    // non-superadmin blocked on every verb
    assert.equal((await outsiderApp.inject({ method: 'GET', url: '/groups' })).statusCode, 403);
    assert.equal((await outsiderApp.inject({
      method: 'POST', url: '/groups', payload: { name: `c-${uniq()}`, scopes: ['runs_read'] }
    })).statusCode, 403);

    // create
    const createRes = await adminApp.inject({
      method: 'POST', url: '/groups', payload: { name: `custom-${uniq()}`, scopes: ['runs_read', 'checks_read'] }
    });
    assert.equal(createRes.statusCode, 201);
    createdId = createRes.json().id;
    assert.equal(createRes.json().isSystem, false);
    assert.equal(createRes.json().isGlobal, false);
    assert.deepEqual([...createRes.json().scopes].sort(), ['checks_read', 'runs_read']);

    // edit replaces scope set
    const patchRes = await adminApp.inject({
      method: 'PATCH', url: `/groups/${createdId}`, payload: { scopes: ['runs_read'] }
    });
    assert.equal(patchRes.statusCode, 200);
    assert.deepEqual(patchRes.json().scopes, ['runs_read']);

    // system group rejects edit + delete
    assert.equal((await adminApp.inject({
      method: 'PATCH', url: `/groups/${superGroup.id}`, payload: { name: 'nope' }
    })).statusCode, 409);
    assert.equal((await adminApp.inject({
      method: 'DELETE', url: `/groups/${superGroup.id}`
    })).statusCode, 409);

    // delete custom group + cascade
    assert.equal((await adminApp.inject({ method: 'DELETE', url: `/groups/${createdId}` })).statusCode, 204);
    assert.equal(await prisma.group.findUnique({ where: { id: createdId } }), null);
    createdId = undefined;
  } finally {
    await adminApp.close(); await outsiderApp.close();
    if (createdId) await prisma.group.delete({ where: { id: createdId } }).catch(() => undefined);
    for (const u of [admin, outsider]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-groups.test.ts`
Expected: FAIL — `../src/routes/groups` module missing.

- [ ] **Step 3: Implement `groups.ts`**

Create `backend/src/routes/groups.ts`:

```ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Scope } from '@prisma/client';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireSuperadmin } from '../utils/project-access';

const GroupCreateSchema = z.object({
  name: z.string().trim().min(1),
  scopes: z.array(z.nativeEnum(Scope)).default([])
});
const GroupUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  scopes: z.array(z.nativeEnum(Scope)).optional()
}).refine((v) => v.name !== undefined || v.scopes !== undefined, 'Nothing to update');

async function ensureSuperadmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireSuperadmin(getAuthUser(req).userId);
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: 'Forbidden' });
    return false;
  }
}

const serialize = (g: { id: string; name: string; isSystem: boolean; isGlobal: boolean; scopes: { scope: Scope }[] }) =>
  ({ id: g.id, name: g.name, isSystem: g.isSystem, isGlobal: g.isGlobal, scopes: g.scopes.map((s) => s.scope) });

export async function groupRoutes(fastify: FastifyInstance) {
  fastify.get('/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const groups = await prisma.group.findMany({ include: { scopes: true }, orderBy: { name: 'asc' } });
    return groups.map(serialize);
  });

  fastify.post('/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const result = GroupCreateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    try {
      const group = await prisma.group.create({
        data: {
          name: result.data.name,
          isSystem: false,
          isGlobal: false,
          scopes: { create: [...new Set(result.data.scopes)].map((scope) => ({ scope })) }
        },
        include: { scopes: true }
      });
      return reply.status(201).send(serialize(group));
    } catch {
      return reply.status(409).send({ error: 'A group with that name already exists' });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const result = GroupUpdateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    if (group.isSystem) return reply.status(409).send({ error: 'System groups cannot be edited' });

    const updated = await prisma.$transaction(async (tx) => {
      if (result.data.name !== undefined) {
        await tx.group.update({ where: { id: group.id }, data: { name: result.data.name } });
      }
      if (result.data.scopes !== undefined) {
        await tx.groupScope.deleteMany({ where: { groupId: group.id } });
        await tx.groupScope.createMany({
          data: [...new Set(result.data.scopes)].map((scope) => ({ groupId: group.id, scope }))
        });
      }
      return tx.group.findUniqueOrThrow({ where: { id: group.id }, include: { scopes: true } });
    }).catch(() => null);

    if (!updated) return reply.status(409).send({ error: 'A group with that name already exists' });
    return serialize(updated);
  });

  fastify.delete<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    if (group.isSystem) return reply.status(409).send({ error: 'System groups cannot be deleted' });
    await prisma.group.delete({ where: { id: group.id } }); // cascade removes GroupScope + UserGroup
    return reply.status(204).send();
  });
}
```

> The superadmin-floor on delete is satisfied structurally: the only `isGlobal` group (`SUPERADMIN`) is `isSystem`, so the `isSystem` guard already refuses to delete it. Custom groups are always `isGlobal=false`, so deleting one can never drop the superadmin count. No extra count query needed.

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, import `import { groupRoutes } from './routes/groups';` (with the other route imports ~17-29) and add `await fastify.register(groupRoutes);` alongside the other `fastify.register(...Routes)` calls (~200-211).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/groups.ts backend/src/index.ts backend/tests/rbac-groups.test.ts
git commit -m "feat(rbac): superadmin-only group-definition endpoints with system-group immutability"
```

---

### Task 3: User ↔ group assignment (superadmin only) + superadmin floor

**Files:**
- Create: `backend/src/routes/users.ts`
- Modify: `backend/src/index.ts` (register `userRoutes` ~200-211)
- Test: `backend/tests/rbac-user-groups.test.ts`

**Interfaces:**
- Consumes: `requireSuperadmin`, `isSuperadmin`, `countSuperadmins`, `getAuthUser`, `getProjectAccessStatusCode`.
- Produces:
  - `GET /users` → `[{ id, email }]` (superadmin only).
  - `GET /users/:id/groups` → `[{ id, name, isSystem, isGlobal }]`.
  - `PUT /users/:id/groups` `{ groupIds: string[] }` → replace-semantics; validates every id exists (`400` otherwise); returns the user's new group list. **Rejected `409`** if it would strip the last superadmin's `isGlobal` group (the floor).

> `GET /users/exists` already lives in `auth.ts` (a different path) — no collision.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-user-groups.test.ts` (reuse the `buildApp`/`makeUser` harness from Task 2, registering `userRoutes`):

```ts
import { userRoutes } from '../src/routes/users';
// buildApp registers userRoutes; makeUser as in Task 2

test('superadmin sets user groups; floor blocks removing the last superadmin', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const editorGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } });
  const admin = await makeUser();
  const target = await makeUser();
  const outsider = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });

  const adminApp = await buildApp(admin.id, admin.email);
  const outsiderApp = await buildApp(outsider.id, outsider.email);
  try {
    // non-superadmin 403 even on GET
    assert.equal((await outsiderApp.inject({ method: 'GET', url: '/users' })).statusCode, 403);
    assert.equal((await outsiderApp.inject({
      method: 'PUT', url: `/users/${target.id}/groups`, payload: { groupIds: [editorGroup.id] }
    })).statusCode, 403);

    // assign a group (replace-semantics)
    const putRes = await adminApp.inject({
      method: 'PUT', url: `/users/${target.id}/groups`, payload: { groupIds: [editorGroup.id] }
    });
    assert.equal(putRes.statusCode, 200);
    assert.deepEqual(putRes.json().map((g: { name: string }) => g.name), ['EDITOR']);

    // unknown id → 400
    assert.equal((await adminApp.inject({
      method: 'PUT', url: `/users/${target.id}/groups`, payload: { groupIds: ['does-not-exist'] }
    })).statusCode, 400);

    // floor: admin is the only superadmin → cannot drop their SUPERADMIN group
    const floorRes = await adminApp.inject({
      method: 'PUT', url: `/users/${admin.id}/groups`, payload: { groupIds: [editorGroup.id] }
    });
    assert.equal(floorRes.statusCode, 409);
    assert.equal(await prisma.userGroup.count({ where: { userId: admin.id, groupId: superGroup.id } }), 1);
  } finally {
    await adminApp.close(); await outsiderApp.close();
    for (const u of [admin, target, outsider]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-user-groups.test.ts`
Expected: FAIL — `../src/routes/users` module missing.

- [ ] **Step 3: Implement `users.ts`**

Create `backend/src/routes/users.ts`:

```ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import {
  countSuperadmins, getAuthUser, getProjectAccessStatusCode, isSuperadmin, requireSuperadmin
} from '../utils/project-access';

const SetGroupsSchema = z.object({ groupIds: z.array(z.string()).default([]) });

async function ensureSuperadmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireSuperadmin(getAuthUser(req).userId);
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: 'Forbidden' });
    return false;
  }
}

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get('/users', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    return prisma.user.findMany({ select: { id: true, email: true }, orderBy: { email: 'asc' } });
  });

  fastify.get<{ Params: { id: string } }>('/users/:id/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const rows = await prisma.userGroup.findMany({
      where: { userId: req.params.id },
      include: { group: { select: { id: true, name: true, isSystem: true, isGlobal: true } } },
      orderBy: { group: { name: 'asc' } }
    });
    return rows.map((r) => r.group);
  });

  fastify.put<{ Params: { id: string } }>('/users/:id/groups', async (req, reply) => {
    if (!(await ensureSuperadmin(req, reply))) return;
    const result = SetGroupsSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const groupIds = [...new Set(result.data.groupIds)];
    const groups = await prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, isGlobal: true } });
    if (groups.length !== groupIds.length) {
      return reply.status(400).send({ error: 'One or more group ids do not exist' });
    }

    // Superadmin floor: if the target is currently the last superadmin and the new set has no
    // isGlobal group, refuse.
    const wasSuper = await isSuperadmin(user.id);
    const willBeSuper = groups.some((g) => g.isGlobal);
    if (wasSuper && !willBeSuper && (await countSuperadmins()) <= 1) {
      return reply.status(409).send({ error: 'At least one superadmin must exist' });
    }

    await prisma.$transaction([
      prisma.userGroup.deleteMany({ where: { userId: user.id } }),
      prisma.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId: user.id, groupId })) })
    ]);

    const rows = await prisma.userGroup.findMany({
      where: { userId: user.id },
      include: { group: { select: { id: true, name: true, isSystem: true, isGlobal: true } } },
      orderBy: { group: { name: 'asc' } }
    });
    return rows.map((r) => r.group);
  });
}
```

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, import `import { userRoutes } from './routes/users';` and add `await fastify.register(userRoutes);` alongside the other registrations (~200-211).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-user-groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/users.ts backend/src/index.ts backend/tests/rbac-user-groups.test.ts
git commit -m "feat(rbac): superadmin-only user<->group assignment with superadmin floor"
```

---

### Task 4: Team endpoints (delegated via `teams_manage`, project-gated attach)

**Files:**
- Create: `backend/src/routes/teams.ts`
- Modify: `backend/src/index.ts` (register `teamRoutes` ~200-211)
- Test: `backend/tests/rbac-teams.test.ts`

**Interfaces:**
- Consumes: `requireTeamsManage`, `isSuperadmin`, `requireScope` (2.2), `getAuthUser`, `getProjectAccessStatusCode`.
- Produces:
  - `POST /teams` `{ name }` → `201` (gate: `requireTeamsManage`).
  - `GET /teams` → superadmin/`teams_manage`-holder: all teams; else teams the caller is a `TeamMember` of. Each `{ id, name, memberCount, projectCount }`.
  - `PATCH /teams/:id` `{ name }`, `DELETE /teams/:id` → `requireTeamsManage`.
  - `POST /teams/:id/members` `{ userId }` (`201`), `DELETE /teams/:id/members/:userId` (`204`) → `requireTeamsManage`.
  - `POST /teams/:id/projects` `{ projectId }` (`201`) → gated `requireScope(projectId, teams_manage)` (authority on **that** project); `DELETE /teams/:id/projects/:projectId` (`204`) → same project gate.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-teams.test.ts` (reuse the `buildApp`/`makeUser` harness, registering `teamRoutes`). Covers: `teams_manage` holder creates a team + adds a member; attaches to a project they have `teams_manage` on (allow) but is 403'd on a project they lack authority on; a plain member is 403'd on team CRUD.

```ts
import { teamRoutes } from '../src/routes/teams';

test('teams_manage delegate manages teams; project attach is project-gated', async () => {
  const ownerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'OWNER' } }); // has teams_manage
  const viewerGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'VIEWER' } });
  const delegate = await makeUser();
  const member = await makeUser();
  const plain = await makeUser();
  await prisma.userGroup.create({ data: { userId: delegate.id, groupId: ownerGroup.id } });
  await prisma.userGroup.create({ data: { userId: plain.id, groupId: viewerGroup.id } });

  // authorizedProject: delegate is a team-member (so requireScope(authorized, teams_manage) passes);
  // otherProject: delegate has no membership there.
  const authorized = await prisma.project.create({ data: { name: `auth-${uniq()}` } });
  const other = await prisma.project.create({ data: { name: `other-${uniq()}` } });
  const gateTeam = await prisma.team.create({ data: { name: `gate-${uniq()}` } });
  await prisma.teamMember.create({ data: { teamId: gateTeam.id, userId: delegate.id } });
  await prisma.teamProject.create({ data: { teamId: gateTeam.id, projectId: authorized.id } });

  const delegateApp = await buildApp(delegate.id, delegate.email);
  const plainApp = await buildApp(plain.id, plain.email);
  let teamId: string | undefined;
  try {
    // plain member cannot create teams
    assert.equal((await plainApp.inject({ method: 'POST', url: '/teams', payload: { name: 'x' } })).statusCode, 403);

    // delegate creates a team, adds a member
    const createRes = await delegateApp.inject({ method: 'POST', url: '/teams', payload: { name: `t-${uniq()}` } });
    assert.equal(createRes.statusCode, 201);
    teamId = createRes.json().id;
    assert.equal((await delegateApp.inject({
      method: 'POST', url: `/teams/${teamId}/members`, payload: { userId: member.id }
    })).statusCode, 201);

    // attach to a project the delegate has teams_manage on → allow
    assert.equal((await delegateApp.inject({
      method: 'POST', url: `/teams/${teamId}/projects`, payload: { projectId: authorized.id }
    })).statusCode, 201);

    // attach to a project the delegate lacks authority on → 403
    assert.equal((await delegateApp.inject({
      method: 'POST', url: `/teams/${teamId}/projects`, payload: { projectId: other.id }
    })).statusCode, 403);
  } finally {
    await delegateApp.close(); await plainApp.close();
    if (teamId) await prisma.team.delete({ where: { id: teamId } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: gateTeam.id } }).catch(() => undefined);
    for (const p of [authorized, other]) await prisma.project.delete({ where: { id: p.id } }).catch(() => undefined);
    for (const u of [delegate, member, plain]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

> Why the delegate has `teams_manage` on `authorized` but not `other`: `requireScope` (2.2) allows when the caller is a team-member of the project **and** holds the scope. The delegate is a member of `authorized` via `gateTeam` and holds `teams_manage` (OWNER group), so the attach passes there; on `other` they have no membership, so `requireScope` 403s. (A superadmin would pass on both via the global bypass — asserted implicitly by Task 1's superadmin path.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-teams.test.ts`
Expected: FAIL — `../src/routes/teams` module missing.

- [ ] **Step 3: Implement `teams.ts`**

Create `backend/src/routes/teams.ts`:

```ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import {
  getAuthUser, getProjectAccessStatusCode, isSuperadmin, requireScope, requireTeamsManage
} from '../utils/project-access';

const TeamCreateSchema = z.object({ name: z.string().trim().min(1) });
const TeamUpdateSchema = z.object({ name: z.string().trim().min(1) });
const TeamMemberSchema = z.object({ userId: z.string().min(1) });
const TeamProjectSchema = z.object({ projectId: z.string().min(1) });

async function ensureTeamsManage(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireTeamsManage(getAuthUser(req).userId);
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: 'Forbidden' });
    return false;
  }
}

async function ensureProjectScope(projectId: string, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireScope(projectId, getAuthUser(req).userId, 'teams_manage');
    return true;
  } catch (error) {
    reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    return false;
  }
}

async function loadTeamOr404(id: string, reply: FastifyReply) {
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) { reply.status(404).send({ error: 'Team not found' }); return null; }
  return team;
}

export async function teamRoutes(fastify: FastifyInstance) {
  fastify.post('/teams', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const result = TeamCreateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    const team = await prisma.team.create({ data: { name: result.data.name } });
    return reply.status(201).send(team);
  });

  fastify.get('/teams', async (req, reply) => {
    const { userId } = getAuthUser(req);
    // Superadmins and teams_manage holders manage all teams (capability is global); others see
    // only the teams they belong to.
    let canManageAll = await isSuperadmin(userId);
    if (!canManageAll) {
      canManageAll = await requireTeamsManage(userId).then(() => true).catch(() => false);
    }
    // ponytail: two-tier visibility (all vs member-of). Per-project "attached where I have
    // teams_manage" narrowing is deferred — a teams_manage holder can already manage every team,
    // so "all" is the correct set for them.
    const teams = await prisma.team.findMany({
      where: canManageAll ? undefined : { members: { some: { userId } } },
      include: { _count: { select: { members: true, projects: true } } },
      orderBy: { name: 'asc' }
    });
    return teams.map((t) => ({ id: t.id, name: t.name, memberCount: t._count.members, projectCount: t._count.projects }));
  });

  fastify.patch<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const result = TeamUpdateSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    return prisma.team.update({ where: { id: req.params.id }, data: { name: result.data.name } });
  });

  fastify.delete<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    await prisma.team.delete({ where: { id: req.params.id } }); // cascade removes TeamMember/TeamProject
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/teams/:id/members', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    const result = TeamMemberSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    const user = await prisma.user.findUnique({ where: { id: result.data.userId }, select: { id: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    const membership = await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: req.params.id, userId: user.id } },
      update: {},
      create: { teamId: req.params.id, userId: user.id }
    });
    return reply.status(201).send(membership);
  });

  fastify.delete<{ Params: { id: string; userId: string } }>('/teams/:id/members/:userId', async (req, reply) => {
    if (!(await ensureTeamsManage(req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: req.params.id, userId: req.params.userId } }
    }).catch(() => undefined);
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/teams/:id/projects', async (req, reply) => {
    const result = TeamProjectSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });
    if (!(await ensureProjectScope(result.data.projectId, req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    const attach = await prisma.teamProject.upsert({
      where: { teamId_projectId: { teamId: req.params.id, projectId: result.data.projectId } },
      update: {},
      create: { teamId: req.params.id, projectId: result.data.projectId }
    });
    return reply.status(201).send(attach);
  });

  fastify.delete<{ Params: { id: string; projectId: string } }>('/teams/:id/projects/:projectId', async (req, reply) => {
    if (!(await ensureProjectScope(req.params.projectId, req, reply))) return;
    if (!(await loadTeamOr404(req.params.id, reply))) return;
    await prisma.teamProject.delete({
      where: { teamId_projectId: { teamId: req.params.id, projectId: req.params.projectId } }
    }).catch(() => undefined);
    return reply.status(204).send();
  });
}
```

> The `@@id`/`@@unique` composite keys (`teamId_userId`, `teamId_projectId`) come from the 2.2 schema (R1). Team `DELETE` cascades to `TeamMember`/`TeamProject` via `onDelete: Cascade`.

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, import `import { teamRoutes } from './routes/teams';` and add `await fastify.register(teamRoutes);` alongside the other registrations (~200-211).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-teams.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/teams.ts backend/src/index.ts backend/tests/rbac-teams.test.ts
git commit -m "feat(rbac): delegated team endpoints with project-gated team<->project attach"
```

---

### Task 5: Rework `/projects/:id/members` and `POST /projects`

**Files:**
- Modify: `backend/src/routes/projects.ts` (imports ~7-13; schemas ~43-51; `serializeProjectMember` ~53-68; `POST /projects` ~403-429; `GET /projects/:id/members` ~471-509; **remove** `POST` ~511-587, `PATCH` ~589-627, `DELETE` ~629-661)
- Test: `backend/tests/rbac-project-members.test.ts`

**Interfaces:**
- Consumes: `requireSuperadmin`, `requireScope` (with `members_read`), `resolveUserScopes`, `getAuthUser`, `getProjectAccessStatusCode`.
- Produces:
  - `POST /projects` → superadmin-only (`requireSuperadmin`); creates the project only (no `ProjectMember` OWNER row — the superadmin creator already has global access).
  - `GET /projects/:id/members` → gated `requireScope(members_read)`; returns the **team-derived** de-duplicated union: `[{ userId, email, teams: [{ id, name }], groups: string[], scopes: Scope[] }]`. No `role`.
  - Role-based member mutation endpoints removed (now `404`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-project-members.test.ts` (reuse the `buildApp`/`makeUser` harness, registering `projectRoutes`):

```ts
import { projectRoutes } from '../src/routes/projects';

test('members list is team-derived; project create is superadmin-only; mutations gone', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const editorGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'EDITOR' } });
  const admin = await makeUser();
  const alice = await makeUser();
  const bob = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });
  await prisma.userGroup.create({ data: { userId: alice.id, groupId: editorGroup.id } });
  await prisma.userGroup.create({ data: { userId: bob.id, groupId: editorGroup.id } });

  const project = await prisma.project.create({ data: { name: `mem-${uniq()}` } });
  // two overlapping teams attached to the same project (alice in both, bob in one)
  const teamA = await prisma.team.create({ data: { name: `A-${uniq()}` } });
  const teamB = await prisma.team.create({ data: { name: `B-${uniq()}` } });
  for (const t of [teamA, teamB]) await prisma.teamProject.create({ data: { teamId: t.id, projectId: project.id } });
  await prisma.teamMember.createMany({ data: [
    { teamId: teamA.id, userId: alice.id }, { teamId: teamB.id, userId: alice.id },
    { teamId: teamB.id, userId: bob.id }
  ]});

  const adminApp = await buildApp(admin.id, admin.email);
  try {
    // superadmin creates a project (no OWNER row created)
    const createRes = await adminApp.inject({ method: 'POST', url: '/projects', payload: { name: `p-${uniq()}` } });
    assert.equal(createRes.statusCode, 201);
    assert.equal(await prisma.projectMember.count({ where: { projectId: createRes.json().id } }), 0);

    // team-derived, de-duplicated union with effective scopes
    const membersRes = await adminApp.inject({ method: 'GET', url: `/projects/${project.id}/members` });
    assert.equal(membersRes.statusCode, 200);
    const members = membersRes.json() as Array<{ userId: string; teams: unknown[]; scopes: string[] }>;
    assert.equal(members.length, 2); // alice once, bob once
    const aliceRow = members.find((m) => m.userId === alice.id)!;
    assert.equal(aliceRow.teams.length, 2);
    assert.ok(aliceRow.scopes.includes('checks_edit')); // from EDITOR group

    // removed mutation endpoints → 404
    assert.equal((await adminApp.inject({
      method: 'POST', url: `/projects/${project.id}/members`, payload: { email: 'x@y.z', role: 'OWNER' }
    })).statusCode, 404);

    // non-superadmin cannot create a project
    const editorApp = await buildApp(alice.id, alice.email);
    assert.equal((await editorApp.inject({ method: 'POST', url: '/projects', payload: { name: 'nope' } })).statusCode, 403);
    await editorApp.close();
  } finally {
    await adminApp.close();
    await prisma.project.deleteMany({ where: { name: { contains: 'mem-' } } }).catch(() => undefined);
    for (const t of [teamA, teamB]) await prisma.team.delete({ where: { id: t.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    for (const u of [admin, alice, bob]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-project-members.test.ts`
Expected: FAIL — `POST /projects` still `isProtectedAdminEmail`-gated (creates an OWNER row); `GET members` still role-based; mutation endpoints still present (return non-404).

- [ ] **Step 3: Rework `POST /projects`**

In `backend/src/routes/projects.ts`, replace the body of `POST /projects` (~403-429). Drop the `isProtectedAdminEmail` check and the `$transaction` that created the OWNER `ProjectMember`:

```ts
fastify.post('/projects', async (req, reply) => {
  const result = CreateProjectSchema.safeParse(req.body);
  if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

  const { userId } = getAuthUser(req);
  try {
    await requireSuperadmin(userId);
  } catch (error) {
    return reply.status(getProjectAccessStatusCode(error)).send({ error: 'Project creation is restricted to superadmins' });
  }

  const project = await prisma.project.create({ data: result.data });
  return reply.status(201).send(project);
});
```

- [ ] **Step 4: Repurpose `GET /projects/:id/members` to a team-derived list**

Replace the body of `GET /projects/:id/members` (~471-509) with a `requireScope(members_read)` gate and the derived union:

```ts
fastify.get<{ Params: { id: string } }>('/projects/:id/members', async (req, reply) => {
  const { userId } = getAuthUser(req);
  try {
    await requireScope(req.params.id, userId, 'members_read');
  } catch (error) {
    return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
  }

  const teamLinks = await prisma.teamProject.findMany({
    where: { projectId: req.params.id },
    include: {
      team: {
        select: {
          id: true, name: true,
          members: { include: { user: { select: { id: true, email: true } } } }
        }
      }
    }
  });

  // de-duplicate users across teams, tracking which teams each came from
  const byUser = new Map<string, { userId: string; email: string; teams: { id: string; name: string }[] }>();
  for (const link of teamLinks) {
    for (const m of link.team.members) {
      const row = byUser.get(m.userId) ?? { userId: m.userId, email: m.user.email, teams: [] };
      row.teams.push({ id: link.team.id, name: link.team.name });
      byUser.set(m.userId, row);
    }
  }

  return Promise.all([...byUser.values()].map(async (row) => {
    const groups = await prisma.userGroup.findMany({
      where: { userId: row.userId },
      include: { group: { select: { name: true } } }
    });
    const { membershipScopes, globalScopes } = await resolveUserScopes(row.userId);
    return {
      ...row,
      groups: groups.map((g) => g.group.name),
      scopes: [...new Set([...membershipScopes, ...globalScopes])].sort()
    };
  }));
});
```

- [ ] **Step 5: Delete the role-based mutation endpoints and dead code**

- Remove `POST /projects/:id/members` (~511-587), `PATCH /projects/:id/members/:memberId` (~589-627), `DELETE /projects/:id/members/:memberId` (~629-661).
- Remove `ProjectMemberCreateSchema` / `ProjectMemberUpdateSchema` (~43-51) and `serializeProjectMember` (~53-68) — now unreferenced.
- Update the import block (~7-13): drop `getProjectOwnersCount` and `isProtectedAdminEmail`; add `requireSuperadmin`, `requireScope`, `resolveUserScopes`. Keep `getAuthUser`, `getProjectAccessStatusCode`, `requireProjectRole` (still used by the surviving `GET/PATCH/DELETE /projects` routes). Drop the now-unused `bcrypt` import if nothing else in the file uses it (grep first).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-project-members.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/projects.ts backend/tests/rbac-project-members.test.ts
git commit -m "feat(rbac): team-derived project members + superadmin-only project create; drop role-based member CRUD"
```

---

### Task 6: Retire `ADMIN_EMAIL` runtime authorization checks

**Files:**
- Modify: `backend/src/routes/auth.ts` (`isSystemAdmin` in `/auth/login` ~54-55 and `/auth/me` ~66-67)
- Modify: `backend/src/utils/project-access.ts` (retire `getProjectOwnersCount` ~155-159; confirm `isProtectedAdminEmail`/`getProtectedAdminEmails` are used only by the seed path)
- Test: `backend/tests/rbac-auth-me.test.ts`

**Interfaces:**
- Produces: `/auth/me` and `/auth/login` responses carry `isSystemAdmin` computed as `isSuperadmin(userId)` ("holds an `isGlobal` group") instead of `isProtectedAdminEmail(email)`.
- Retires: `getProjectOwnersCount` (no authorization caller after Task 5). `isProtectedAdminEmail`/`getProtectedAdminEmails` remain **only** as seed bootstrap input (2.2 R3/R7), not for request-time authorization.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-auth-me.test.ts` (reuse `buildApp`/`makeUser`, registering `authRoutes`; note `/auth/me` reads `req.user`, which the preHandler stub supplies):

```ts
import { authRoutes } from '../src/routes/auth';

test('/auth/me reports isSystemAdmin from isGlobal group membership, not ADMIN_EMAIL', async () => {
  const superGroup = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  const admin = await makeUser();
  const plain = await makeUser();
  await prisma.userGroup.create({ data: { userId: admin.id, groupId: superGroup.id } });

  const adminApp = await buildApp(admin.id, admin.email);
  const plainApp = await buildApp(plain.id, plain.email);
  try {
    const adminMe = await adminApp.inject({ method: 'GET', url: '/auth/me' });
    assert.equal(adminMe.statusCode, 200);
    assert.equal(adminMe.json().isSystemAdmin, true);

    const plainMe = await plainApp.inject({ method: 'GET', url: '/auth/me' });
    assert.equal(plainMe.json().isSystemAdmin, false);
  } finally {
    await adminApp.close(); await plainApp.close();
    for (const u of [admin, plain]) await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-auth-me.test.ts`
Expected: FAIL — `admin` is not an `ADMIN_EMAIL`, so `isProtectedAdminEmail` returns `false` despite holding `SUPERADMIN`.

- [ ] **Step 3: Point `isSystemAdmin` at `isSuperadmin`**

In `backend/src/routes/auth.ts`:
- Update the import (~5): `import { canCreateProject, isSuperadmin } from '../utils/project-access';` (drop `isProtectedAdminEmail`).
- `/auth/login` (~55): `isSystemAdmin: await isSuperadmin(user.id)`.
- `/auth/me` (~67): `isSystemAdmin: await isSuperadmin(payload.userId)`.

- [ ] **Step 4: Retire `getProjectOwnersCount`**

In `backend/src/utils/project-access.ts`, remove `getProjectOwnersCount` (~155-159). Run `grep -rn "getProjectOwnersCount\|isProtectedAdminEmail\|getProtectedAdminEmails" backend/src` and confirm: `getProjectOwnersCount` has **zero** remaining references; `isProtectedAdminEmail`/`getProtectedAdminEmails` appear **only** in the seed bootstrap (2.2 R3/R7) — not in any route/authorization path. If any authorization caller remains, fix it before committing.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-auth-me.test.ts`
Expected: PASS.

- [ ] **Step 6: Full backend suite regression**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/*.test.ts`
Expected: PASS — the pre-existing 2.1/2.2 route matrix and the five new RBAC suites all green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/utils/project-access.ts backend/tests/rbac-auth-me.test.ts
git commit -m "refactor(rbac): isSystemAdmin from isGlobal group membership; retire getProjectOwnersCount"
```

---

## Self-Review

**Spec coverage:** R1 → Task 1 (`requireSuperadmin`). R2 → Task 2 (group-def endpoints; system-group immutability; delete-floor via `isSystem`). R3 → Task 3 (`GET /users`, `GET`/`PUT /users/:id/groups`; floor on set). R4 → Task 4 (team CRUD/membership via `requireTeamsManage`; project-gated attach via `requireScope`). R5 → Task 5 (team-derived `GET members`; removed mutation endpoints; superadmin-only `POST /projects`, no OWNER row). R6 → Task 1 helper (`countSuperadmins`) + enforced in Task 3 (user↔group set) and structurally in Task 2 (`isSystem` blocks deleting the only `isGlobal` group; no `isGlobal`-toggle endpoint exists in this item). R7 → Task 6 (`isSystemAdmin` → `isSuperadmin`; `getProjectOwnersCount` retired; `ADMIN_EMAIL` kept as seed-only). All mapped.

**Placeholder scan:** every code step carries real code or an exact edit target with line numbers from the current source (`projects.ts`, `project-access.ts`, `auth.ts`, `index.ts`). No TODOs.

**Type consistency:** `requireSuperadmin(userId) → Promise<void>` throwing `ProjectAccessError{statusCode:403}` — the same shape `getProjectAccessStatusCode` reads and every route's catch relays. `isSuperadmin → Promise<boolean>`, `countSuperadmins → Promise<number>`, `requireTeamsManage → Promise<void>` used identically across Tasks 2-6. `resolveUserScopes` return shape (`{ membershipScopes, globalScopes }`) consumed consistently in Task 1 (`requireTeamsManage`) and Task 5 (derived scopes). `Scope` validated via `z.nativeEnum(Scope)` in Tasks 2-3. `requireScope(projectId, userId, 'teams_manage'|'members_read')` (2.2) consumed in Tasks 4-5.

**Dependency ordering:** Task 1 (shared helpers) is the foundation for 2-6. Tasks 2, 3, 4 are independent of each other (separate route files) but each depends on Task 1; each registers its route in `index.ts`. Task 5 depends on Task 1 (`requireSuperadmin`) and consumes 2.2's `requireScope`/`resolveUserScopes`; it removes the code that was the last authorization caller of `getProjectOwnersCount`. Task 6 depends on Task 1 (`isSuperadmin`) and on Task 5 having removed the member endpoints (so `getProjectOwnersCount` retirement is safe). Recommended order = task number order.

**2.2 assumptions (flagged for the executor):** this plan consumes 2.2 as already merged — models `Group`/`GroupScope`/`UserGroup`/`Team`/`TeamMember`/`TeamProject`, the `Scope` enum (with `teams_manage`, without `groups_assign`), `requireScope`, `resolveUserScopes`, the seeded `SUPERADMIN` (`isGlobal`/`isSystem`) and `OWNER`-with-`teams_manage` groups, and the composite relation keys (`teamId_userId`, `teamId_projectId`, `projectId_email`). If executed before 2.2 lands, complete 2.2 first — none of these tasks re-create those artifacts.
