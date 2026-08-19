import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

// ── stdio server entry point ──────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const server = new McpServer({ name: 'shipitanyway-recorder', version: '0.1.0' });
  const tools = buildTools(drivenClient);

  for (const [name, tool] of Object.entries(tools)) {
    // Wrap: SDK handler receives (args, extra); we only need args.
    server.registerTool(name, {}, (args: Record<string, unknown>) => tool.handler(args) as Promise<{ content: { type: string }[] }>);
  }

  await server.connect(new StdioServerTransport());
}

if (import.meta.filename && process.argv[1] === import.meta.filename) {
  startServer().catch(console.error);
}
