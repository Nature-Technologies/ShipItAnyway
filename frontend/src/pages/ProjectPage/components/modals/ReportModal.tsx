import { useEffect, useMemo, useState } from 'react';
import { Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createReport,
  getUsers,
  updateReport
} from '../../../../api/client';
import { qk } from '../../../../lib/queryKeys';
import { describeCron } from '../../../../components/ScheduleFormModal';
import { useProjectPage } from '../../hooks/useProjectPage';
import type { ReportConfig, ReportConfigPayload } from '../../../../types';

const { Text } = Typography;

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day 9am', value: '0 9 * * *' },
  { label: 'Every day 2am', value: '0 2 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
  { label: 'Custom...', value: 'custom' }
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  report: ReportConfig | null;
  onClose: () => void;
};

export default function ReportModal({ open, mode, report, onClose }: Props) {
  const { projectId, environments, projectChecks } = useProjectPage();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [environmentId, setEnvironmentId] = useState<string | undefined>(undefined);
  const [cronPreset, setCronPreset] = useState('0 9 * * *');
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [checkIds, setCheckIds] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');

  // Best-effort user list for autocomplete; silently fall back on 403
  // ponytail: fetch all users up front; add server-side search when lists outgrow 1000
  const usersQuery = useQuery({
    queryKey: qk.users,
    queryFn: () => getUsers({ limit: 1000 }).then((r) => r.users),
    retry: false,
    throwOnError: false as const
  });
  const knownUsers = usersQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && report) {
      const preset = CRON_PRESETS.some((p) => p.value === report.cron) ? report.cron : 'custom';
      setName(report.name);
      setEnvironmentId(report.environmentId);
      setCronPreset(preset);
      setCustomCron(report.cron);
      setTimezone(report.timezone ?? 'UTC');
      setCheckIds(report.checkIds);
      setRecipients(report.recipients);
    } else {
      setName('');
      setEnvironmentId(environments[0]?.id);
      setCronPreset('0 9 * * *');
      setCustomCron('0 9 * * *');
      setTimezone('UTC');
      setCheckIds([]);
      setRecipients([]);
    }
    setRecipientInput('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, report]);

  const cron = cronPreset === 'custom' ? customCron.trim() : cronPreset;

  const filteredChecks = useMemo(
    () =>
      environmentId
        ? projectChecks.filter((c) => !c.environmentId || c.environmentId === environmentId)
        : projectChecks,
    [projectChecks, environmentId]
  );

  const { mutate, isPending } = useMutation({
    mutationFn: (payload: ReportConfigPayload) =>
      mode === 'edit' && report
        ? updateReport(report.id, payload)
        : createReport(projectId!, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectReports(projectId!) });
      onClose();
      void message.success(mode === 'edit' ? 'Report updated' : 'Report created');
    },
    onError: () => {
      void message.error('Failed to save report');
    }
  });

  const addRecipient = (value: string) => {
    const trimmed = value.trim().replace(/,+$/, '');
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      void message.warning('Enter a valid email address');
      return;
    }
    if (!recipients.includes(trimmed)) {
      setRecipients((prev) => [...prev, trimmed]);
    }
    setRecipientInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addRecipient(recipientInput);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) { void message.error('Name is required'); return; }
    if (!environmentId) { void message.error('Environment is required'); return; }
    if (!cron.trim()) { void message.error('Cron is required'); return; }
    mutate({ name: name.trim(), environmentId, cron: cron.trim(), timezone, recipients, checkIds });
  };

  return (
    <Modal
      title={mode === 'edit' ? `Edit Report: ${report?.name ?? ''}` : 'New Report'}
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={isPending}
      okText={mode === 'edit' ? 'Save changes' : 'Create report'}
      width={760}
      centered
      style={{ top: 24 }}
      styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">Report name</Text>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly digest"
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <Text type="secondary">Environment</Text>
          <Select
            value={environmentId}
            onChange={setEnvironmentId}
            style={{ width: '100%', marginTop: 8 }}
            placeholder="Select an environment"
            options={environments.map((env) => ({ value: env.id, label: env.name }))}
          />
        </div>

        <div>
          <Text type="secondary">Cron preset</Text>
          <Select
            value={cronPreset}
            onChange={(v) => {
              setCronPreset(v);
              if (v !== 'custom') setCustomCron(v);
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
          <Text type="secondary">Checks (empty = all)</Text>
          <Select
            mode="multiple"
            value={checkIds}
            onChange={setCheckIds}
            style={{ width: '100%', marginTop: 8 }}
            placeholder="Leave empty to include all checks"
            options={filteredChecks.map((c) => ({ value: c.id, label: c.name }))}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>

        <div>
          <Text type="secondary">Recipients</Text>
          <div
            style={{
              marginTop: 8,
              padding: '4px 8px',
              border: '1px solid #d9d9d9',
              borderRadius: 8,
              minHeight: 38,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              alignItems: 'center'
            }}
          >
            {recipients.map((email) => {
              const user = knownUsers.find((u) => u.email === email);
              return (
                <Tag
                  key={email}
                  closable
                  onClose={() => setRecipients((prev) => prev.filter((r) => r !== email))}
                  style={{ margin: 0 }}
                >
                  {user ? user.email : email}
                </Tag>
              );
            })}
            <input
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => { if (recipientInput.trim()) addRecipient(recipientInput); }}
              placeholder={recipients.length === 0 ? 'Add email, press Enter or comma' : ''}
              style={{ border: 'none', outline: 'none', flex: 1, minWidth: 180, fontSize: 14 }}
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
            Press Enter or comma to add. Known users resolve to their name in the pill.
          </Text>
        </div>
      </Space>
    </Modal>
  );
}
