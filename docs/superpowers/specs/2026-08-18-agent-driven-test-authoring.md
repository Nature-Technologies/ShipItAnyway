# Spec — Agent-Driven Test Authoring (Roadmap 1.1)

**Status:** Ready for planning
**Roadmap item:** Phase 1.1 — "Agent-driven test authoring"
**Plan:** `docs/superpowers/plans/2026-08-18-agent-driven-test-authoring.md`

## Problem

The roadmap wants: *an agent (or human) performs any action a human can on a target site
(navigate, click, type, select, upload, assert), and each action is captured as a structured,
replayable step, persisted for deterministic re-run.*

**Confirmed intent:** an external agent *harness* — Claude Code, Codex, Grok CLI, etc. — should be
able to navigate a target site by itself and record the step sequence into the test runner, exactly
as a human does today. All three speak **MCP**, so MCP is the agent-facing surface.

Everything **downstream of a `Step` already exists and is reusable**:
- `Step` schema — `backend/src/types/step.ts` + Zod `StepSchema` (`backend/src/schemas/test.schema.ts:22-54`), mirrored in `frontend/src/types/index.ts:20-33`.
- Deterministic replay — `backend/src/queue/worker.ts` `switch(step.action)` (~286-387) via `runSingleTargetAction` (~53-167) and the shared `resolveLocator` (`backend/src/utils/locator.ts`).
- Validation — `backend/src/services/validator.ts` (sandboxed subprocess). Export — `backend/src/services/exporter.ts` (`stepToCode`). Steps persist as `Test.steps Json`.

**The gap** is the capture path + two missing capabilities:
1. **No incremental step API** — recording is start → (opaque codegen subprocess) → stop-returns-all (`services/recorder.ts:parseCodegenOutput`). Nothing an agent can call per-action.
2. **No agent-drivable browser** — the only driven browser is codegen's window; structured actions can't be injected.
3. **No agent protocol** — nothing exposes browser actions as MCP tools.
4. **No `upload` / file action, and no fixture storage** — the action set has no upload; there is no way to store a file for a test to attach.
5. **`elementText`/`elementTag` exist on `Step` but are never populated.**

## Verified current state (facts the plan relies on)

- `Step` actions today: `goto click fill press keyboardPress selectOption assertVisible assertHidden assertText assertValue assertURL assertTitle assertChecked assertCount waitForSelector`. **No `upload`.**
- `resolveLocator(page, selector)` (`utils/locator.ts`): `page.`-prefixed selectors are allowlist-validated (`getByRole/getByLabel/getByText/getByPlaceholder/getByTestId/getByTitle/getByAltText/locator`) and `eval`'d; otherwise raw CSS. **Agent selectors must be plain CSS or one of those `page.getBy…` expressions.**
- `deriveSelectorCandidates(selector)` (`utils/selector-variants.ts`) → fallback locators from a locator string (reuse to fill `Step.selectorCandidates`).
- `launchChromium()` (`utils/browser.ts`) launches a (headless) Chromium.
- Disk-asset pattern: `SCREENSHOTS_DIR`/`TRACES_DIR` = `process.env.X || './y'`, `fs.mkdir(recursive)`, mounted as compose volumes. **Fixtures follow the same pattern** (`FIXTURES_DIR`).
- **`@fastify/multipart` is NOT installed** (needed for fixture upload). **`@modelcontextprotocol/sdk` is NOT installed** (needed for the MCP server).
- Auth pattern: `requireProjectRole(projectId, userId, ['OWNER','EDITOR'])`; JWT `preHandler` global guard with a public-route allowlist (`index.ts:99-139`). Fastify 5.
- Recording sessions are in-memory (`recorder.ts:22`), single-active, lost on restart. Routes register in `index.ts:192-202`; client in `frontend/src/api/client.ts`; UI is `TestEditorPage.tsx` + `StepEditor.tsx`.

## Approach (decisions)

Add a **live, library-driven recording session** as the core, with **two front doors**:

1. **MCP server** (the agent surface, the roadmap's "New services · MCP server", pulled forward for
   authoring). A new MCP server process exposes tools — `start_recording`, `navigate`, `click`,
   `type`, `select`, `upload`, `assert`, `finish_recording` — that an agent CLI drives. Each tool call
   translates to an HTTP call against the backend driven-recording API, which executes the action on a
   real backend Playwright `Page` and records the resulting `Step`. `finish_recording` returns the
   accumulated `Step[]` (and optionally creates the `Test`).
2. **HTTP API** (also used by the existing web UI for a human/manual driver).

Both share one `driven-recorder` service: a real Playwright `Page` held in an in-memory map; actions
execute through the **same `resolveLocator`** the replay worker uses, so a captured selector resolves
identically at run time. The browser stays on the backend (where Chromium, traces, and `FIXTURES_DIR`
live); the MCP server is a thin translation layer, so agents run anywhere.

## Requirements

### R1 — File fixtures + `upload` action (full storage)
- **Fixture storage:** new `Fixture` model (`id, projectId, filename, storedName, size, createdAt`,
  `project` relation `onDelete: Cascade`). Files live under `FIXTURES_DIR` (`process.env.FIXTURES_DIR
  || './fixtures'`), mounted as a compose volume like screenshots/traces.
