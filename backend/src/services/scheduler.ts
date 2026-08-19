import cron from 'node-cron';
import type { Schedule } from '@prisma/client';
import prisma from '../prisma';
import { fireSchedule } from './schedule-runner';

class SchedulerService {
  private tasks = new Map<string, ReturnType<typeof cron.schedule>>();

  register(schedule: Schedule) {
    this.unregister(schedule.id);

    if (!schedule.enabled) return;
    if (!cron.validate(schedule.cron)) return;

    const task = cron.schedule(schedule.cron, async () => {
      console.log(`[Scheduler] Running schedule "${schedule.name}"`);
      try {
        const { runIds } = await fireSchedule(schedule.id);
        console.log(`[Scheduler] Schedule "${schedule.name}" queued ${runIds.length} tests`);
      } catch (error) {
        console.error(`[Scheduler] Error in schedule "${schedule.name}":`, error);
      }
    });

    this.tasks.set(schedule.id, task);
    console.log(`[Scheduler] Registered "${schedule.name}" → ${schedule.cron}`);
  }

  unregister(scheduleId: string) {
    const task = this.tasks.get(scheduleId);
    if (!task) return;

    task.stop();
    this.tasks.delete(scheduleId);
  }

  stopAll() {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }

  async loadAll() {
    const schedules = await prisma.schedule.findMany({
      where: { enabled: true }
    });

    for (const schedule of schedules) {
      this.register(schedule);
    }

    console.log(`[Scheduler] Loaded ${schedules.length} schedules`);
  }
}

export const schedulerService = new SchedulerService();
