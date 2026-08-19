import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { client as drivenClient, type DrivenClient, type PageView } from './client.js';

// ── content helpers ───────────────────────────────────────────────────────────

function pageViewContent(view: PageView, step?: unknown) {
  const lines = [`url: ${view.url}`, `title: ${view.title}`, '', view.snapshot];
  if (step !== undefined) lines.push('', JSON.stringify(step));
  return {
    content: [
      { type: 'image' as const, data: view.screenshot, mimeType: 'image/png' },
      { type: 'text' as const, text: lines.join('\n') },
    ],
  };
}

// ── tool record type (testable without the SDK) ───────────────────────────────

export type ToolDef = { handler: (args: Record<string, unknown>) => Promise<unknown> };
export type ToolRecord = Record<string, ToolDef>;

// ── buildTools: pure function over the client, sessionId held in closure ──────

export function buildTools(client: DrivenClient): ToolRecord {
  let sessionId: string | null = null;

  return {
    start_recording: {
      handler: async (args) => {
        const { projectId, url, device } = args as { projectId: string; url: string; device?: string };
        const res = await client.startDriven({ projectId, url, device });
        sessionId = res.sessionId;
        return pageViewContent(res.view);
      },
    },

    observe: {
      handler: async (_args) => {
        const res = await client.observe(sessionId!);
        return pageViewContent(res.view);
      },
    },

    navigate: {
      handler: async (args) => {
        const res = await client.action(sessionId!, { action: 'goto', value: args.url as string });
        return pageViewContent(res.view, res.step);
      },
    },

    click: {
      handler: async (args) => {
        const res = await client.action(sessionId!, { action: 'click', selector: args.selector as string });
        return pageViewContent(res.view, res.step);
      },
    },

    type: {
      handler: async (args) => {
        const res = await client.action(sessionId!, { action: 'fill', selector: args.selector as string, value: args.value as string });
        return pageViewContent(res.view, res.step);
      },
    },

    select: {
      handler: async (args) => {
        const res = await client.action(sessionId!, { action: 'selectOption', selector: args.selector as string, value: args.value as string });
        return pageViewContent(res.view, res.step);
      },
    },

    upload: {
      handler: async (args) => {
        // upload passes fixtureId as the step value so the backend resolves the fixture by id
        const res = await client.action(sessionId!, { action: 'upload', selector: args.selector as string, value: args.fixtureId as string });
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
        const res = await client.action(sessionId!, step as { action: string });
        return pageViewContent(res.view, res.step);
      },
    },

    finish_recording: {
      handler: async (_args) => {
        const res = await client.stopDriven(sessionId!);
        sessionId = null;
        return { content: [{ type: 'text' as const, text: JSON.stringify(res) }] };
      },
    },
  };
}

// ── per-tool Zod input schemas (raw shapes for registerTool) ──────────────────

const toolSchemas: Record<string, Record<string, z.ZodTypeAny>> = {
  start_recording:  { projectId: z.string(), url: z.string(), device: z.string().optional() },
  navigate:         { url: z.string() },
  click:            { selector: z.string() },
  type:             { selector: z.string(), value: z.string() },
  select:           { selector: z.string(), value: z.string() },
  upload:           { selector: z.string(), fixtureId: z.string() },
  assert:           { kind: z.string(), selector: z.string().optional(), expected: z.string().optional() },
  observe:          {},
  finish_recording: {},
};

// ── stdio server entry point ──────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const server = new McpServer({ name: 'shipitanyway-recorder', version: '0.1.0' });
  const tools = buildTools(drivenClient);

  for (const [name, tool] of Object.entries(tools)) {
    const schema = toolSchemas[name] ?? {};
    server.registerTool(
      name,
      { inputSchema: schema },
      // SDK calls callback as (args, extra) when inputSchema is provided; we only need args.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args) => tool.handler(args as Record<string, unknown>) as any
    );
  }

  await server.connect(new StdioServerTransport());
}

// I3: pathToFileURL normalises a relative argv[1] so comparison against import.meta.url is reliable.
// Without this, `node --import tsx/esm src/index.ts` sets argv[1] to a relative path while
// import.meta.url is absolute → the bare === check would never fire.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startServer().catch(console.error);
}
