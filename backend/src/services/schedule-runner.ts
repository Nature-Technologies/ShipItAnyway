import type { RunTrigger } from '@prisma/client';
import prisma from '../prisma';
import { enqueueTestRun } from '../queue/batch-sequencer';
import {
  buildDataCaseSnapshot,
  DATA_DRIVEN_CASE_REQUIRED_ERROR,
  getTestDataCases,
  hasTestDataCases
} from '../utils/test-data';

export async function fireSchedule(
  scheduleId: string,
  opts?: { trigger?: RunTrigger }
): Promise<{ runIds: string[]; batchId?: string }> {
  const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new Error('Schedule not found');

  const trigger = opts?.trigger ?? 'SCHEDULE';
  const testIds: string[] = [];

  if (schedule.suiteId) {
    const suite = await prisma.suite.findUnique({ where: { id: schedule.suiteId } });
    if (suite) testIds.push(...((suite.testIds as string[]) ?? []));
  } else if (schedule.testId) {
    testIds.push(schedule.testId);
  }

  const runIds: string[] = [];
  let batchId: string | undefined;

  for (const testId of testIds) {
    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test) continue;

    if (hasTestDataCases(test.testData)) {
      const enabledCases = getTestDataCases(test.testData)
        .map((testCase, dataCaseIndex) => ({ testCase, dataCaseIndex }))
        .filter(({ testCase }) => testCase.enabled);

      if (enabledCases.length === 0) {
        const run = await prisma.testRun.create({
          data: {
            testId,
            status: 'FAILED',
            environmentId: schedule.environmentId ?? undefined,
            scheduleId: schedule.id,
            finishedAt: new Date(),
            durationMs: 0,
            error: DATA_DRIVEN_CASE_REQUIRED_ERROR,
            trigger
          }
        });
        runIds.push(run.id);
        continue;
      }

      const { batch, runs } = await prisma.$transaction(async (tx) => {
        const batch = await tx.testRunBatch.create({
          data: {
            testId,
            environmentId: schedule.environmentId ?? undefined,
            totalCases: enabledCases.length,
            status: 'PENDING'
          }
        });
        const runs = [];
        for (const [batchOrder, { dataCaseIndex }] of enabledCases.entries()) {
          const dataCaseSnapshot = buildDataCaseSnapshot(test.testData, dataCaseIndex);
          const run = await tx.testRun.create({
            data: {
              testId,
              status: 'PENDING',
              environmentId: schedule.environmentId ?? undefined,
              scheduleId: schedule.id,
              trigger,
              batchId: batch.id,
              batchOrder,
              ...dataCaseSnapshot
            }
          });
          runs.push(run);
        }
        return { batch, runs };
      });

      await enqueueTestRun(runs[0]!);
      for (const run of runs) runIds.push(run.id);
      batchId = batch.id;
      continue;
    }

    const run = await prisma.testRun.create({
      data: {
        testId,
        status: 'PENDING',
        environmentId: schedule.environmentId ?? undefined,
        scheduleId: schedule.id,
        trigger
      }
    });
    await enqueueTestRun(run);
    runIds.push(run.id);
  }

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { lastRunAt: new Date() }
  });

  return { runIds, batchId };
}
