import type { SiaClient } from '../client.js';
import { textContent, type ToolRecord } from '../tooling.js';

export function executionTools(client: SiaClient): ToolRecord {
  return {
    trigger_run: {
      handler: async (args) => {
        const { testId, suiteId, environmentId } = args as { testId?: string; suiteId?: string; environmentId: string };
        return textContent(await client.triggerRun({ testId, suiteId, environmentId }));
      }
    }
  };
}
