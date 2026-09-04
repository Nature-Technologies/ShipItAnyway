import { Queue, Worker } from 'bullmq';
import redis from '../redis';

export const ciDeliveryQueue = new Queue('ci-delivery', { connection: redis });

export async function enqueueCiDelivery(correlationId: string): Promise<void> {
  await ciDeliveryQueue.add(
    'deliver',
    { correlationId },
    { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 }
  );
}

let worker: Worker | null = null;

export function startCiDeliveryWorker(): void {
  worker = new Worker(
    'ci-delivery',
    async (job) => {
      const { deliverCiStatus } = await import('../services/ci-delivery');
      await deliverCiStatus(job.data.correlationId as string);
    },
    { connection: redis }
  );
  worker.on('failed', async (job, err) => {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const prisma = (await import('../prisma')).default;
      await prisma.ciDelivery
        .update({ where: { correlationId: job.data.correlationId as string }, data: { state: 'FAILED', lastError: err.message } })
        .catch(() => undefined);
    }
  });
}

export async function stopCiDeliveryWorker(): Promise<void> {
  await worker?.close();
  worker = null;
}
