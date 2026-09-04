import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SiaClient } from './client.js';

type RunLike = { status: string };
const TERMINAL = new Set(['PASSED', 'FAILED', 'ERROR', 'CANCELLED']);

// ponytail: global Map — fine for single-process; swap for Redis/DB if multi-instance ever matters
const taskRunIds = new Map<string, string[]>();

export function mapRunsToTaskStatus(runs: RunLike[]): 'working' | 'completed' {
  if (runs.length === 0) return 'working';
  return runs.every((r) => TERMINAL.has(r.status)) ? 'completed' : 'working';
}

export function registerTriggerTask(server: McpServer, client: SiaClient): void {
  // NOTE: CreateTaskOptions has no `metadata` field in the installed SDK version.
  // RunIds are stashed in the module-level Map keyed by taskId instead.
  server.experimental.tasks.registerToolTask(
    'trigger_run',
    {
      description: 'Trigger a SIA run (test or suite) and track it as a task until it finishes.',
      inputSchema: {
        testId: z.string().optional(),
        suiteId: z.string().optional(),
        environmentId: z.string(),
      },
      execution: { taskSupport: 'optional' },
    },
    {
      createTask: async (args, extra) => {
        const { runIds } = await client.triggerRun(args);
        const task = await extra.taskStore.createTask({ ttl: 30 * 60 * 1000 });
        taskRunIds.set(task.taskId, runIds);
        return { task };
      },
      getTask: async (_args, extra) => {
        const runIds = taskRunIds.get(extra.taskId) ?? [];
        const runs = await Promise.all(runIds.map((id) => client.getRun(id) as Promise<RunLike>));
        const status = mapRunsToTaskStatus(runs);
        const task = await extra.taskStore.getTask(extra.taskId);
        return { ...task, status };
      },
      getTaskResult: async (_args, extra) => {
        const runIds = taskRunIds.get(extra.taskId) ?? [];
        const runs = await Promise.all(runIds.map((id) => client.getRun(id)));
        return { content: [{ type: 'text' as const, text: JSON.stringify({ runIds, runs }) }] };
      },
    }
  );
}
