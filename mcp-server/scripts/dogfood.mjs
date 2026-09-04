/**
 * Dogfood acceptance gate — drives SIA end-to-end through the HTTP MCP server.
 *
 * Positive check (EDITOR token):
 *   lists tools → must include list_projects, list_runs, get_run, trigger_run
 *   calls trigger_run → polls get_run until terminal status → exit 0
 *
 * Negative check (VIEWER token — run with DOGFOOD_NEGATIVE=1):
 *   lists tools → trigger_run must be ABSENT → exit 0 (gating confirmed)
 *
 * Usage:
 *   node mcp-server/scripts/dogfood.mjs
 *   DOGFOOD_NEGATIVE=1 SIA_MCP_TOKEN=$VIEWER_TOKEN node mcp-server/scripts/dogfood.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Fix: renamed from `URL` to avoid shadowing the global URL constructor.
const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3100/mcp';
const TOKEN = process.env.SIA_MCP_TOKEN;
const PROJECT_ID = process.env.DOGFOOD_PROJECT_ID;
const TEST_ID = process.env.DOGFOOD_TEST_ID;
const ENV_ID = process.env.DOGFOOD_ENV_ID;
const NEGATIVE = process.env.DOGFOOD_NEGATIVE === '1';

if (!TOKEN) { console.error('set SIA_MCP_TOKEN'); process.exit(2); }
if (!NEGATIVE && (!TEST_ID || !ENV_ID)) {
  console.error('set DOGFOOD_TEST_ID and DOGFOOD_ENV_ID (or DOGFOOD_NEGATIVE=1 for viewer check)');
  process.exit(2);
}

console.log(`[dogfood] connecting to ${MCP_URL} (negative=${NEGATIVE})`);

const transport = new StreamableHTTPClientTransport(
  new URL(MCP_URL),
  { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }
);
const client = new Client({ name: 'dogfood', version: '0.0.0' });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('[dogfood] tools:', JSON.stringify(tools));

const EXPECTED_REPORTING = ['list_projects', 'list_runs', 'get_run'];
const EXPECTED_EXECUTION = ['trigger_run'];

// ── Negative check ────────────────────────────────────────────────────────────
if (NEGATIVE) {
  const hasExecution = EXPECTED_EXECUTION.some((t) => tools.includes(t));
  if (hasExecution) {
    console.error('[dogfood] FAIL (negative): execution tools exposed to VIEWER token:', EXPECTED_EXECUTION.filter((t) => tools.includes(t)));
    process.exit(1);
  }
  console.log('[dogfood] PASS (negative): trigger_run absent — VIEWER cannot trigger runs.');
  process.exit(0);
}

// ── Positive check ────────────────────────────────────────────────────────────
const missing = [...EXPECTED_REPORTING, ...EXPECTED_EXECUTION].filter((t) => !tools.includes(t));
if (missing.length > 0) {
  console.error('[dogfood] FAIL: expected tools missing:', missing);
  process.exit(1);
}
console.log('[dogfood] all expected tools present.');

console.log(`[dogfood] calling trigger_run testId=${TEST_ID} envId=${ENV_ID}`);
const trig = await client.callTool({ name: 'trigger_run', arguments: { testId: TEST_ID, environmentId: ENV_ID } });
console.log('[dogfood] trigger_run raw result:', JSON.stringify(trig));

if (trig.isError) {
  console.error('[dogfood] FAIL: trigger_run returned an error:', trig.content?.[0]?.text ?? trig);
  process.exit(1);
}

// Handle sync result ({ runIds, batchIds }) or task envelope ({ taskId, ... }).
let runIds;
try {
  const parsed = JSON.parse(trig.content[0].text);
  if (Array.isArray(parsed.runIds) && parsed.runIds.length > 0) {
    // Sync path (baseline gate)
    runIds = parsed.runIds;
    console.log('[dogfood] runIds (sync):', runIds);
  } else if (parsed.taskId) {
    // Task path — not expected with current http.ts (task store not wired), but handle gracefully.
    console.log('[dogfood] task result (taskId=%s); falling back to batchId/runIds if present', parsed.taskId);
    if (parsed.runIds?.length) {
      runIds = parsed.runIds;
    } else {
      console.error('[dogfood] FINDING: task path returned no runIds — extra.taskStore not wired in http.ts');
      process.exit(1);
    }
  } else {
    throw new Error('unexpected shape: ' + JSON.stringify(parsed));
  }
} catch (e) {
  console.error('[dogfood] FAIL: could not parse trigger_run response:', e.message, trig.content);
  process.exit(1);
}

const TERMINAL = new Set(['PASSED', 'FAILED', 'ERROR', 'CANCELLED']);
const deadline = Date.now() + 120_000;
console.log('[dogfood] polling run', runIds[0], '(timeout 120s)');

for (;;) {
  const r = await client.callTool({ name: 'get_run', arguments: { runId: runIds[0] } });
  if (r.isError) {
    console.error('[dogfood] get_run error:', r.content?.[0]?.text);
    process.exit(1);
  }
  const run = JSON.parse(r.content[0].text);
  console.log('[dogfood] status:', run.status);
  if (TERMINAL.has(run.status)) {
    console.log('[dogfood] PASS: run reached terminal status', run.status);
    process.exit(0);
  }
  if (Date.now() > deadline) {
    console.error('[dogfood] FAIL: timed out after 120s, last status:', run.status);
    process.exit(1);
  }
  await new Promise((res) => setTimeout(res, 3000));
}
