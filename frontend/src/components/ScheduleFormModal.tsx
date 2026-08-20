import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, Modal, Radio, Select, Space, Typography, message } from 'antd';
import type { Environment, Schedule, Suite, Test } from '../types';

const { Text } = Typography;

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day 9am', value: '0 9 * * *' },
  { label: 'Every day 2am', value: '0 2 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
  { label: 'Custom...', value: 'custom' }
];

export function describeCron(cron: string) {
  const map: Record<string, string> = {
    '* * * * *': 'Runs every minute',
    '*/15 * * * *': 'Runs every 15 minutes',
    '0 * * * *': 'Runs every hour',
    '0 2 * * *': 'Runs every day at 02:00',
    '0 9 * * *': 'Runs every day at 09:00',
    '0 9 * * 1': 'Runs every Monday at 09:00'
  };
  if (map[cron]) return map[cron];
  const dailyMatch = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const hour = String(Number(dailyMatch[2])).padStart(2, '0');
    const minute = String(Number(dailyMatch[1])).padStart(2, '0');
    return `Runs every day at ${hour}:${minute}`;
  }
  return 'Custom cron schedule';
}

function usesVariables(value?: string | null) {
  return Boolean(value && /{{\s*[\w.-]+\s*}}/.test(value));
}

function testUsesVariables(test?: Test | null) {
  if (!test) return false;
  if (usesVariables(test.url)) return true;
  return test.steps.some((step) => usesVariables(step.selector) || usesVariables(step.value) || usesVariables(step.expected));
}

export type SchedulePayload = {
  name: string;
  cron: string;
  suiteId: string | null;
  testId: string | null;
  environmentId: string | null;
  enabled: boolean;
  timezone: string;
};

