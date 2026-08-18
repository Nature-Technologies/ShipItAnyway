# Agent-Driven Test Authoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CLI agent (Claude Code / Codex / Grok, via MCP) — or the web UI — drive a live browser one structured action at a time and capture each action as a replayable `Step`, reusing the existing replay/validate/export pipeline; add the `upload` action backed by real file-fixture storage.

**Architecture:** A live, library-driven recording session (a backend Playwright `Page` in an in-memory map) is the core. Two front doors reach it: an **MCP server** (agent tools → HTTP) and the **HTTP API** (web UI). Actions execute through the same `resolveLocator` the replay worker uses. `upload` steps reference a stored `Fixture` the worker resolves to a file path for `setInputFiles`.

**Tech Stack:** Fastify 5, Prisma, Playwright 1.61, `@fastify/multipart` (to add), `@modelcontextprotocol/sdk` (to add), Zod, React + Ant Design, TypeScript. Tests: `node:test` + `node:assert/strict` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-18-agent-driven-test-authoring.md`

## Global Constraints

- Node 22, TypeScript strict. Agent-supplied selectors must be plain CSS or an allowlisted `page.getBy…` expression (`utils/locator.ts`).
- Capture MUST route execution through `resolveLocator` (no duplicate locator engine).
- Keep `Step` in sync across `backend/src/types/step.ts` and `frontend/src/types/index.ts:20-33`.
- Fixtures follow the `SCREENSHOTS_DIR`/`TRACES_DIR` pattern (`FIXTURES_DIR = process.env.FIXTURES_DIR || './fixtures'`, `fs.mkdir(recursive)`, compose volume).
- Tests: `cd backend && npx dotenv -e ../.env -- tsx --test tests/<file>.test.ts` / `cd frontend && npx tsx --test tests/<file>.test.ts`. Live-browser tests skip without Chromium.
- Branding stays "ShipItAnyway".

---

### Task 1: File-fixture storage (model + upload/list API)

**Files:**
- Modify: `backend/package.json` (add `@fastify/multipart`)
- Modify: `backend/prisma/schema.prisma` (new `Fixture` model; `Project.fixtures` back-relation)
- Create: `backend/prisma/migrations/<new-timestamp>_add_fixtures/migration.sql`
- Create: `backend/src/routes/fixtures.ts`
- Modify: `backend/src/index.ts` (register `@fastify/multipart` and `fixtureRoutes`; define `FIXTURES_DIR`; static-serve not required — worker reads disk)
- Modify: `docker-compose.override.yml` (mount a `fixtures` volume; set `FIXTURES_DIR`)
- Test: `backend/tests/fixtures.test.ts`

**Interfaces:**
- Produces:
  - `Fixture { id, projectId, filename, storedName, size, createdAt }` model.
  - `POST /projects/:projectId/fixtures` (multipart, field `file`) → `201 { fixture }`.
  - `GET /projects/:projectId/fixtures` → `{ fixtures: Fixture[] }`.
  - `resolveFixturePath(storedName: string): string` (in `fixtures.ts`, exported) → absolute path under `FIXTURES_DIR`.

- [ ] **Step 1: Add the dependency**

Run: `cd backend && pnpm add @fastify/multipart`
Expected: `@fastify/multipart` in `dependencies` (v9.x for Fastify 5).

- [ ] **Step 2: Write the failing test**

Create `backend/tests/fixtures.test.ts` (reuse `data-case-run.test.ts` harness helpers; register
`fixtureRoutes` **and** `@fastify/multipart` in `buildApp`). Upload via an injected multipart payload:

```ts
test('upload stores a fixture and list returns it', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email); // registers multipart + fixtureRoutes
  try {
    const boundary = '----t';
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hi.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/fixtures`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().fixture.filename, 'hi.txt');
    const list = await app.inject({ method: 'GET', url: `/projects/${project.id}/fixtures` });
    assert.equal(list.json().fixtures.length, 1);
  } finally {
    await app.close(); await cleanup(project.id, user.id);
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/fixtures.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 4: Add the `Fixture` model + migration**

In `schema.prisma`:

```prisma
model Fixture {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  filename   String
  storedName String
  size       Int
  createdAt  DateTime @default(now())
  @@index([projectId])
}
```

Add `fixtures Fixture[]` to `model Project`. Run
`cd backend && npx dotenv -e ../.env -- prisma migrate dev --name add_fixtures`.

- [ ] **Step 5: Implement the routes**

Create `backend/src/routes/fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import prisma from '../prisma';
import { requireProjectRole } from '../utils/project-access';

const FIXTURES_DIR = path.resolve(process.env.FIXTURES_DIR || './fixtures');
export function resolveFixturePath(storedName: string): string {
  return path.join(FIXTURES_DIR, storedName);
}

export async function fixtureRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/fixtures', async (req, reply) => {
    await requireProjectRole(req.params.projectId, req.user.userId, ['OWNER', 'EDITOR']);
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });
    await fs.mkdir(FIXTURES_DIR, { recursive: true });
    const storedName = `${randomUUID()}${path.extname(data.filename)}`;
    await pipeline(data.file, createWriteStream(resolveFixturePath(storedName)));
    const { size } = await fs.stat(resolveFixturePath(storedName));
    const fixture = await prisma.fixture.create({
      data: { projectId: req.params.projectId, filename: data.filename, storedName, size }
    });
    return reply.code(201).send({ fixture });
  });

  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/fixtures', async (req) => {
    await requireProjectRole(req.params.projectId, req.user.userId, ['OWNER', 'EDITOR', 'VIEWER']);
    const fixtures = await prisma.fixture.findMany({
      where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' }
    });
    return { fixtures };
  });
}
```

- [ ] **Step 6: Register the plugin + routes + volume**

In `backend/src/index.ts`: `await fastify.register(import('@fastify/multipart'));` and
`fastify.register(fixtureRoutes);` (~192-202). In `docker-compose.override.yml` add a `fixtures`
volume mount and `FIXTURES_DIR: /app/fixtures` in `x-backend-env` (mirror the screenshots/traces mounts).

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/prisma backend/src/routes/fixtures.ts backend/src/index.ts docker-compose.override.yml backend/tests/fixtures.test.ts
git commit -m "feat(fixtures): project file-fixture storage with multipart upload + list"
```

