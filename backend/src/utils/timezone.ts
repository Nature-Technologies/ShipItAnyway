import { parseExpression } from 'cron-parser';

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getNextRunAt(
  cronExpression: string, referenceDate: Date, timezone?: string | null
): Date | null {
  try {
    return parseExpression(cronExpression, { currentDate: referenceDate, tz: timezone ?? 'UTC' })
      .next().toDate();
  } catch {
    return null;
  }
}
