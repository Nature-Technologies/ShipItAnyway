import type { RunTrigger } from '@prisma/client';
import prisma from '../prisma';
import { enqueueTestRun } from '../queue/batch-sequencer';
import {
  buildDataCaseSnapshot, DATA_DRIVEN_CASE_REQUIRED_ERROR,
  getTestDataCases, hasTestDataCases
} from '../utils/test-data';

export type CiMeta = {
  repo: string; sha: string; ref?: string; prNumber?: number; runUrl?: string; correlationId: string;
};
export type Selection = {
  suiteId?: string; testId?: string; environmentId?: string;
  trigger: RunTrigger; scheduleId?: string; ci?: CiMeta;
};

function ciFields(ci?: CiMeta) {
  if (!ci) return {};
  return {
    ciRepo: ci.repo, ciSha: ci.sha, ciRef: ci.ref ?? null,
    ciPrNumber: ci.prNumber ?? null, ciRunUrl: ci.runUrl ?? null,
    ciCorrelationId: ci.correlationId
  };
}

export async function createRunsForSelection(sel: Selection): Promise<{ runIds: string[]; batchIds: string[] }> {
  const testIds: string[] = [];
  if (sel.suiteId) {
    const suite = await prisma.suite.findUnique({ where: { id: sel.suiteId } });
    if (suite) testIds.push(...((suite.testIds as string[]) ?? []));
  } else if (sel.testId) {
    testIds.push(sel.testId);
  }

  const runIds: string[] = [];
  const batchIds: string[] = [];
  const base = {
    environmentId: sel.environmentId ?? undefined,
    scheduleId: sel.scheduleId ?? undefined,
    trigger: sel.trigger,
    ...ciFields(sel.ci)
  };

  for (const testId of testIds) {
    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test) continue;

    if (hasTestDataCases(test.testData)) {
      const enabledCases = getTestDataCases(test.testData)
        .map((testCase, dataCaseIndex) => ({ testCase, dataCaseIndex }))
        .filter(({ testCase }) => testCase.enabled);

      if (enabledCases.length === 0) {
        const run = await prisma.testRun.create({
          data: { ...base, testId, status: 'FAILED', finishedAt: new Date(), durationMs: 0, error: DATA_DRIVEN_CASE_REQUIRED_ERROR }
        });
        runIds.push(run.id);
        continue;
      }

      const { batch, runs } = await prisma.$transaction(async (tx) => {
        const batch = await tx.testRunBatch.create({
          data: { testId, environmentId: sel.environmentId ?? undefined, totalCases: enabledCases.length, status: 'PENDING' }
        });
        const runs = [];
        for (const [batchOrder, { dataCaseIndex }] of enabledCases.entries()) {
          const dataCaseSnapshot = buildDataCaseSnapshot(test.testData, dataCaseIndex);
          const run = await tx.testRun.create({
            data: { ...base, testId, status: 'PENDING', batchId: batch.id, batchOrder, ...dataCaseSnapshot }
          });
          runs.push(run);
        }
        return { batch, runs };
      });

      await enqueueTestRun(runs[0]!);
      for (const run of runs) runIds.push(run.id);
      batchIds.push(batch.id);
      continue;
    }

    const run = await prisma.testRun.create({ data: { ...base, testId, status: 'PENDING' } });
    await enqueueTestRun(run);
    runIds.push(run.id);
  }

  return { runIds, batchIds };
}
