import { Queue, Worker } from 'bullmq';
import redis from '../redis';
import { fireSchedule } from '../services/schedule-runner';

export const scheduleQueue = new Queue('schedule-fires', { connection: redis });

let scheduleWorker: Worker | null = null;

export function startScheduleWorker(): void {
  scheduleWorker = new Worker(
    'schedule-fires',
    async (job) => { await fireSchedule(job.data.scheduleId as string); },
    { connection: redis }
  );
  scheduleWorker.on('failed', (job, err) =>
    console.error(`[ScheduleWorker] job ${job?.id} (scheduleId=${job?.data?.scheduleId}) failed:`, err)
  );
}

export async function stopScheduleWorker(): Promise<void> {
  await scheduleWorker?.close();
  scheduleWorker = null;
}