type ScheduleFormModalProps = {
  open: boolean;
  mode: 'create' | 'edit';
  schedule?: Schedule | null;
  suites: Suite[];
  checks: Test[];
  environments: Environment[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (payload: SchedulePayload) => void;
};

export function ScheduleFormModal({ open, mode, schedule, suites, checks, environments, saving, onCancel, onSubmit }: ScheduleFormModalProps) {
  const [name, setName] = useState('');
  const [cronPreset, setCronPreset] = useState('0 2 * * *');
  const [customCron, setCustomCron] = useState('0 2 * * *');
  const [targetType, setTargetType] = useState<'suite' | 'test'>('suite');
  const [suiteId, setSuiteId] = useState<string | undefined>(undefined);
  const [testId, setTestId] = useState<string | undefined>(undefined);
  const [environmentId, setEnvironmentId] = useState<string | undefined>(undefined);
  const [enabled, setEnabled] = useState(true);
  const [timezone, setTimezone] = useState('UTC');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && schedule) {
      const preset = CRON_PRESETS.some((p) => p.value === schedule.cron) ? schedule.cron : 'custom';
      setName(schedule.name);
      setCronPreset(preset);
      setCustomCron(schedule.cron);
      setTargetType(schedule.suiteId ? 'suite' : 'test');
      setSuiteId(schedule.suiteId ?? undefined);
      setTestId(schedule.testId ?? undefined);
      setEnvironmentId(schedule.environmentId ?? undefined);
      setEnabled(schedule.enabled);
      setTimezone(schedule.timezone ?? 'UTC');
    } else if (mode === 'create' && schedule) {
      // duplicate: prefill from source schedule
      const preset = CRON_PRESETS.some((p) => p.value === schedule.cron) ? schedule.cron : 'custom';
      setName(`${schedule.name} Copy`);
      setCronPreset(preset);
      setCustomCron(schedule.cron);
      setTargetType(schedule.suiteId ? 'suite' : 'test');
      setSuiteId(schedule.suiteId ?? undefined);
      setTestId(schedule.testId ?? undefined);
      setEnvironmentId(schedule.environmentId ?? undefined);
      setEnabled(true);
      setTimezone(schedule.timezone ?? 'UTC');
    } else {
      // create from scratch
      setName('');
      setCronPreset('0 2 * * *');
      setCustomCron('0 2 * * *');
      setTargetType(suites.length > 0 ? 'suite' : 'test');
      setSuiteId(suites[0]?.id);
      setTestId(checks[0]?.id);
      setEnvironmentId(undefined);
      setEnabled(true);
      setTimezone('UTC');
    }
  }, [open, mode, schedule]);

  const cron = cronPreset === 'custom' ? customCron.trim() : cronPreset;

  const targetSuite = useMemo(() => suites.find((s) => s.id === suiteId), [suites, suiteId]);
  const targetCheck = useMemo(() => checks.find((c) => c.id === testId), [checks, testId]);

  const needsEnvironment = useMemo(() => {
    if (targetType === 'suite') {
      if (!targetSuite) return false;
      return targetSuite.testIds.some((tid) => testUsesVariables(checks.find((c) => c.id === tid)));
    }
    return testUsesVariables(targetCheck);
  }, [targetType, targetSuite, targetCheck, checks]);

  const requiresEnvironment = needsEnvironment && !environmentId;

  const handleOk = () => {
    if (!name.trim()) {
      message.error('Schedule name is required');
      return;
    }
    if (!cron.trim()) {
      message.error('Cron is required');
      return;
    }
    const targetSuiteId = targetType === 'suite' ? (suiteId ?? null) : null;
    const targetTestId = targetType === 'test' ? (testId ?? null) : null;
    if (!targetSuiteId && !targetTestId) {
      message.error('Select a suite or a check');
      return;
    }
    if (requiresEnvironment) {
      message.error('Select an environment for checks that use variables');
      return;
    }
    onSubmit({
      name: name.trim(),
      cron: cron.trim(),
      suiteId: targetSuiteId,
      testId: targetTestId,
      environmentId: environmentId ?? null,
      enabled,
      timezone
    });
  };

  return (
    <Modal
      title={mode === 'edit' ? `Edit Schedule: ${schedule?.name ?? ''}` : 'New Schedule'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving}
      width={760}
      centered
      style={{ top: 24 }}
      styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
      okText={mode === 'edit' ? 'Save changes' : 'Create schedule'}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">Schedule name</Text>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly smoke"
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <Text type="secondary">Cron preset</Text>
          <Select
            value={cronPreset}
            onChange={(value) => {
              setCronPreset(value);
              if (value !== 'custom') setCustomCron(value);
            }}
            style={{ width: '100%', marginTop: 8 }}
            options={CRON_PRESETS}
          />
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fafafa', border: '1px solid #f0f0f0' }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              Cron expression
            </Text>
            <Text strong style={{ display: 'block', fontFamily: 'monospace' }}>
              {cron || '—'}
            </Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
              {describeCron(cron)} {cron ? timezone : ''}
            </Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              Timezone
            </Text>
            <Select
              showSearch
              style={{ width: '100%', marginTop: 4 }}
              value={timezone}
              onChange={setTimezone}
              options={Intl.supportedValuesOf('timeZone').map((tz) => ({ value: tz, label: tz }))}
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </div>
        </div>

        {cronPreset === 'custom' && (
          <div>
            <Text type="secondary">Custom cron</Text>
            <Input
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="0 9 * * *"
              style={{ marginTop: 8 }}
            />
          </div>
        )}

        <div>
          <Text type="secondary">Target</Text>
          <Radio.Group
            style={{ display: 'flex', gap: 12, marginTop: 8 }}
            value={targetType}
            onChange={(e) => {
              const next = e.target.value as 'suite' | 'test';
              setTargetType(next);
              if (next === 'suite') setSuiteId((prev) => prev ?? suites[0]?.id);
              else setTestId((prev) => prev ?? checks[0]?.id);
            }}
          >
            <Radio value="suite">Suite</Radio>
            <Radio value="test">Check</Radio>
          </Radio.Group>
        </div>

        {targetType === 'suite' ? (
          <div>
            <Text type="secondary">Suite</Text>
            <Select
              value={suiteId}
              onChange={setSuiteId}
              style={{ width: '100%', marginTop: 8 }}
              placeholder="Select a suite"
              options={suites.map((s) => ({ value: s.id, label: `${s.name} • ${s.testIds.length} checks` }))}
            />
          </div>
        ) : (
          <div>
            <Text type="secondary">Check</Text>
            <Select
              value={testId}
              onChange={setTestId}
              style={{ width: '100%', marginTop: 8 }}
              placeholder="Select a check"
              options={checks.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        )}

        <div>
          <Text type="secondary">Environment</Text>
          <Select
            allowClear
            value={environmentId}
            onChange={(value) => setEnvironmentId(value)}
            style={{ width: '100%', marginTop: 8 }}
            placeholder="No environment"
            options={environments.map((env) => ({
              value: env.id,
              label: `${env.name} • ${Object.keys(env.variables).length} variables`
            }))}
          />
          {requiresEnvironment && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="No environment selected"
              description="Checks using variables like {{BASE_URL}} may fail."
            />
          )}
        </div>

        <div>
          <Text type="secondary">Status</Text>
          <Radio.Group
            style={{ display: 'flex', gap: 12, marginTop: 8 }}
            value={enabled ? 'active' : 'paused'}
            onChange={(e) => setEnabled(e.target.value === 'active')}
          >
            <Radio value="active">Active</Radio>
            <Radio value="paused">Paused</Radio>
          </Radio.Group>
        </div>
      </Space>
    </Modal>
  );
}
