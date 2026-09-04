import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ToolDef = { handler: (args: Record<string, unknown>) => Promise<CallToolResult> };
export type ToolRecord = Record<string, ToolDef>;

export function textContent(payload: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
