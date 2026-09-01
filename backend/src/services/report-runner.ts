import type { Prisma, ReportSend } from '@prisma/client';
import prisma from '../prisma';
import { summarize, flakyChecks } from './run-stats';
import { sendReportEmail, type ReportDigest } from './mailer';

export async function runReport(
  reportConfigId: string,
  opts: { trigger: 'SCHEDULED' | 'MANUAL'; overrideRecipients?: string[]; forceSend?: boolean }
): Promise<ReportSend | null> {
  const config = await prisma.reportConfig.findUnique({
    where: { id: reportConfigId },
    include: { project: true, environment: true }
  });
  if (!config || !config.enabled) return null;

  const windowStart = config.lastSentAt ?? config.createdAt;
  const windowEnd = new Date();
  const checkIds = (config.checkIds as string[]) ?? [];
  const recipients = opts.overrideRecipients ?? ((config.recipients as string[]) ?? []);
  const isPreview = opts.forceSend === true;

  const where: Prisma.TestRunWhereInput = {
    environmentId: config.environmentId,
    startedAt: { gt: windowStart, lte: windowEnd },
    status: { in: ['PASSED', 'FAILED'] },
    ...(checkIds.length > 0 ? { testId: { in: checkIds } } : {})
  };

  const runs = await prisma.testRun.findMany({
    where,
    select: { status: true, durationMs: true, error: true, testId: true, test: { select: { name: true } } }
  });

  // Empty window: scheduled/send-now skip (log SKIPPED_EMPTY, keep window open);
  // preview forces a render but writes no row and does not advance the cursor.
  if (runs.length === 0 && !isPreview) {
    return prisma.reportSend.create({
      data: {
        reportConfigId: config.id, status: 'SKIPPED_EMPTY', trigger: opts.trigger,
        windowStart, windowEnd, recipients, runCount: 0, passed: 0, failed: 0, passRate: 0
      }
    });
  }

  const stats = summarize(runs);
  const failures = runs
    .filter((r) => r.status === 'FAILED')
    .map((r) => ({ checkName: r.test.name, error: r.error }));
  const flaky = flakyChecks(runs.map((r) => ({ testId: r.testId, testName: r.test.name, status: r.status })))
    .map((f) => ({ checkName: f.testName, passRate: f.passRate }));

  const digest: ReportDigest = {
    projectName: config.project.name, environmentName: config.environment.name, reportName: config.name,
    windowStart, windowEnd, total: stats.total, passed: stats.passed, failed: stats.failed,
    passRate: stats.passRate, avgDurationMs: stats.avgDurationMs, failures, flaky
  };

  let error: string | null = null;
  try {
    for (const to of recipients) await sendReportEmail(to, digest);
  } catch (e) {
    error = e instanceof Error ? e.message : 'send failed';
  }

  if (isPreview) return null; // throwaway: no audit row, no cursor advance

  if (!error) {
    await prisma.reportConfig.update({ where: { id: config.id }, data: { lastSentAt: windowEnd } });
  }

  return prisma.reportSend.create({
    data: {
      reportConfigId: config.id, status: error ? 'FAILED' : 'SENT', trigger: opts.trigger,
      windowStart, windowEnd, recipients, runCount: stats.total, passed: stats.passed,
      failed: stats.failed, passRate: stats.passRate, avgDurationMs: stats.avgDurationMs, error
    }
  });
}

export function sendReport(reportConfigId: string): Promise<ReportSend | null> {
  return runReport(reportConfigId, { trigger: 'SCHEDULED' });
}
