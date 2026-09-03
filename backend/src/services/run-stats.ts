import type { RunStatus } from '@prisma/client';

export type RunStat = { status: RunStatus; durationMs: number | null };

export function summarize(runs: RunStat[]) {
  const total = runs.length;
  const passed = runs.filter((r) => r.status === 'PASSED').length;
  const failed = runs.filter((r) => r.status === 'FAILED').length;
  const durations = runs.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
    : null;
  return { total, passed, failed, passRate: total ? Math.round((passed / total) * 100) : 0, avgDurationMs };
}

export type FlakyInput = { testId: string; testName: string; status: RunStatus };

export function flakyChecks(runs: FlakyInput[], limit = 10) {
  const grouped = new Map<string, { testName: string; passed: number; failed: number; total: number }>();
  for (const r of runs) {
    const g = grouped.get(r.testId) ?? { testName: r.testName, passed: 0, failed: 0, total: 0 };
    g.total += 1;
    if (r.status === 'PASSED') g.passed += 1;
    if (r.status === 'FAILED') g.failed += 1;
    grouped.set(r.testId, g);
  }
  return [...grouped.entries()]
    .filter(([, g]) => g.passed > 0 && g.failed > 0)
    .map(([testId, g]) => ({
      testId, testName: g.testName, totalRuns: g.total, passed: g.passed, failed: g.failed,
      passRate: g.total ? Math.round((g.passed / g.total) * 100) : 0
    }))
    .sort((a, b) => b.totalRuns - a.totalRuns)
    .slice(0, limit);
}
