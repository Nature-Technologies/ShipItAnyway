import type { Schedule } from '@prisma/client';
import prisma from '../prisma';
import { scheduleQueue } from '../queue/schedule-queue';

class SchedulerService {
  async register(schedule: Schedule): Promise<void> {
    if (!schedule.enabled) { await this.unregister(schedule.id); return; }
    await scheduleQueue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cron, tz: schedule.timezone ?? 'UTC' },
      { name: 'fire', data: { scheduleId: schedule.id } }
    );
  }

  async unregister(id: string): Promise<void> {
    await scheduleQueue.removeJobScheduler(id).catch(() => undefined);
  }

  // ponytail: no-op — BullMQ schedulers persist in Redis by design; removing on shutdown defeats restart-safety
  stopAll(): void { /* intentional no-op */ }

  async loadAll(): Promise<void> {
    const schedules = await prisma.schedule.findMany({ where: { enabled: true } });
    for (const s of schedules) await this.register(s);
    console.log(`[Scheduler] Loaded ${schedules.length} schedules`);
  }
}

export const schedulerService = new SchedulerService();
