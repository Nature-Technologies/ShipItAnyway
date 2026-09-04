import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { makeClient, type SiaClient, type PageView, type Step } from './client.js';
import { textContent, type ToolDef, type ToolRecord } from './tooling.js';
import { reportingTools } from './tools/reporting.js';
import { executionTools } from './tools/execution.js';

export { textContent } from './tooling.js';
export type { ToolDef, ToolRecord } from './tooling.js';

// ── content helpers ───────────────────────────────────────────────────────────

function pageViewContent(view: PageView, step?: unknown): CallToolResult {
  const lines = [`url: ${view.url}`, `title: ${view.title}`, '', view.snapshot];
  if (step !== undefined) lines.push('', JSON.stringify(step));
  return {
    content: [
      { type: 'image' as const, data: view.screenshot, mimeType: 'image/png' },
      { type: 'text' as const, text: lines.join('\n') },
    ],
  };
}

// ── recording state shared across the tool groups ─────────────────────────────
// `active` is the live browser session; `finished` is the last completed recording,
// retained so the Tests group can persist it. A recording must be finished (active
// cleared, finished set) before it can be saved.

interface ActiveSession { id: string; projectId: string; url: string }
interface FinishedRecording { projectId: string; url: string; steps: Step[] }
interface RecordingState { active: ActiveSession | null; finished: FinishedRecording | null }

// ── Group: Recording — session lifecycle + per-action browser drive ───────────

function recordingTools(client: SiaClient, state: RecordingState): ToolRecord {
  const requireActive = (): ActiveSession => {
    if (!state.active) throw new Error('No active recording session. Call start_recording first.');
    return state.active;
  };

  return {
    start_recording: {
      handler: async (args) => {
        const { projectId, url, device } = args as { projectId: string; url: string; device?: string };
        const res = await client.startDriven({ projectId, url, device });
        state.active = { id: res.sessionId, projectId, url };
        state.finished = null; // a fresh recording invalidates any prior finished capture
        return pageViewContent(res.view);
      },
    },

    observe: {
      handler: async () => pageViewContent((await client.observe(requireActive().id)).view),
    },

    navigate: {
      handler: async (args) => {
        const res = await client.action(requireActive().id, { action: 'goto', value: args.url as string });
        return pageViewContent(res.view, res.step);
      },
    },

    click: {
      handler: async (args) => {
        const res = await client.action(requireActive().id, { action: 'click', selector: args.selector as string });
        return pageViewContent(res.view, res.step);
      },
    },

    type: {
      handler: async (args) => {
        const res = await client.action(requireActive().id, { action: 'fill', selector: args.selector as string, value: args.value as string });
        return pageViewContent(res.view, res.step);
      },
    },

    select: {
      handler: async (args) => {
        const res = await client.action(requireActive().id, { action: 'selectOption', selector: args.selector as string, value: args.value as string });
        return pageViewContent(res.view, res.step);
      },
    },

    upload: {
      handler: async (args) => {
        // upload passes fixtureId as the step value so the backend resolves the fixture by id
        const res = await client.action(requireActive().id, { action: 'upload', selector: args.selector as string, value: args.fixtureId as string });
        return pageViewContent(res.view, res.step);
      },
    },

    assert: {
      handler: async (args) => {
        const kind = args.kind as string;
        const actionMap: Record<string, string> = {
          visible: 'assertVisible', hidden: 'assertHidden', text: 'assertText',
          value: 'assertValue', url: 'assertURL', title: 'assertTitle',
          checked: 'assertChecked', count: 'assertCount',
        };
        const action = actionMap[kind] ?? `assert${kind[0].toUpperCase()}${kind.slice(1)}`;
        const step: Record<string, unknown> = { action };
        if (args.selector !== undefined) step.selector = args.selector;
        if (args.expected !== undefined) step.expected = args.expected;
        const res = await client.action(requireActive().id, step as { action: string });
        return pageViewContent(res.view, res.step);
      },
    },

    finish_recording: {
      handler: async () => {
        const active = requireActive();
        const res = await client.stopDriven(active.id);
        // retain the completed recording so it can be saved by save_test
        state.finished = { projectId: active.projectId, url: active.url, steps: res.steps };
        state.active = null;
        return textContent({ steps: res.steps });
      },
    },
  };
}

