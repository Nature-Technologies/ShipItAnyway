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

const DEFAULT_ORIGINS = ['http://localhost', 'http://127.0.0.1'];
const _configured = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (_configured.length === 0 && process.env.MCP_ALLOWED_ORIGINS !== undefined) {
  console.warn('[shipitanyway-mcp] MCP_ALLOWED_ORIGINS is set but empty; falling back to default origins');
}
const ALLOWED_ORIGINS = _configured.length > 0 ? _configured : DEFAULT_ORIGINS;

const MAX_BODY_BYTES = 1_000_000; // 1 MB

// Returns parsed body, or a sentinel object to signal caller to respond with an error code.
async function readBody(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) return { ok: false, status: 413 };
    chunks.push(buf);
  }
  if (chunks.length === 0) return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400 };
  }
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

    let parsedBody: unknown;
    if (req.method === 'POST') {
      const result = await readBody(req);
      if (!result.ok) {
        const msg = result.status === 413 ? 'Payload Too Large' : 'Invalid JSON';
        res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: msg }));
        return;
      }
      parsedBody = result.body;
    }

    // Origin / DNS-rebinding protection built into the transport.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedOrigins: ALLOWED_ORIGINS
    });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  });
  httpServer.on('error', (err) => { console.error('[shipitanyway-mcp] server error', err); process.exit(1); });
  httpServer.listen(port, () => console.error(`[shipitanyway-mcp] http://0.0.0.0:${port}/mcp`));
}
