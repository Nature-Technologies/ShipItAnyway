export function resolveScheduleTimezone(schedule: { timezone?: string | null }): string {
  return schedule.timezone ?? 'UTC';
}

export const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
