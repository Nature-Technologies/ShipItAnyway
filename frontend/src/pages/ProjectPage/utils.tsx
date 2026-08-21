import { Button, Typography } from 'antd';
import type {
  Environment,
  NotificationChannel,
  ProjectCheck,
  Schedule
} from '../../types';
import { getProjectDefaultDeviceOptions } from '../../utils/projectSettings';

const { Text } = Typography;

export type ProjectTabKey =
  | 'overview'
  | 'checks'
  | 'runs'
  | 'schedules'
  | 'environments'
  | 'alerts'
  | 'settings'
  | 'members';
export type EntityMode = 'create' | 'edit';

export type EnvironmentRowState = { id: string; key: string; value: string };

export type ChannelFormState = {
  name: string;
  botToken: string;
  chatId: string;
  webhookUrl: string;
  onFailed: boolean;
  onRecovered: boolean;
  onPassed: boolean;
  enabled: boolean;
};

export type ChannelRuleKey = 'onFailed' | 'onRecovered' | 'onPassed';

export const DEFAULT_DEVICE_OPTIONS = getProjectDefaultDeviceOptions();
export const RECENT_RESULTS_GRID_COLUMNS = 'minmax(220px, 1.4fr) 160px minmax(180px, 1fr) 120px';

export function formatCreatedLabel(value: string) {
  return `Created ${new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}`;
}

export function formatShortTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatRelativeTime(value: string | null) {
  if (!value) return 'Never';

  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 60_000) return 'just now';

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return new Date(value).toLocaleDateString();
}

export function formatDuration(ms?: number | null) {
  if (typeof ms !== 'number') return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDurationLabel(ms?: number | null) {
  if (typeof ms !== 'number') return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatCompactDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatDateOnly(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function resolveInitialEnvironmentId(environments: Environment[]) {
  return environments.find((environment) => environment.name.toUpperCase() === 'DEV')?.id ?? environments[0]?.id ?? '';
}

export function createEnvRow(key = '', value = ''): EnvironmentRowState {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    key,
    value
  };
}

export function isSecretKey(key: string) {
  return /password|token|secret|api_key|key/i.test(key);
}

export function isEmptyEnvRow(row: EnvironmentRowState) {
  return !row.key.trim() && !row.value.trim();
}

export function envRowsFromRecord(variables: Record<string, string>): EnvironmentRowState[] {
  const entries = Object.entries(variables);
  return entries.length > 0 ? entries.map(([key, value]) => createEnvRow(key, value)) : [createEnvRow()];
}

export function envRecordFromRows(rows: EnvironmentRowState[]) {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim() && row.value.trim())
      .map((row) => [row.key.trim(), row.value.trim()])
  );
}

export function validateEnvironmentRows(name: string, rows: EnvironmentRowState[]) {
  if (!name.trim()) return 'Environment name is required';

  const seen = new Set<string>();
  for (const row of rows) {
    if (isEmptyEnvRow(row)) continue;

    const key = row.key.trim();
    const value = row.value.trim();
    if (!key) return 'Variable name is required';
    if (!value) return 'Variable value is required';
    if (!/^[A-Z0-9_]+$/.test(key)) return 'Variable names should use uppercase letters, numbers, and underscores';
    if (seen.has(key)) return `Variable name "${key}" must be unique`;
    seen.add(key);
  }

  return null;
}

