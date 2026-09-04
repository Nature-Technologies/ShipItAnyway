import type { SiaClient } from '../client.js';
import { textContent, type ToolRecord } from '../tooling.js';

export function reportingTools(client: SiaClient): ToolRecord {
  return {
    list_projects: { handler: async () => textContent(await client.listProjects()) },
    list_runs: {
      handler: async (args) => {
        const { projectId, ...q } = args as { projectId: string } & Record<string, string | undefined>;
        return textContent(await client.listRuns(projectId, q));
      }
    },
    get_run: { handler: async (args) => textContent(await client.getRun(args.runId as string)) },
    get_run_batch: { handler: async (args) => textContent(await client.getRunBatch(args.batchId as string)) }
  };
}
