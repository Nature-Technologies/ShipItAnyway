# Scope-Based RBAC: Enforcement Layer (Roadmap 2.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `role` comparison in every route with atomic **scope** checks, without changing who-can-do-what today. Ship `requireScope`/`can`/`resolveScopes` where `resolveScopes(member)` is a shim that maps the existing `ProjectMember.role` to a scope set (the 2.1↔2.2 seam), swap all 40 call sites one scope each, and delete the dead role machinery.

**Architecture:** `project-access.ts` stays the single authz choke point. Add a `Scope` union + a pure `can(access, scope)` predicate + a `resolveScopes(member)` role→scope shim + an `async requireScope(projectId, userId, scope)` that mirrors `requireProjectRole`'s 404/403/`ProjectAccess` contract exactly (same `ProjectAccessError.statusCode` shape, so every existing catch block and `getProjectAccessStatusCode` keep working unchanged). Routes swap `requireProjectRole(pid, uid, [roles])` → `requireScope(pid, uid, 'scope')`. The secret-reveal `role === 'VIEWER'` branch becomes `!can(access, 'environments:reveal-secrets')`. `getAccessibleProjectIds` becomes "projects where the member resolves any `*:read` scope". When Roadmap 2.2 lands, only `resolveScopes`' body changes — no route touched.

**Tech Stack:** Fastify 5, Prisma (PostgreSQL), Zod, TypeScript strict. Tests: `node:test` + `node:assert/strict` via `tsx --test`, `Fastify().inject` with a `preHandler` stub setting `req.user`, real Prisma.

**Spec:** `docs/superpowers/specs/2026-08-20-rbac-scopes.md`

## Global Constraints

- Node 22 (backend), TypeScript strict. Prisma migrations are timestamped dirs `<YYYYMMDDHHMMSS>_<snake_case>/migration.sql`; boot runs `prisma migrate deploy && prisma db seed` (`backend/Dockerfile:25`). **This plan adds no schema/migration** — scopes derive from the existing `role` column (the 2.2 group tables are out of scope).
- Run backend tests with `cd backend && npx dotenv -e ../.env -- tsx --test tests/<file>.test.ts`. Integration/route tests require the compose `db` + `redis` services up. Tests use `node:test` + `node:assert/strict`.
- Route/DB tests use `Fastify().inject` with a `preHandler` stub setting `req.user = { userId, email }`, real Prisma; copy the `buildApp`/`createProjectAccess`/`cleanup` harness helpers from `backend/tests/data-case-run.test.ts`.
- The JWT `preHandler` in `backend/src/index.ts` (~105-145) authenticates only (verifies token, confirms the user still exists); it loads no roles/scopes and is **unchanged** by 2.1 — authz stays per-route.
- **TDD note for refactor tasks:** R3 call-site swaps are behavior-preserving by design, so the route regression suite (Task 2) is a characterization net: it must be **green on current code before any swap** and **stay green after each swap**. Genuine red→green (new code that does not yet exist) applies to Task 1 (policy layer). Tasks 3–8 run the net before touching a file (baseline PASS) and after (still PASS); a red there means the swap changed behavior — a bug to fix, not progress.
- Branding stays "ShipItAnyway".

---

### Task 1: Policy layer — `Scope` + `resolveScopes` shim + `can` + `requireScope`

**Files:**
- Modify: `backend/src/utils/project-access.ts` (add types + 4 functions alongside the existing `requireProjectRole`; nothing deleted yet)
- Test: `backend/tests/rbac-scopes.test.ts`

**Interfaces:**
- Consumes: `getProjectAccess` (`project-access.ts:51`), `ProjectAccess`/`ProjectAccessError` types, `ProjectMember` (`@prisma/client`).
- Produces:
  - `type Scope` — string-literal union of the 15-scope catalog.
  - `resolveScopes(member: ProjectMember): Set<Scope>` — the **only** place `role` is read (2.2 replaces this body).
  - `can(access: ProjectAccess, scope: Scope): boolean` — pure predicate over `resolveScopes(access.member)`.
  - `requireScope(projectId, userId, scope): Promise<ProjectAccess>` — 404 missing project, 403 no access / scope absent, returns `ProjectAccess` on success; identical `statusCode` shape to `requireProjectRole`.

- [ ] **Step 1: Write the failing unit test**