function extractVariableNames(value: string | null | undefined) {
  if (!value) return [];
  const names: string[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function collectCheckVariables(check: ProjectCheck) {
  const names = new Set<string>();
  extractVariableNames(check.url).forEach((name) => names.add(name));
  check.steps.forEach((step) => {
    extractVariableNames(step.selector).forEach((name) => names.add(name));
    extractVariableNames(step.value).forEach((name) => names.add(name));
    extractVariableNames(step.expected).forEach((name) => names.add(name));
  });
  return names;
}

export function countEnvironmentUsage(environment: Environment, checks: ProjectCheck[]) {
  const keys = Object.keys(environment.variables);
  if (keys.length === 0) return 0;
  return checks.filter((check) => {
    const names = collectCheckVariables(check);
    return keys.some((key) => names.has(key));
  }).length;
}

export function formatAlertRules(channel: NotificationChannel) {
  const rules: string[] = [];
  if (channel.onFailed) rules.push('Failed');
  if (channel.onRecovered) rules.push('Recovered');
  if (channel.onPassed) rules.push('Passed');
  if (rules.length === 0) rules.push('No rules');
  return rules;
}

export function channelRuleDescriptions() {
  return [
    {
      key: 'onFailed' as ChannelRuleKey,
      label: 'Failed runs',
      helper: 'Send a notification when a check fails.'
    },
    {
      key: 'onRecovered' as ChannelRuleKey,
      label: 'Recovered runs',
      helper: 'Send a notification when a previously failing check passes again.'
    },
    {
      key: 'onPassed' as ChannelRuleKey,
      label: 'Passed runs',
      helper: 'Send a notification on every successful run.'
    }
  ];
}

export function formatScheduleNextRun(schedule: Schedule) {
  if (!schedule.enabled) return { primary: 'Paused', secondary: '', overdue: false };
  if (!schedule.nextRunAt) return { primary: '—', secondary: '', overdue: false };

  const nextRunAt = new Date(schedule.nextRunAt).getTime();
  if (nextRunAt <= Date.now()) {
    return {
      primary: formatCompactDateTime(schedule.nextRunAt),
      secondary: '',
      overdue: true
    };
  }

  const diffMs = nextRunAt - Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const relative =
    diffMs < hour
      ? `in ${Math.round(diffMs / minute)} min`
      : diffMs < day
        ? `in ${Math.round(diffMs / hour)} hour${Math.round(diffMs / hour) === 1 ? '' : 's'}`
        : `in ${Math.round(diffMs / day)} day${Math.round(diffMs / day) === 1 ? '' : 's'}`;
  return {
    primary: relative,
    secondary: formatCompactDateTime(schedule.nextRunAt),
    overdue: false
  };
}

function getFirstEnabledDataCaseIndex(test?: ProjectCheck | null) {
  if (!test || test.testData.length === 0) return undefined;

  const index = test.testData.findIndex((dataCase) => dataCase.enabled);
  return index >= 0 ? index : null;
}

function getEnabledDataCaseCount(test?: ProjectCheck | null) {
  return test?.testData.filter((dataCase) => dataCase.enabled).length ?? 0;
}

export { getFirstEnabledDataCaseIndex, getEnabledDataCaseCount };

function collectEffectiveSchedules(check: ProjectCheck, schedules: Schedule[] = []) {
  const effectiveSchedules = new Map<string, ProjectCheck['schedules'][number]>();

  for (const schedule of check.schedules) {
    effectiveSchedules.set(schedule.id, schedule);
  }

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const suiteMatches = Array.isArray(schedule.suite?.testIds) && schedule.suite.testIds.includes(check.id);
    const directMatch = schedule.testId === check.id;
    if (!suiteMatches && !directMatch) continue;

    effectiveSchedules.set(schedule.id, {
      id: schedule.id,
      name: schedule.name,
      cron: schedule.cron,
      enabled: schedule.enabled
    });
  }

  return Array.from(effectiveSchedules.values()).filter((schedule) => schedule.enabled);
}

export function formatScheduleSummary(check: ProjectCheck, schedules: Schedule[] = []) {
  const activeSchedules = collectEffectiveSchedules(check, schedules);
  if (activeSchedules.length === 0) return 'Not scheduled';
  if (activeSchedules.length > 1) return `${activeSchedules.length} active`;
  return humanizeCron(activeSchedules[0]?.cron ?? 'Not scheduled');
}

export function renderRecentResultCell(check: ProjectCheck, onOpenCheck: (id: string) => void) {
  return (
    <div style={{ minWidth: 0, textAlign: 'left' }}>
      <Button
        type="link"
        style={{
          display: 'block',
          width: '100%',
          padding: 0,
          textAlign: 'left',
          fontWeight: 600,
          height: 'auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        onClick={() => onOpenCheck(check.id)}
      >
        {check.name}
      </Button>
      <Text
        type="secondary"
        style={{
          display: 'block',
          fontSize: 12,
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {check.url}
      </Text>
    </div>
  );
}

export function humanizeCron(cron: string) {
  const presets: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/15 * * * *': 'Every 15 min',
    '0 * * * *': 'Hourly',
    '0 2 * * *': 'Daily 2am',
    '0 9 * * *': 'Daily 9am',
    '0 9 * * 1': 'Every Monday'
  };

  return presets[cron] ?? cron;
}

export function resolveTabFromPathname(pathname: string): ProjectTabKey {
  if (pathname.endsWith('/overview')) return 'overview';
  if (pathname.endsWith('/runs')) return 'runs';
  if (pathname.endsWith('/schedules')) return 'schedules';
  if (pathname.endsWith('/environments')) return 'environments';
  if (pathname.endsWith('/alerts') || pathname.endsWith('/notifications')) return 'alerts';
  if (pathname.endsWith('/settings')) return 'settings';
  if (pathname.endsWith('/members')) return 'members';
  return 'checks';
}
