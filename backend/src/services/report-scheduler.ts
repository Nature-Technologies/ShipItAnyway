import type { ReportConfig } from '@prisma/client';
import prisma from '../prisma';
import { reportQueue } from '../queue/report-queue';

class ReportSchedulerService {
  async register(config: ReportConfig): Promise<void> {
    if (!config.enabled) { await this.unregister(config.id); return; }
    await reportQueue.upsertJobScheduler(
      config.id,
      { pattern: config.cron, tz: config.timezone ?? 'UTC' },
      // ponytail: bounded fire-job history
      { name: 'fire', data: { reportConfigId: config.id }, opts: { removeOnComplete: true, removeOnFail: 100 } }
    );
  }

  async unregister(id: string): Promise<void> {
    await reportQueue.removeJobScheduler(id).catch(() => undefined);
  }

  // ponytail: no-op — BullMQ schedulers persist in Redis by design; removing on shutdown defeats restart-safety
  stopAll(): void { /* intentional no-op */ }

  async loadAll(): Promise<void> {
    const configs = await prisma.reportConfig.findMany({ where: { enabled: true } });
    for (const c of configs) await this.register(c);
    console.log(`[ReportScheduler] Loaded ${configs.length} report configs`);
  }
}

export const reportScheduler = new ReportSchedulerService();