---

### Task 2: `upload` action end-to-end (wired to fixtures)

**Files:**
- Modify: `backend/src/types/step.ts`; `backend/src/schemas/test.schema.ts:22-54`
- Modify: `backend/src/queue/worker.ts` (`switch` ~286-387 — resolve fixture, `setInputFiles`)
- Modify: `backend/src/services/exporter.ts` (`stepToCode` — `upload`)
- Modify: `backend/src/services/validator.ts` (upload in dry-run)
- Modify: `frontend/src/types/index.ts:20-33`; `frontend/src/components/StepEditor.tsx:41-57`
- Test: `backend/tests/upload-action.test.ts`

**Interfaces:**
- Consumes: `resolveFixturePath` (Task 1), `prisma.fixture`.
- Produces: `Step` variant `{ action: 'upload'; selector: string; value: string /* fixtureId */ }` executed as `locator.setInputFiles(resolveFixturePath(fixture.storedName))`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/upload-action.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { StepSchema } from '../src/schemas/test.schema';
import { stepToCode } from '../src/services/exporter';

test('StepSchema accepts an upload step', () => {
  assert.equal(StepSchema.safeParse({ action: 'upload', selector: 'input[type=file]', value: 'fx_123' }).success, true);
});
test('exporter serializes upload to setInputFiles', () => {
  const code = stepToCode({ action: 'upload', selector: 'input[type=file]', value: 'fx_123' });
  assert.match(code, /setInputFiles/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/upload-action.test.ts`
Expected: FAIL — `upload` not in the enum / no exporter branch.

- [ ] **Step 3: Add `upload` to type + schema**

Add `| 'upload'` to `Step.action` (`types/step.ts`) and `'upload'` to the Zod `z.enum([...])`.

- [ ] **Step 4: Worker resolves the fixture and uploads**

In `worker.ts` `switch`:

```ts
case 'upload': {
  const fixture = await prisma.fixture.findUnique({ where: { id: step.value! } });
  if (!fixture) throw new Error(`Fixture not found: ${step.value}`);
  await resolveLocator(page, step.selector!).first().setInputFiles(resolveFixturePath(fixture.storedName));
  break;
}
```

Import `resolveFixturePath` from `../routes/fixtures` (or move it to `utils/fixtures.ts` if you prefer
not to import a route module — a one-line move; note it in the commit).

- [ ] **Step 5: Exporter + validator branches**

`exporter.ts` `stepToCode`: emit `await <locator>.setInputFiles(${JSON.stringify('./fixtures/' + filename)});`
— but `stepToCode` only has the step, not the fixture filename. Simplest: emit
`.setInputFiles(${JSON.stringify(step.value)})` (the fixtureId) with a
`// ponytail: exporter references fixtureId; bundling the real file is a follow-on` comment. Ensure
`stepToCode` is exported. `validator.ts`: resolve the fixture the same way as the worker (it already
receives `FIXTURES_DIR` in the subprocess env via `validation-runner.ts`), or treat a missing fixture as
a validation warning.

- [ ] **Step 6: Frontend option + type**

Add `'upload'` to the frontend `Step` action union and
`{ value: 'upload', label: 'Upload file', group: 'Actions', needsSelector: true, needsValue: true }`
to `ACTION_OPTIONS` (the fixture picker UI comes in Task 7).

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/upload-action.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/types/step.ts backend/src/schemas/test.schema.ts backend/src/queue/worker.ts backend/src/services/exporter.ts backend/src/services/validator.ts frontend/src/types/index.ts frontend/src/components/StepEditor.tsx backend/tests/upload-action.test.ts
git commit -m "feat(steps): upload action backed by stored fixtures (setInputFiles)"
```

---

### Task 3: Live driven recording session core

**Files:**
- Create: `backend/src/services/driven-recorder.ts`
- Test: `backend/tests/driven-recorder.test.ts`

**Interfaces:**
- Consumes: `launchChromium` (`utils/browser.ts`), `Step`.
- Produces:
  - `startDrivenSession(input: { projectId; userId; url; device? }): Promise<{ sessionId; steps: Step[] }>`
  - `getDrivenSession(id): DrivenSession | undefined`
  - `stopDrivenSession(id): Promise<{ steps: Step[] }>`
  - `type DrivenSession = { id; projectId; userId; browser; context; page; steps: Step[] }`

- [ ] **Step 1: Write the failing test (Chromium-guarded)**

Create `backend/tests/driven-recorder.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { startDrivenSession, getDrivenSession, stopDrivenSession } from '../src/services/driven-recorder';
import { launchChromium } from '../src/utils/browser';

async function chromiumAvailable() {
  try { const b = await launchChromium(); await b.close(); return true; } catch { return false; }
}
const hasChromium = await chromiumAvailable();

test('start records initial goto; stop returns steps and frees the browser',
  { skip: !hasChromium && 'chromium unavailable' }, async () => {
    const { sessionId, steps } = await startDrivenSession({
      projectId: 'p1', userId: 'u1', url: 'data:text/html,<button id=b>Hi</button>'
    });
    assert.ok(sessionId);
    assert.equal(steps[0].action, 'goto');
    assert.ok(getDrivenSession(sessionId));
    const stopped = await stopDrivenSession(sessionId);
    assert.equal(stopped.steps[0].action, 'goto');
    assert.equal(getDrivenSession(sessionId), undefined);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/driven-recorder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the session store**

Create `backend/src/services/driven-recorder.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChromium } from '../utils/browser';
import type { Step } from '../types/step';

export interface DrivenSession {
  id: string; projectId: string; userId: string;
  browser: Browser; context: BrowserContext; page: Page; steps: Step[];
}
// ponytail: in-memory, lost on restart, no cap. Add a Recording table only if sessions must survive.
const sessions = new Map<string, DrivenSession>();

export function getDrivenSession(id: string): DrivenSession | undefined { return sessions.get(id); }

export async function startDrivenSession(input: {
  projectId: string; userId: string; url: string; device?: string;
}): Promise<{ sessionId: string; steps: Step[] }> {
  const browser = await launchChromium();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  const steps: Step[] = [{ action: 'goto', value: input.url }];
  const id = randomUUID();
  sessions.set(id, { id, projectId: input.projectId, userId: input.userId, browser, context, page, steps });
  return { sessionId: id, steps };
}

export async function stopDrivenSession(id: string): Promise<{ steps: Step[] }> {
  const session = sessions.get(id);
  if (!session) return { steps: [] };
  sessions.delete(id);
  await session.browser.close().catch(() => undefined);
  return { steps: session.steps };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/driven-recorder.test.ts`
Expected: PASS (or SKIP without Chromium).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driven-recorder.ts backend/tests/driven-recorder.test.ts
git commit -m "feat(recording): live library-driven recording session store"
```

---

### Task 4: Per-action capture + step enrichment

**Files:**
- Modify: `backend/src/services/driven-recorder.ts` (add `performDrivenAction` + `DrivenActionError`)
- Test: `backend/tests/driven-action.test.ts`

**Interfaces:**
- Consumes: `resolveLocator`, `deriveSelectorCandidates`, `resolveBrowserUrl` (export from the worker/util if private), `resolveFixturePath` + `prisma.fixture` (for `upload`), `expect` from `@playwright/test`.
- Produces: `performDrivenAction(sessionId, action: Step): Promise<{ step: Step; screenshot: string }>`; throws `DrivenActionError` on unresolved selector / failed assertion.

- [ ] **Step 1: Write the failing test (Chromium-guarded)**

Create `backend/tests/driven-action.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { startDrivenSession, performDrivenAction, stopDrivenSession } from '../src/services/driven-recorder';
import { launchChromium } from '../src/utils/browser';

async function chromiumAvailable() {
  try { const b = await launchChromium(); await b.close(); return true; } catch { return false; }
}
const hasChromium = await chromiumAvailable();

test('click is executed, appended, and enriched',
  { skip: !hasChromium && 'chromium unavailable' }, async () => {
    const { sessionId } = await startDrivenSession({
      projectId: 'p1', userId: 'u1', url: 'data:text/html,<button id=b>Hi</button>'
    });
    try {
      const { step, screenshot } = await performDrivenAction(sessionId, { action: 'click', selector: '#b' });
      assert.equal(step.action, 'click');
      assert.equal(step.selector, '#b');
      assert.ok(Array.isArray(step.selectorCandidates));
      assert.ok(screenshot.length > 0);
    } finally { await stopDrivenSession(sessionId); }
  });

test('a failing assertion throws and appends nothing',
  { skip: !hasChromium && 'chromium unavailable' }, async () => {
    const { sessionId } = await startDrivenSession({
      projectId: 'p1', userId: 'u1', url: 'data:text/html,<div>only this</div>'
    });
    try {
      await assert.rejects(() => performDrivenAction(sessionId, { action: 'assertVisible', selector: '#missing' }));
      const { steps } = await stopDrivenSession(sessionId);
      assert.equal(steps.length, 1); // only the initial goto
    } catch (e) { await stopDrivenSession(sessionId); throw e; }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/driven-action.test.ts`
Expected: FAIL — `performDrivenAction` not exported.

- [ ] **Step 3: Implement `performDrivenAction`**

Add to `driven-recorder.ts` (mirror the worker's `switch`; execute the primary selector via
`resolveLocator`; for `upload` resolve the fixture like the worker; complete the remaining `assert*`
branches from `worker.ts:313-384`):

```ts
import { expect } from '@playwright/test';
import prisma from '../prisma';
import { resolveLocator } from '../utils/locator';
import { deriveSelectorCandidates } from '../utils/selector-variants';
import { resolveBrowserUrl } from '../utils/browser'; // export if private
import { resolveFixturePath } from '../routes/fixtures';

export class DrivenActionError extends Error {}

export async function performDrivenAction(
  sessionId: string, action: Step
): Promise<{ step: Step; screenshot: string }> {
  const session = sessions.get(sessionId);
  if (!session) throw new DrivenActionError('Session not found');
  const { page } = session;
  try {
    switch (action.action) {
      case 'goto':         await page.goto(resolveBrowserUrl(action.value!), { waitUntil: 'domcontentloaded' }); break;
      case 'click':        await resolveLocator(page, action.selector!).first().click(); break;
      case 'fill':         await resolveLocator(page, action.selector!).first().fill(action.value ?? ''); break;
      case 'press':        await resolveLocator(page, action.selector!).first().press(action.value ?? ''); break;
      case 'keyboardPress':await page.keyboard.press(action.value ?? ''); break;
      case 'selectOption': await resolveLocator(page, action.selector!).first().selectOption(action.value ?? ''); break;
      case 'upload': {
        const fx = await prisma.fixture.findUnique({ where: { id: action.value! } });
        if (!fx) throw new DrivenActionError(`Fixture not found: ${action.value}`);
        await resolveLocator(page, action.selector!).first().setInputFiles(resolveFixturePath(fx.storedName));
        break;
      }
      case 'assertVisible':await expect(resolveLocator(page, action.selector!).first()).toBeVisible({ timeout: 5000 }); break;
      case 'assertHidden': await expect(resolveLocator(page, action.selector!).first()).toBeHidden({ timeout: 5000 }); break;
      case 'assertText':   await expect(resolveLocator(page, action.selector!).first()).toContainText(action.expected ?? '', { timeout: 5000 }); break;
      // remaining assert* mirror worker.ts:313-384
      default: throw new DrivenActionError(`Unsupported action: ${action.action}`);
    }
  } catch (err) {
    throw err instanceof DrivenActionError ? err : new DrivenActionError((err as Error).message);
  }
  const step: Step = { ...action };
  if (action.selector) {
    step.selectorCandidates = deriveSelectorCandidates(action.selector);
    try {
      const meta = await resolveLocator(page, action.selector).first()
        .evaluate((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 120) }));
      step.elementTag = meta.tag; step.elementText = meta.text || undefined;
    } catch { /* enrichment optional */ }
  }
  session.steps.push(step);
  return { step, screenshot: (await page.screenshot()).toString('base64') };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/driven-action.test.ts`
Expected: PASS (or SKIP without Chromium).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driven-recorder.ts backend/tests/driven-action.test.ts
git commit -m "feat(recording): per-action capture with candidate + element enrichment"
```

---

### Task 5: HTTP endpoints for driven recording

**Files:**
- Modify: `backend/src/routes/recordings.ts` (three routes + Zod body)
- Test: `backend/tests/driven-recording-routes.test.ts`

**Interfaces:**
- Consumes: `startDrivenSession`/`performDrivenAction`/`stopDrivenSession`/`getDrivenSession`/`DrivenActionError`, `requireProjectRole`, `StepSchema`.
- Produces: `POST /recordings/driven/start` `201 { sessionId, steps }`; `POST /recordings/driven/:id/action` `200 { step, screenshot }` | `422 { error }` | `404`; `POST /recordings/driven/:id/stop` `200 { steps }`.

- [ ] **Step 1: Write the failing test (access control, no browser needed)**

Create `backend/tests/driven-recording-routes.test.ts` (reuse harness; register `recordingRoutes`):

```ts
test('driven start rejects a non-member with 403', async () => {
  const { user, project } = await createProjectAccess();
  const outsider = await prisma.user.create({ data: { email: `o-${Date.now()}@e.com`, passwordHash: 'x' } });
  const app = await buildApp(outsider.id, outsider.email);
  try {
    const res = await app.inject({ method: 'POST', url: '/recordings/driven/start',
      payload: { projectId: project.id, url: 'data:text/html,<b>x</b>' } });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close(); await cleanup(project.id, user.id);
    await prisma.user.delete({ where: { id: outsider.id } }).catch(() => undefined);
  }
});

test('action on an unknown session is 404', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);
  try {
    const res = await app.inject({ method: 'POST', url: '/recordings/driven/nope/action',
      payload: { action: 'click', selector: '#x' } });
    assert.equal(res.statusCode, 404);
  } finally { await app.close(); await cleanup(project.id, user.id); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/driven-recording-routes.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 3: Add the routes**

In `backend/src/routes/recordings.ts` (import the service fns + `StepSchema`):

```ts
fastify.post<{ Body: { projectId: string; url: string; device?: string } }>(
  '/recordings/driven/start', async (req, reply) => {
    await requireProjectRole(req.body.projectId, req.user.userId, ['OWNER', 'EDITOR']);
    return reply.code(201).send(await startDrivenSession({ ...req.body, userId: req.user.userId }));
  });

fastify.post<{ Params: { id: string }; Body: unknown }>(
  '/recordings/driven/:id/action', async (req, reply) => {
    const session = getDrivenSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    await requireProjectRole(session.projectId, req.user.userId, ['OWNER', 'EDITOR']);
    const action = StepSchema.parse(req.body);
    try { return await performDrivenAction(req.params.id, action); }
    catch (err) {
      if (err instanceof DrivenActionError) return reply.code(422).send({ error: err.message });
      throw err;
    }
  });

fastify.post<{ Params: { id: string } }>(
  '/recordings/driven/:id/stop', async (req, reply) => {
    const session = getDrivenSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    await requireProjectRole(session.projectId, req.user.userId, ['OWNER', 'EDITOR']);
    return stopDrivenSession(req.params.id);
  });
```

These stay behind the JWT guard (not added to the public allowlist).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/driven-recording-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/recordings.ts backend/tests/driven-recording-routes.test.ts
git commit -m "feat(recording): HTTP endpoints for driven session start/action/stop"
```

---

### Task 6: MCP server (agent surface)

**Files:**
- Create: `mcp-server/package.json`, `mcp-server/src/index.ts`, `mcp-server/src/client.ts` (thin HTTP client for the driven API)
- Modify: `backend/package.json` root workspace / `pnpm-workspace.yaml` (add the package)
- Modify: `docker-compose.yml` / `docker-compose.override.yml` (compose service)
- Test: `mcp-server/tests/tools.test.ts`

**Interfaces:**
- Consumes: the backend driven API (Task 5) via `client.ts`; a configured backend credential (env `BACKEND_URL`, `BACKEND_TOKEN`).
- Produces: an MCP server exposing tools `start_recording(projectId, url, device?)`, `navigate(url)`, `click(selector)`, `type(selector, value)`, `select(selector, value)`, `upload(selector, fixtureId)`, `assert(kind, selector, expected?)`, `finish_recording()` → each returns the captured step + screenshot; `finish_recording` returns `{ steps }`.

- [ ] **Step 1: Add the SDK + scaffold the package**

Run: `pnpm --filter mcp-server add @modelcontextprotocol/sdk` after creating
`mcp-server/package.json` (name `@shipitanyway/mcp-server`, `type: module`, `tsx` dev dep). Add the
folder to `pnpm-workspace.yaml`.

- [ ] **Step 2: Write the failing test (tool → HTTP mapping, HTTP stubbed)**

Create `mcp-server/tests/tools.test.ts`. Inject a fake `client` and assert each tool maps to the right
call and passes the current `sessionId` through:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTools } from '../src/index';

test('click tool forwards the active session and selector', async () => {
  const calls: any[] = [];
  const client = {
    startDriven: async () => ({ sessionId: 's1', steps: [] }),
    action: async (id: string, a: unknown) => { calls.push([id, a]); return { step: a, screenshot: 'x' }; },
    stopDriven: async () => ({ steps: [] })
  };
  const tools = buildTools(client as any);
  await tools.start_recording.handler({ projectId: 'p', url: 'https://e.com' });
  await tools.click.handler({ selector: '#b' });
  assert.deepEqual(calls[0], ['s1', { action: 'click', selector: '#b' }]);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mcp-server && npx tsx --test tests/tools.test.ts`
Expected: FAIL — `buildTools` not found.

- [ ] **Step 4: Implement the client + tools + server**

`mcp-server/src/client.ts`: a `fetch` wrapper calling `POST {BACKEND_URL}/recordings/driven/*` with the
`Authorization: Bearer ${BACKEND_TOKEN}` header (`// ponytail: single configured service token; swap for
a Phase-2 scoped project token`). `mcp-server/src/index.ts`: `buildTools(client)` returning the tool set
(each tool executes via the client and holds the active `sessionId` in closure), wired into an
`@modelcontextprotocol/sdk` `Server` over stdio. Each non-finish tool builds a `Step`-shaped action and
calls `client.action(sessionId, action)`, returning the step + screenshot as tool content.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mcp-server && npx tsx --test tests/tools.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the compose service**

Add an `mcp-server` service to compose (build the package, env `BACKEND_URL=http://backend:3000`,
`BACKEND_TOKEN`), `depends_on: backend`. Document the stdio-transport variant for a local agent CLI in
the service comment.

- [ ] **Step 7: Commit**

```bash
git add mcp-server pnpm-workspace.yaml docker-compose.yml docker-compose.override.yml
git commit -m "feat(mcp): MCP server exposing browser-recording tools for agent CLIs"
```

---

### Task 7: Frontend — fixture UI + thin driven-recording driver

**Files:**
- Modify: `frontend/src/api/client.ts` (`startDrivenRecording`, `sendDrivenAction`, `stopDrivenRecording`, `uploadFixture`, `listFixtures`)
- Modify: `frontend/src/components/StepEditor.tsx` (fixture picker for `upload` steps)
- Modify: `frontend/src/pages/TestEditorPage.tsx` (thin driven-recording path)

**Interfaces:**
- Consumes: Tasks 1, 5 endpoints; `Step` (with `upload`).
- Produces: the client methods above; an `upload`-step fixture picker; a start→action→finish UI.

- [ ] **Step 1: Add API client methods**

In `frontend/src/api/client.ts`:

```ts
startDrivenRecording = (projectId: string, url: string, device?: string) =>
  api.post<{ sessionId: string; steps: Step[] }>('/recordings/driven/start', { projectId, url, device });
sendDrivenAction = (sessionId: string, action: Step) =>
  api.post<{ step: Step; screenshot: string }>(`/recordings/driven/${sessionId}/action`, action);
stopDrivenRecording = (sessionId: string) =>
  api.post<{ steps: Step[] }>(`/recordings/driven/${sessionId}/stop`);
uploadFixture = (projectId: string, file: File) => {
  const form = new FormData(); form.append('file', file);
  return api.post(`/projects/${projectId}/fixtures`, form);
};
listFixtures = (projectId: string) => api.get(`/projects/${projectId}/fixtures`);
```

- [ ] **Step 2: Fixture picker on upload steps**

In `StepEditor.tsx`, when a step's action is `upload`, render a fixture `<Select>` (populated via
`listFixtures`) plus an inline `<Upload>` that calls `uploadFixture` and selects the new fixture — the
step's `value` is the chosen `fixtureId`.

- [ ] **Step 3: Thin driven-recording path**

In `TestEditorPage.tsx`, add a "Driven recording" button that calls `startDrivenRecording`, stores the
session id, shows an action form (reusing `ACTION_OPTIONS`) that calls `sendDrivenAction` and appends the
returned `step` (rendering the screenshot), and a "Finish" button that calls `stopDrivenRecording` and
merges via `replaceOrAppendRecordedSteps`. Keep it minimal — agents use MCP; this is the human path.

- [ ] **Step 4: Manually verify end to end**

Upload a fixture; build a test with an `upload` step; start a driven recording, send goto/click/fill/upload;
finish; Save; Run — confirm it replays and the upload attaches the fixture.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/components/StepEditor.tsx frontend/src/pages/TestEditorPage.tsx
git commit -m "feat(recording): fixture picker + thin driven-recording UI"
```

---

## Self-Review

**Spec coverage:** R1 (fixtures + upload) → Tasks 1,2,7. R2 (session core) → Task 3. R3 (capture + enrichment + assertion feedback) → Task 4. R4 (HTTP) → Task 5. R5 (MCP server) → Task 6. R6 (frontend) → Tasks 2,7. All mapped.

**Placeholder scan:** every code step carries real code or an exact edit target; `assert*` completion and the validator branch cite exact source lines; `ponytail:` ceilings (in-memory sessions, exporter fixtureId, single MCP token, no fixture GC) are flagged, not silently skipped.

**Type consistency:** `Step` (with `upload`, value = fixtureId) throughout. `startDrivenSession → { sessionId, steps }`, `performDrivenAction → { step, screenshot }`, `stopDrivenSession → { steps }` consistent across service (3,4), routes (5), client (7), and MCP tools (6). `DrivenActionError → 422` in the route. `resolveFixturePath` shared by Task 1 (def), 2 (worker), 4 (capture). `resolveLocator`/`deriveSelectorCandidates`/`resolveBrowserUrl` are the reused shared utilities.

**Ordering:** 1 → 2 (fixtures before the upload action that resolves them). 3 → 4 → 5 sequential. 4 depends on 1 (fixture resolve) and 3 (session). 6 depends on 5 (HTTP surface it calls). 7 depends on 1 and 5. Recommended order = task number order. `resolveBrowserUrl` may be a private worker helper — verify/export during Task 4.