// ── Group: Tests — persist / validate / manage recorded tests ─────────────────

function testTools(client: SiaClient, state: RecordingState): ToolRecord {
  // A recording can only be saved once it is finished: no session may still be active,
  // and a finished capture must exist.
  const requireSavable = (): FinishedRecording => {
    if (state.active) throw new Error('Recording still in progress. Call finish_recording before saving.');
    if (!state.finished) throw new Error('No finished recording to save. Record a session and call finish_recording first.');
    return state.finished;
  };
  const resolveProjectId = (args: Record<string, unknown>): string => {
    const projectId = (args.projectId as string | undefined) ?? state.finished?.projectId ?? state.active?.projectId;
    if (!projectId) throw new Error('projectId is required (no recording context available).');
    return projectId;
  };

  return {
    save_test: {
      handler: async (args) => {
        const rec = requireSavable();
        const { name, device, environmentId } = args as { name: string; device?: string; environmentId?: string | null };
        const created = await client.createTest(rec.projectId, { name, url: rec.url, steps: rec.steps, device, environmentId });
        return textContent({ id: created.id, name: created.name });
      },
    },

    validate_test: {
      handler: async () => {
        const rec = requireSavable();
        return textContent(await client.validateSteps({ projectId: rec.projectId, url: rec.url, steps: rec.steps }));
      },
    },

    list_tests: {
      handler: async (args) => {
        const tests = await client.listTests(resolveProjectId(args));
        return textContent(tests.map((t) => ({ id: t.id, name: t.name, url: t.url })));
      },
    },

    get_test: {
      handler: async (args) => textContent(await client.getTest(args.testId as string)),
    },

    delete_test: {
      handler: async (args) => {
        await client.deleteTest(args.testId as string);
        return textContent({ deleted: args.testId });
      },
    },
  };
}

// ── buildTools: merge the operation groups over one shared recording state ─────

export function buildTools(client: SiaClient): ToolRecord {
  const state: RecordingState = { active: null, finished: null };
  return {
    ...recordingTools(client, state),
    ...testTools(client, state),
    ...reportingTools(client),
    ...executionTools(client)
  };
}

// ── per-tool Zod input schemas (raw shapes for registerTool) ──────────────────

export const toolSchemas: Record<string, Record<string, z.ZodTypeAny>> = {
  // Recording
  start_recording:  { projectId: z.string(), url: z.string(), device: z.string().optional() },
  navigate:         { url: z.string() },
  click:            { selector: z.string() },
  type:             { selector: z.string(), value: z.string() },
  select:           { selector: z.string(), value: z.string() },
  upload:           { selector: z.string(), fixtureId: z.string() },
  assert:           { kind: z.string(), selector: z.string().optional(), expected: z.string().optional() },
  observe:          {},
  finish_recording: {},
  // Tests
  save_test:        { name: z.string(), device: z.string().optional(), environmentId: z.string().optional() },
  validate_test:    {},
  list_tests:       { projectId: z.string().optional() },
  get_test:         { testId: z.string() },
  delete_test:      { testId: z.string() },
  // Reporting
  list_projects:    {},
  list_runs:        { projectId: z.string(), status: z.string().optional(), trigger: z.string().optional(), since: z.string().optional(), testId: z.string().optional(), limit: z.coerce.number().optional(), cursor: z.string().optional() },
  get_run:          { runId: z.string() },
  get_run_batch:    { batchId: z.string() },
  // Execution
  trigger_run:      { testId: z.string().optional(), suiteId: z.string().optional(), environmentId: z.string() },
};

// I3: pathToFileURL normalises a relative argv[1] so comparison against import.meta.url is reliable.
// Without this, `node --import tsx/esm src/index.ts` sets argv[1] to a relative path while
// import.meta.url is absolute → the bare === check would never fire.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  import('./http.js').then((m) => m.startHttpServer().catch(console.error));
}
