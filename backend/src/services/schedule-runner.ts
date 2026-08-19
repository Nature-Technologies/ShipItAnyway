import type { RunTrigger } from '@prisma/client';
import prisma from '../prisma';
import { enqueueTestRun } from '../queue/batch-sequencer';
import { DATA_DRIVEN_CASE_REQUIRED_ERROR, hasTestDataCases } from '../utils/test-data';

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

  for (const testId of testIds) {
    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test) continue;

    if (hasTestDataCases(test.testData)) {
      // ponytail: data-driven branch writes FAILED immediately; batch expansion is a later task
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

  return { runIds };
}
