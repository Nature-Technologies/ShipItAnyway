import prisma from '../prisma';
import { enqueueCiDelivery } from '../queue/ci-delivery-queue';

const DEFAULT_CUTOFF_MS = 30 * 60 * 1000;

export async function reconcileStuckCiRuns(olderThanMs = DEFAULT_CUTOFF_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await prisma.testRun.findMany({
    where: {
      ciCorrelationId: { not: null },
      status: { in: ['PENDING', 'RUNNING'] },
      startedAt: { lt: cutoff }
    },
    select: { id: true, ciCorrelationId: true }
  });
  if (stuck.length === 0) return 0;

  await prisma.testRun.updateMany({
    where: { id: { in: stuck.map((r) => r.id) } },
    data: { status: 'FAILED', finishedAt: new Date(), error: 'Run reconciled: timed out without completing.' }
  });

  const correlationIds = [...new Set(stuck.map((r) => r.ciCorrelationId!).filter(Boolean))];
  for (const correlationId of correlationIds) await enqueueCiDelivery(correlationId);
  return correlationIds.length;
}
