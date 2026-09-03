import prisma from '../prisma';
import { postCommitStatus, type CommitStatusState } from './github';
import { enqueueCiDelivery } from '../queue/ci-delivery-queue';

const TERMINAL = ['PASSED', 'FAILED'] as const;

export async function computeCorrelationState(correlationId: string): Promise<CommitStatusState> {
  const runs = await prisma.testRun.findMany({
    where: { ciCorrelationId: correlationId },
    select: { status: true }
  });
  if (runs.length === 0) return 'pending';
  if (runs.some((r) => !TERMINAL.includes(r.status as any))) return 'pending';
  return runs.some((r) => r.status === 'FAILED') ? 'failure' : 'success';
}

export async function deliverCiStatus(correlationId: string): Promise<void> {
  const delivery = await prisma.ciDelivery.findUnique({ where: { correlationId } });
  if (!delivery) return;

  const state = await computeCorrelationState(correlationId);
  const project = await prisma.project.findUnique({
    where: { id: delivery.projectId },
    select: { ghPat: true }
  });

  await prisma.ciDelivery.update({
    where: { correlationId },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date() }
  });

  if (!project?.ghPat) {
    const msg = `No GitHub PAT configured for repo ${delivery.repo}`;
    await prisma.ciDelivery.update({ where: { correlationId }, data: { lastError: msg } });
    throw new Error(msg);
  }

  try {
    await postCommitStatus({
      repo: delivery.repo, sha: delivery.sha, pat: project.ghPat,
      state, context: delivery.context, targetUrl: delivery.targetUrl ?? undefined,
      description: `ShipItAnyway: ${state}`
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await prisma.ciDelivery.update({ where: { correlationId }, data: { lastError: msg } });
    throw error;
  }

  await prisma.ciDelivery.update({
    where: { correlationId },
    data: { state: state === 'pending' ? 'PENDING' : 'DELIVERED', lastError: null }
  });
}

export { enqueueCiDelivery };

export async function maybeEnqueueCiDelivery(testRunId: string): Promise<void> {
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    select: { ciCorrelationId: true }
  });
  if (!run?.ciCorrelationId) return;
  const state = await computeCorrelationState(run.ciCorrelationId);
  if (state === 'pending') return;
  await enqueueCiDelivery(run.ciCorrelationId);
}