- **Upload API:** `POST /projects/:projectId/fixtures` (multipart via `@fastify/multipart`) →
  `201 { fixture }`; `GET /projects/:projectId/fixtures` → list; guarded `['OWNER','EDITOR']`
  (list also `VIEWER`).
- **`upload` action end-to-end:** add `upload` to `Step.action` (type + Zod), worker (`switch`),
  exporter, validator, and frontend `StepEditor.ACTION_OPTIONS` + types. `upload` step shape:
  `{ action: 'upload', selector, value }` where `value` is a **fixtureId**; the worker resolves it to
  `FIXTURES_DIR/<storedName>` and calls `locator.setInputFiles(path)`.
- **UI:** `StepEditor` upload step lets the user pick an uploaded fixture (or upload a new one inline).
- *Ceiling: export (`stepToCode`) references the fixture by original filename (`./fixtures/<filename>`);
  bundling fixtures into the exported zip is a follow-on. No fixture GC yet (cascades on project
  delete). Flag both with `ponytail:` comments.*

### R2 — Live driven recording session core
- New `backend/src/services/driven-recorder.ts`: `startDrivenSession`, `getDrivenSession`,
  `stopDrivenSession`. Session = `{ id, projectId, userId, browser, context, page, steps: Step[] }` in
  an in-memory `Map`. Start navigates to the URL and records the initial `goto`.
- *Ceiling: in-memory, lost on restart, no `Recording` table — add one only if sessions must survive.*

### R3 — Per-action capture endpoint/service
- `performDrivenAction(sessionId, action)` executes one structured action via `resolveLocator`,
  appends an enriched `Step` (candidates via `deriveSelectorCandidates`; `elementText`/`elementTag`
  from the live element), returns `{ step, screenshot }` (base64, for agent feedback).
- Assertion actions execute to confirm they hold at capture; a failing assertion returns an error and
  is **not** appended (feedback for the agent).

### R4 — HTTP surface
- `POST /recordings/driven/start` — `{ projectId, url, device? }` → `201 { sessionId, steps }`.
- `POST /recordings/driven/:id/action` — a `Step`-shaped body → `200 { step, screenshot }` | `422 { error }`.
- `POST /recordings/driven/:id/stop` → `{ steps }`, closes the browser.
- Guarded by `requireProjectRole(...,['OWNER','EDITOR'])` (start: body `projectId`; action/stop: the session's stored `projectId`).

### R5 — MCP server (agent surface)
- New service `mcp-server/` (or `backend/src/mcp/`) using `@modelcontextprotocol/sdk`, exposing the
  tools above. Each tool calls the backend HTTP driven API. Returns the screenshot + captured step so
  the agent can decide the next action; `finish_recording` returns the `Step[]`.
- **Auth ceiling:** scoped per-project tokens are Phase 2/4. For now the MCP server holds one
  configured backend credential (env: a service JWT / admin login) and takes `projectId` as a tool
  argument. Flag with a `ponytail:` note; swap for a scoped token when Phase 2 lands.
- Ships as a compose service and is runnable standalone (`node mcp-server`) so a local agent CLI can
  point at it via stdio or HTTP transport.

### R6 — Frontend (fixtures + thin human driver)
- `StepEditor`: `upload` option + fixture picker/upload (R1).
- API client: `startDrivenRecording`, `sendDrivenAction`, `stopDrivenRecording`, `uploadFixture`, `listFixtures`.
- `TestEditorPage`: a minimal driven-recording path (start → send actions → see steps+screenshots →
  finish → merge via `replaceOrAppendRecordedSteps`). *Full conversational UX is a follow-on; humans get
  a thin driver, agents use MCP.*

## Explicitly out of scope
- The LLM agent itself — that is the user's CLI harness; this spec delivers the MCP server it connects to.
- Resumable / persisted recording sessions (a `Recording` table).
- Bundling fixture files into the exported `.spec.ts` zip, and fixture garbage collection.
- Replacing or changing the existing codegen recorder (kept for humans who prefer it).

## Acceptance criteria
- A fixture uploads via `POST /projects/:id/fixtures` and appears in the list; a test with an
  `upload` step (value = fixtureId) validates, replays (worker calls `setInputFiles` with the resolved
  path), and exports to a `.setInputFiles(...)` line.
- `POST /recordings/driven/start` returns a session id + initial `goto`; the browser is live.
- `POST /recordings/driven/:id/action` (click/fill on a real element) appends a `Step` whose selector
  resolves via `resolveLocator`, with populated `selectorCandidates`, and returns a screenshot; a
  failing assertion returns `422` and appends nothing.
- `stop` returns the accumulated `Step[]` and frees the browser; those steps save as a `Test` and
  re-run deterministically.
- An MCP client can call `start_recording → navigate/click/type/upload/assert → finish_recording` and
  receive the resulting `Step[]`; the same steps save as a `Test`.
- Access control: a non-member is `403` on the HTTP endpoints.

## Test approach
`node:test` + `node:assert/strict` via `tsx --test`, Fastify `inject` with a `preHandler` stub, real
Prisma (per `backend/tests/data-case-run.test.ts`). Pure/adjacent logic (upload in exporter, upload in
the Zod schema, fixture path resolution, MCP tool→HTTP mapping) gets fast unit tests. Live-browser
tests drive a `data:`-URL page through the service directly and skip when Chromium is unavailable
(`launchChromium` guard). The MCP server is tested by invoking its tool handlers against a stubbed HTTP
layer (no real agent needed).