Create `backend/tests/rbac-scopes.test.ts` (unit only — no DB, no harness):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectMember, ProjectRole } from '@prisma/client';
import { resolveScopes, can, type Scope } from '../src/utils/project-access';

const member = (role: ProjectRole) => ({ role }) as ProjectMember; // resolveScopes reads only .role
const set = (role: ProjectRole) => [...resolveScopes(member(role))].sort();

test('resolveScopes: VIEWER = all *:read, no reveal-secrets', () => {
  assert.deepEqual(set('VIEWER'), [
    'alerts:read', 'checks:read', 'environments:read',
    'members:read', 'runs:read', 'schedules:read'
  ]);
});

test('resolveScopes: EDITOR = VIEWER + edit/trigger + reveal-secrets', () => {
  assert.deepEqual(set('EDITOR'), [
    'alerts:edit', 'alerts:read', 'checks:edit', 'checks:read',
    'environments:edit', 'environments:read', 'environments:reveal-secrets',
    'members:read', 'runs:read', 'runs:trigger',
    'schedules:edit', 'schedules:read'
  ]);
});

test('resolveScopes: OWNER = EDITOR + project:manage/delete + teams:manage', () => {
  const owner = set('OWNER');
  for (const s of set('EDITOR')) assert.ok(owner.includes(s), `owner missing ${s}`);
  assert.ok(owner.includes('project:manage'));
  assert.ok(owner.includes('project:delete'));
  assert.ok(owner.includes('teams:manage'));
});

test('can: truth table across tiers', () => {
  const access = (role: ProjectRole) =>
    ({ project: { id: 'p', name: 'p' }, member: member(role) });
  assert.equal(can(access('VIEWER'), 'runs:read'), true);
  assert.equal(can(access('VIEWER'), 'runs:trigger'), false);
  assert.equal(can(access('VIEWER'), 'environments:reveal-secrets'), false);
  assert.equal(can(access('EDITOR'), 'runs:trigger'), true);
  assert.equal(can(access('EDITOR'), 'environments:reveal-secrets'), true);
  assert.equal(can(access('EDITOR'), 'project:manage'), false);
  assert.equal(can(access('OWNER'), 'project:delete'), true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-scopes.test.ts`
Expected: FAIL — `resolveScopes`/`can`/`Scope` not exported from `project-access.ts`.

- [ ] **Step 3: Implement the policy layer**

In `backend/src/utils/project-access.ts`, after the `ProjectAccessError` type (~line 16) add:

```ts
export type Scope =
  | 'runs:read' | 'runs:trigger'
  | 'checks:read' | 'checks:edit'
  | 'schedules:read' | 'schedules:edit'
  | 'environments:read' | 'environments:edit' | 'environments:reveal-secrets'
  | 'alerts:read' | 'alerts:edit'
  | 'members:read'
  | 'teams:manage'
  | 'project:manage' | 'project:delete';

const VIEWER_SCOPES: Scope[] = [
  'runs:read', 'checks:read', 'schedules:read',
  'environments:read', 'alerts:read', 'members:read'
];
const EDITOR_SCOPES: Scope[] = [
  ...VIEWER_SCOPES,
  'runs:trigger', 'checks:edit', 'schedules:edit',
  'environments:edit', 'alerts:edit', 'environments:reveal-secrets'
];
const OWNER_SCOPES: Scope[] = [
  ...EDITOR_SCOPES,
  'project:manage', 'project:delete', 'teams:manage'
];

// ponytail: role→scope shim. Roadmap 2.2 replaces this body with a group-union lookup; no route changes.
export function resolveScopes(member: ProjectMember): Set<Scope> {
  switch (member.role) {
    case 'OWNER': return new Set(OWNER_SCOPES);
    case 'EDITOR': return new Set(EDITOR_SCOPES);
    case 'VIEWER': return new Set(VIEWER_SCOPES);
    default: return new Set();
  }
}

export function can(access: ProjectAccess, scope: Scope): boolean {
  return resolveScopes(access.member).has(scope);
}

export async function requireScope(projectId: string, userId: string, scope: Scope): Promise<ProjectAccess> {
  const access = await getProjectAccess(projectId, userId);
  if (!access) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    const error = new Error(project ? 'Forbidden' : 'Project not found') as ProjectAccessError;
    error.statusCode = project ? 403 : 404;
    throw error;
  }
  if (!can(access, scope)) {
    const error = new Error('Forbidden') as ProjectAccessError;
    error.statusCode = 403;
    throw error;
  }
  return access;
}
```

(`ProjectMember` is already imported at `project-access.ts:2`. Leave `requireProjectRole`/`hasProjectRole`/`roleAtLeast`/`ROLE_RANK` in place — Task 8 deletes them once every call site is swapped.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-scopes.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/project-access.ts backend/tests/rbac-scopes.test.ts
git commit -m "feat(rbac): add Scope + resolveScopes shim + can + requireScope policy layer"
```

---

### Task 2: Route parity regression net (characterization baseline)

**Files:**
- Test: `backend/tests/rbac-route-parity.test.ts`

**Interfaces:**
- Consumes: `runRoutes`, `testRoutes`, `environmentRoutes`, `projectRoutes` (route plugins); real Prisma; `testQueue` (drain in `finally`).
- Produces: a green-before/green-after net asserting VIEWER/EDITOR/OWNER + outsider allow/403 across a representative **read** (`checks:read`), **trigger** (`runs:trigger`), **edit** (`environments:edit`), and **manage** (`project:manage`) endpoint, plus VIEWER-masked / EDITOR-unmasked env secrets. Green on current `requireProjectRole` code; every swap task re-runs it unchanged.

- [ ] **Step 1: Write the regression test**

Create `backend/tests/rbac-route-parity.test.ts` (copy `cleanup` from `data-case-run.test.ts`; the `buildApp` here registers the four plugins and the `seedTiers` helper makes one member per role + an outsider):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { ProjectRole } from '@prisma/client';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
import { runRoutes } from '../src/routes/runs';
import { testRoutes } from '../src/routes/tests';
import { environmentRoutes } from '../src/routes/environments';
import { projectRoutes } from '../src/routes/projects';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(runRoutes);
  await app.register(testRoutes);
  await app.register(environmentRoutes);
  await app.register(projectRoutes);
  return app;
}

async function makeUser(tag: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prisma.user.create({
    data: { email: `rbac-${tag}-${suffix}@example.com`, passwordHash: 'not-used' }
  });
}

async function seedTiers() {
  const project = await prisma.project.create({ data: { name: `rbac-${Date.now()}` } });
  const users: Record<ProjectRole | 'OUTSIDER', { id: string; email: string }> = {} as never;
  for (const role of ['OWNER', 'EDITOR', 'VIEWER'] as ProjectRole[]) {
    const u = await makeUser(role.toLowerCase());
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: u.id, email: u.email, role, status: 'ACTIVE' }
    });
    users[role] = u;
  }
  users.OUTSIDER = await makeUser('outsider');
  return { project, users };
}

