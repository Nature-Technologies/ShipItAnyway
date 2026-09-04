import type { RunTrigger } from '@prisma/client';
import prisma from '../prisma';
import { createRunsForSelection } from './run-selection';

export async function fireSchedule(
  scheduleId: string,
  opts?: { trigger?: RunTrigger }
): Promise<{ runIds: string[]; batchId?: string }> {
  const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new Error('Schedule not found');

  const { runIds, batchIds } = await createRunsForSelection({
    suiteId: schedule.suiteId ?? undefined,
    testId: schedule.testId ?? undefined,
    environmentId: schedule.environmentId ?? undefined,
    trigger: opts?.trigger ?? 'SCHEDULE',
    scheduleId: schedule.id
  });

  await prisma.schedule.update({ where: { id: scheduleId }, data: { lastRunAt: new Date() } });
  return { runIds, batchId: batchIds[0] };
}
