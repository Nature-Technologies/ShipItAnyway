import { Queue, Worker } from 'bullmq';
import redis from '../redis';
import { sendReport } from '../services/report-runner';

export const reportQueue = new Queue('report-fires', { connection: redis });

let reportWorker: Worker | null = null;

export function startReportWorker(): void {
  reportWorker = new Worker(
    'report-fires',
    async (job) => { await sendReport(job.data.reportConfigId as string); },
    { connection: redis }
  );
  reportWorker.on('failed', (job, err) =>
    console.error(`[ReportWorker] job ${job?.id} (reportConfigId=${job?.data?.reportConfigId}) failed:`, err)
  );
}

export async function stopReportWorker(): Promise<void> {
  await reportWorker?.close();
  reportWorker = null;
}