async function cleanup(projectId: string, userIds: string[]) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

test('scope parity: read/trigger/edit/manage + secret masking match the role matrix', async () => {
  const { project, users } = await seedTiers();
  const allIds = Object.values(users).map((u) => u.id);
  const t = await prisma.test.create({
    data: {
      name: 'x', url: 'https://example.com', projectId: project.id,
      steps: [{ action: 'goto', value: 'https://example.com' }]
    }
  });
  await prisma.environment.create({
    data: { name: 'DEV', projectId: project.id, variables: { SECRET: 'super-secret' } }
  });

  const apps: Record<string, Awaited<ReturnType<typeof buildApp>>> = {};
  for (const [k, u] of Object.entries(users)) apps[k] = await buildApp(u.id, u.email);

  try {
    await testQueue.pause();

    // read (checks:read): O,E,V allow; outsider 403
    for (const k of ['OWNER', 'EDITOR', 'VIEWER']) {
      const r = await apps[k].inject({ method: 'GET', url: `/projects/${project.id}/tests` });
      assert.equal(r.statusCode, 200, `${k} read`);
    }
    assert.equal(
      (await apps.OUTSIDER.inject({ method: 'GET', url: `/projects/${project.id}/tests` })).statusCode,
      403, 'outsider read'
    );

    // trigger (runs:trigger): O,E allow (202); V,outsider 403
    for (const [k, code] of [['OWNER', 202], ['EDITOR', 202], ['VIEWER', 403], ['OUTSIDER', 403]] as const) {
      const r = await apps[k].inject({ method: 'POST', url: `/tests/${t.id}/run`, payload: {} });
      assert.equal(r.statusCode, code, `${k} trigger`);
    }

    // edit (environments:edit): O,E allow (201); V,outsider 403
    for (const [k, code] of [['OWNER', 201], ['EDITOR', 201], ['VIEWER', 403], ['OUTSIDER', 403]] as const) {
      const r = await apps[k].inject({
        method: 'POST', url: `/projects/${project.id}/environments`,
        payload: { name: `env-${k}`, variables: {} }
      });
      assert.equal(r.statusCode, code, `${k} edit`);
    }

    // manage (project:manage): O allow (200); E,V,outsider 403
    for (const [k, code] of [['OWNER', 200], ['EDITOR', 403], ['VIEWER', 403], ['OUTSIDER', 403]] as const) {
      const r = await apps[k].inject({
        method: 'PATCH', url: `/projects/${project.id}`, payload: { name: `renamed-${k}` }
      });
      assert.equal(r.statusCode, code, `${k} manage`);
    }

    // secret masking: VIEWER masked, EDITOR unmasked
    const asViewer = (await apps.VIEWER.inject({ method: 'GET', url: `/projects/${project.id}/environments` })).json();
    const asEditor = (await apps.EDITOR.inject({ method: 'GET', url: `/projects/${project.id}/environments` })).json();
    assert.equal(asViewer[0].variables.SECRET, '••••••');
    assert.equal(asEditor[0].variables.SECRET, 'super-secret');
  } finally {
    await testQueue.resume().catch(() => undefined);
    for (const app of Object.values(apps)) await app.close();
    await cleanup(project.id, allIds);
    await testQueue.drain().catch(() => undefined);
    await testQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it — it must PASS on current code (baseline)**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-route-parity.test.ts`
Expected: PASS. This is the characterization baseline — the `requireProjectRole` matrix and the `role === 'VIEWER'` masking branch already produce exactly these results. If it fails here, fix the test until it truly pins current behavior **before** swapping anything.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/rbac-route-parity.test.ts
git commit -m "test(rbac): pin current role-matrix behavior as scope-swap regression net"
```

---

### Task 3: Swap `runs.ts` call sites

**Files:**
- Modify: `backend/src/routes/runs.ts` (import ~7; sites at 61, 128 → `runs:trigger`; 230, 285, 321 → `runs:read`)

**Interfaces:**
- Consumes: `requireScope` (Task 1). Keeps the `getAccessibleProjectIds`/`getAuthUser`/`getProjectAccessStatusCode` imports.

- [ ] **Step 1: Baseline the net**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-route-parity.test.ts` → PASS.

- [ ] **Step 2: Swap the imports + call sites**

In `runs.ts:7`, replace `requireProjectRole` with `requireScope` in the import list. Then:
- `runs.ts:61` and `runs.ts:128`: `await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR']);` → `await requireScope(test.projectId, userId, 'runs:trigger');`
- `runs.ts:230`: `await requireProjectRole(run.test.project.id, userId, ['OWNER', 'EDITOR', 'VIEWER']);` → `await requireScope(run.test.project.id, userId, 'runs:read');`
- `runs.ts:285`: `await requireProjectRole(batch.test.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);` → `await requireScope(batch.test.projectId, userId, 'runs:read');`
- `runs.ts:321`: `await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);` → `await requireScope(test.projectId, userId, 'runs:read');`

- [ ] **Step 3: Re-run the net — must stay PASS**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-route-parity.test.ts` → PASS (the trigger row exercises `runs.ts:61`). Also run `data-case-run.test.ts` to confirm no run-path regression.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/runs.ts
git commit -m "refactor(rbac): swap runs.ts to requireScope (runs:trigger / runs:read)"
```

---

### Task 4: Swap the checks domain — `tests.ts`, `recordings.ts`, `export.ts`, `suites.ts`, `fixtures.ts`

**Files:**
- Modify: `backend/src/routes/tests.ts` (import ~7; 45, 66 → `checks:read`; 87, 134, 151 → `checks:edit`)
- Modify: `backend/src/routes/recordings.ts` (import ~6; 30, 75, 96, 111, 124, 144, 157 → `checks:edit`)
- Modify: `backend/src/routes/export.ts` (import ~8; 47, 99 → `checks:edit`)
- Modify: `backend/src/routes/suites.ts` (import ~5; 25 → `checks:read`; 45, 87, 131, 154 → `checks:edit`)
- Modify: `backend/src/routes/fixtures.ts` (import ~8; 37 → `checks:read`; 18 → `checks:edit`)

**Interfaces:**
- Consumes: `requireScope`. All these files gate tests/suites/fixtures/recordings/export under the single `checks:*` pair.

- [ ] **Step 1: Baseline the net** → PASS.

- [ ] **Step 2: Swap each file** (replace `requireProjectRole` in the import, then each call site — `['OWNER','EDITOR','VIEWER']` → `'checks:read'`, `['OWNER','EDITOR']` → `'checks:edit'`, keeping the same first two args):
  - `tests.ts`: 45, 66 → `checks:read`; 87, 134, 151 → `checks:edit`.
  - `recordings.ts`: 30, 75, 96, 111, 124, 144, 157 → `checks:edit` (all O,E today).
  - `export.ts`: 47, 99 → `checks:edit`.
  - `suites.ts`: 25 → `checks:read`; 45, 87, 131, 154 → `checks:edit`.
  - `fixtures.ts`: 18 → `checks:edit`; 37 → `checks:read`.

- [ ] **Step 3: Re-run the net + suites test** — `rbac-route-parity.test.ts` PASS (its read row hits `tests.ts:45`); also `data-case-run.test.ts` (registers `suiteRoutes`) PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/tests.ts backend/src/routes/recordings.ts backend/src/routes/export.ts backend/src/routes/suites.ts backend/src/routes/fixtures.ts
git commit -m "refactor(rbac): swap checks domain to requireScope (checks:read / checks:edit)"
```

---

### Task 5: Swap `schedules.ts` and `channels.ts`

**Files:**
- Modify: `backend/src/routes/schedules.ts` (import ~7; 107, 165 → `schedules:read`; 219, 258, 312, 332 → `schedules:edit`)
- Modify: `backend/src/routes/channels.ts` (import ~6; 73 → `alerts:read`; 104, 166, 204, 233 → `alerts:edit`)

**Interfaces:**
- Consumes: `requireScope`. `channels.ts:73` keeps `const access = await requireScope(...)` (its result is used downstream); the assignment target is unchanged, only the call.

- [ ] **Step 1: Baseline the net** → PASS.

- [ ] **Step 2: Swap**:
  - `schedules.ts`: 107, 165 → `schedules:read`; 219, 258, 312, 332 → `schedules:edit`.
  - `channels.ts`: 73 → `alerts:read` (keep `const access =`); 104, 166, 204, 233 → `alerts:edit`.

- [ ] **Step 3: Re-run the net** → PASS (these files are not directly in the net's endpoints, so also do a `tsc` typecheck to catch a mistyped scope literal): `cd backend && npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/schedules.ts backend/src/routes/channels.ts
git commit -m "refactor(rbac): swap schedules.ts + channels.ts to requireScope (schedules:* / alerts:*)"
```

---

### Task 6: Swap `environments.ts` + replace the secret-reveal role branch (R5)

**Files:**
- Modify: `backend/src/routes/environments.ts` (import ~4; 15 → `environments:read`; 38, 63, 81 → `environments:edit`; line 16 `viewerOnly` → scope-driven)

**Interfaces:**
- Consumes: `requireScope`, `can` (Task 1), `redactEnvironmentVariables` (unchanged). Produces identical masking today (VIEWER masked, EDITOR/OWNER unmasked) but driven by `environments:reveal-secrets`.

- [ ] **Step 1: Baseline the net** → PASS (its masking + edit rows already cover this file).

- [ ] **Step 2: Swap the call sites**

In `environments.ts:4`, add `can` and replace `requireProjectRole` with `requireScope` in the import from `../utils/project-access`. Then:
- `:15`: `const access = await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);` → `const access = await requireScope(req.params.projectId, userId, 'environments:read');`
- `:38`, `:63`, `:81`: `['OWNER', 'EDITOR']` → `'environments:edit'` (same first two args).

- [ ] **Step 3: Replace the reveal branch (R5)**

At `environments.ts:16`: `const viewerOnly = access.member.role === 'VIEWER';` → `const viewerOnly = !can(access, 'environments:reveal-secrets');`

- [ ] **Step 4: Re-run the net — masking rows must stay green**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-route-parity.test.ts` → PASS. VIEWER lacks `environments:reveal-secrets` → still masked; EDITOR has it → unmasked. Behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/environments.ts
git commit -m "refactor(rbac): environments to requireScope + reveal-secrets scope replaces role branch"
```

---

### Task 7: Swap `projects.ts` (`members:read` / `project:manage` / `project:delete`)

**Files:**
- Modify: `backend/src/routes/projects.ts` (import ~7-13; 219 → `members:read`; 458 → `project:delete`; 439, 474, 514, 592, 632 → `project:manage`)

**Interfaces:**
- Consumes: `requireScope`. The `PROJECT_READ_ROLES`/`PROJECT_OWNER_ROLES` consts (`projects.ts:40-41`) become unreferenced here and are removed. `getProjectOwnersCount`/`isProtectedAdminEmail`/`getAuthUser`/`getProjectAccessStatusCode` imports stay.

> **Confirmed during planning:** the delete-project endpoint is `fastify.delete('/projects/:id')` at `projects.ts:455`, whose guard is line **458** → `project:delete`. Line **219** is the project-detail read using `PROJECT_READ_ROLES` (O,E,V) → `members:read`. All remaining OWNER guards (439 patch project, 474 GET members, 514 POST member, 592 PATCH member, 632 DELETE member) → `project:manage`. All four map only to OWNER under the R4 seed, so behavior is identical.

- [ ] **Step 1: Baseline the net** → PASS.

- [ ] **Step 2: Swap the call sites**

In the `project-access` import block (`projects.ts:7-13`) replace `requireProjectRole,` with `requireScope,`. Then:
- `:219`: `access = await requireProjectRole(req.params.id, userId, PROJECT_READ_ROLES);` → `access = await requireScope(req.params.id, userId, 'members:read');`
- `:458`: `await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);` → `await requireScope(req.params.id, userId, 'project:delete');`
- `:439`, `:474`, `:514`, `:592`, `:632`: `PROJECT_OWNER_ROLES` → `'project:manage'` (same first two args).
- Delete the now-unreferenced `const PROJECT_READ_ROLES` / `const PROJECT_OWNER_ROLES` (`:40-41`).

- [ ] **Step 3: Re-run the net + typecheck** — `rbac-route-parity.test.ts` PASS (its manage row hits `projects.ts:439`); `cd backend && npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/projects.ts
git commit -m "refactor(rbac): swap projects.ts to requireScope (members:read / project:manage / project:delete)"
```

---

### Task 8: Delete dead role machinery + scope-aware `getAccessibleProjectIds` (R6)

**Files:**
- Modify: `backend/src/utils/project-access.ts` (delete `ROLE_RANK` `:18-22`, `hasProjectRole` `:47-49`, `requireProjectRole` `:108-130`, `roleAtLeast` `:138-140`; rewrite `getAccessibleProjectIds` `:73-85`)
- Test: `backend/tests/rbac-accessible-projects.test.ts`

**Interfaces:**
- Consumes: `resolveScopes` (Task 1). Produces: `getAccessibleProjectIds(userId): Promise<string[]>` = projects where the member resolves any `*:read` scope (identical set today, since every ACTIVE member has reads). Consumers unchanged: `runs.ts:7`, `dashboard.ts:127,291,394`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac-accessible-projects.test.ts` (copy `cleanup` from `data-case-run.test.ts`):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/prisma';
import { getAccessibleProjectIds } from '../src/utils/project-access';

test('getAccessibleProjectIds returns projects where the member resolves a *:read scope', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: { email: `rbac-acc-${suffix}@example.com`, passwordHash: 'not-used' }
  });
  const project = await prisma.project.create({ data: { name: `rbac-acc-${suffix}` } });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, email: user.email, role: 'VIEWER', status: 'ACTIVE' }
  });
  try {
    const ids = await getAccessibleProjectIds(user.id);
    assert.deepEqual(ids, [project.id]); // VIEWER has runs:read etc. → included
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
});
```

- [ ] **Step 2: Run it — PASS on current code (characterization)**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/rbac-accessible-projects.test.ts` → PASS. The current membership-based implementation already returns this set; the test locks it so the R6 rewrite must preserve it.

