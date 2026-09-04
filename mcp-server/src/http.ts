import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { makeClient } from './client.js';
import { buildTools, toolSchemas } from './index.js';
import { groupsForScopes } from './gating.js';

// Static name → capability group map (mirrors buildTools' groups).
const AUTHORING = new Set(['start_recording','observe','navigate','click','type','select','upload','assert','finish_recording','save_test','validate_test','list_tests','get_test','delete_test']);
const REPORTING = new Set(['list_projects','list_runs','get_run','get_run_batch']);
const EXECUTION = new Set(['trigger_run']);

export function extractBearer(header?: string): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = m?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

export function gatedToolNames(scopes: string[], allNames: string[]): string[] {
  const g = groupsForScopes(scopes);
  return allNames.filter((n) =>
    (g.authoring && AUTHORING.has(n)) ||
    (g.reporting && REPORTING.has(n)) ||
    (g.execution && EXECUTION.has(n))
  );
}

export async function buildServerForToken(token: string): Promise<McpServer> {
  const client = makeClient(token);
  const caps = await client.getCapabilities(); // throws if the token is invalid (backend 401)
  const server = new McpServer({ name: 'shipitanyway', version: '0.2.0' });
  const tools = buildTools(client);
  const allowed = new Set(gatedToolNames(caps.scopes, Object.keys(tools)));
  for (const [name, tool] of Object.entries(tools)) {
    if (!allowed.has(name)) continue;
    const schema = toolSchemas[name] ?? {};
    server.registerTool(name, { inputSchema: schema }, (args) => tool.handler(args as Record<string, unknown>));
  }
  return server;
}

const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS ?? 'http://localhost,http://127.0.0.1').split(',').map((s) => s.trim()).filter(Boolean);

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startHttpServer(port = Number(process.env.MCP_PORT) || 3100): Promise<void> {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' })); return; }
    if (!req.url?.startsWith('/mcp')) { res.writeHead(404).end(); return; }

    const token = extractBearer(req.headers.authorization);
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' })); return; }

    let server: McpServer;
    try {
      server = await buildServerForToken(token);
    } catch {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid token' }));
      return;
    }

    // Origin / DNS-rebinding protection built into the transport.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedOrigins: ALLOWED_ORIGINS
    });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    await transport.handleRequest(req, res, body);
  });
  httpServer.listen(port, () => console.error(`[shipitanyway-mcp] http://0.0.0.0:${port}/mcp`));
}