- [ ] **Step 3: Delete the dead role functions**

In `backend/src/utils/project-access.ts` remove, now that no route references them (Tasks 3–7 swapped every call site):
- `ROLE_RANK` (`:18-22`)
- `hasProjectRole` (`:47-49`)
- `requireProjectRole` (`:108-130`)
- `roleAtLeast` (`:138-140`)

- [ ] **Step 4: Rewrite `getAccessibleProjectIds` (R6)**

Replace `getAccessibleProjectIds` (`:73-85`) with (fetch full member rows so `resolveScopes` can read `role`; keep the `string[]` return shape):

```ts
export async function getAccessibleProjectIds(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId, status: 'ACTIVE' }
  });
  return memberships
    .filter((member) => [...resolveScopes(member)].some((scope) => scope.endsWith(':read')))
    .map((member) => member.projectId);
}
```

- [ ] **Step 5: Verify no dangling references + tests + full typecheck**

- `grep -rn "requireProjectRole\|hasProjectRole\|roleAtLeast\|ROLE_RANK" backend/src` → **zero** hits (acceptance criterion).
- `cd backend && npx tsc --noEmit` → clean (proves no source references the deleted symbols).
- Re-run the full regression set: `rbac-scopes.test.ts`, `rbac-route-parity.test.ts`, `rbac-accessible-projects.test.ts`, `data-case-run.test.ts` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/project-access.ts backend/tests/rbac-accessible-projects.test.ts
git commit -m "refactor(rbac): delete role machinery + make getAccessibleProjectIds scope-aware"
```

---

## Self-Review

**Spec coverage:** R1 (policy layer: `Scope`/`can`/`requireScope`) → Task 1. R2 (`resolveScopes` shim, only place role is read) → Task 1. R3 (swap all 40 call sites, one scope each) → Tasks 3–7, covering every file/line in the mapping table: runs.ts (T3), tests/recordings/export/suites/fixtures (T4), schedules/channels (T5), environments (T6), projects (T7). R4 (role→scope seed) → Task 1 `VIEWER/EDITOR/OWNER_SCOPES`, asserted exactly in `rbac-scopes.test.ts`. R5 (secret-reveal → `environments:reveal-secrets`) → Task 6 step 3, verified by the net's masking rows. R6 (`getAccessibleProjectIds` scope-aware) → Task 8. Deletion of `requireProjectRole`/`hasProjectRole`/`roleAtLeast`/`ROLE_RANK` → Task 8, gated on the grep+tsc acceptance check. Acceptance criteria (VIEWER read/403, EDITOR trigger+edit/manage-403, OWNER full, masking, identical accessible set, 404/403 statusCode shape) → `rbac-route-parity.test.ts` + `rbac-accessible-projects.test.ts` + `requireScope`'s mirrored error shape.

**Placeholder scan:** every code step carries real code or an exact `file:line` edit target with the literal before/after text. No `TODO`/`...`/stub. Line numbers grep-verified against the current tree (runs 61/128/230/285/321; tests 45/66/87/134/151; recordings 30/75/96/111/124/144/157; export 47/99; suites 25/45/87/131/154; fixtures 18/37; schedules 107/165/219/258/312/332; environments 15/38/63/81; channels 73/104/166/204/233; projects 219/439/458/474/514/592/632). Delete-project guard confirmed at `projects.ts:458`.

**Type consistency:** `Scope` is one 15-member union defined once (Task 1) and referenced by literal everywhere. `resolveScopes(member: ProjectMember): Set<Scope>`, `can(access: ProjectAccess, scope: Scope): boolean`, `requireScope(projectId, userId, scope): Promise<ProjectAccess>` — signatures stable across Tasks 1/6/8. `requireScope` reuses `ProjectAccessError.statusCode` so `getProjectAccessStatusCode` and all catch blocks are untouched. `getAccessibleProjectIds` keeps its `Promise<string[]>` shape. The `default: return new Set()` arm keeps `resolveScopes` total under TS strict without an unreachable-throw.

**TDD honesty:** Task 1 and the Task 8 deletions are the genuine new-code / red targets (functions absent → tests fail / symbols removed → build proves it). R3 swaps are behavior-preserving refactors, so Tasks 2–7 use the characterization net (green before, green after) per the Global-Constraints note — this is correct refactor discipline, not a skipped red. Deviation from the suggested decomposition: R5 is folded into the environments swap (Task 6) rather than the final task, since that file is already open there — one file, one commit, no re-touch.

**Ordering:** Task 1 (policy layer) before all swaps. Task 2 (net) before Tasks 3–7 so each swap has a baseline. Tasks 3–7 independent of each other (disjoint files) — parallelizable, but each must re-green the shared net. Task 8 last (deletions require all 40 sites swapped; `tsc` is the gate). Recommended order = task-number order.
