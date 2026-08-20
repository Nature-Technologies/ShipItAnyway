import { useEffect, useState } from 'react';
import { Badge, Button, Card, Col, Dropdown, Layout, Modal, Row, Space, Table, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, EllipsisOutlined, FileTextOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createSchedule, deleteSchedule, getEnvironments, getProject, getSchedules, getSuites, runSchedule, updateSchedule } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import { ScheduleFormModal, SchedulePayload, describeCron } from '../components/ScheduleFormModal';
import type { Environment, ProjectWorkspace, Schedule, Suite } from '../types';
import { resolveScheduleTimezone } from '../utils/scheduleTimezone';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatCompactDateTime(value?: string | null, timeZone?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {})
  });
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Never';

  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatRelativeFutureTime(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return diffMs >= 0 ? 'in a moment' : 'just now';
  if (absMs < hour) return diffMs >= 0 ? `in ${Math.round(absMs / minute)} min` : `${Math.round(absMs / minute)} min ago`;
  if (absMs < day) {
    const amount = Math.round(absMs / hour);
    return diffMs >= 0 ? `in ${amount} hour${amount === 1 ? '' : 's'}` : `${amount} hour${amount === 1 ? '' : 's'} ago`;
  }
  const amount = Math.round(absMs / day);
  return diffMs >= 0 ? `in ${amount} day${amount === 1 ? '' : 's'}` : `${amount} day${amount === 1 ? '' : 's'} ago`;
}

function formatNextRun(schedule: Schedule) {
  const timeZone = resolveScheduleTimezone(schedule);
  if (!schedule.enabled) {
    return { primary: 'Paused', secondary: '', overdue: false };
  }
  if (!schedule.nextRunAt) {
    return { primary: '—', secondary: '', overdue: false };
  }

  const nextRunAt = new Date(schedule.nextRunAt).getTime();
  if (nextRunAt <= Date.now()) {
    return {
      primary: formatCompactDateTime(schedule.nextRunAt, timeZone),
      secondary: '',
      overdue: true
    };
  }

  return {
    primary: formatRelativeFutureTime(schedule.nextRunAt),
    secondary: formatCompactDateTime(schedule.nextRunAt, timeZone),
    overdue: false
  };
}

function getScheduleTargetSummary(schedule: Schedule) {
  if (schedule.suite) {
    return {
      title: `${schedule.suite.name} · ${schedule.suite.testIds.length} checks`,
      subtitle: schedule.environment?.name ?? 'No environment selected'
    };
  }

  if (schedule.test) {
    const device = schedule.test.device?.trim() ? schedule.test.device : 'Desktop';
    const stepsCount = schedule.test.steps?.length ?? 0;
    return {
      title: `${schedule.test.name} · ${device} · ${stepsCount} steps`,
      subtitle: schedule.environment?.name ?? 'No environment selected'
    };
  }

  return {
    title: '—',
    subtitle: 'No environment selected'
  };
}

export default function SchedulesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'create' | 'edit'>('create');
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [projectData, scheduleData, suiteData, environmentData] = await Promise.all([
        getProject(projectId!),
        getSchedules(projectId!),
        getSuites(projectId!),
        getEnvironments(projectId!)
      ]);
      setProject(projectData);
      setSchedules(scheduleData);
      setSuites(suiteData);
      setEnvironments(environmentData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const projectTests = project?.tests ?? [];

  const openCreate = () => {
    setScheduleMode('create');
    setEditingSchedule(null);
    setModalOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    setScheduleMode('edit');
    setEditingSchedule(schedule);
    setModalOpen(true);
  };

  const openDuplicate = (schedule: Schedule) => {
    setScheduleMode('create');
    setEditingSchedule(schedule); // passed as prefill source to the modal
    setModalOpen(true);
  };

  const runScheduleNow = async (schedule: Schedule) => {
    try {
      await runSchedule(schedule.id);
      message.success('Schedule run started');
      navigate(`/schedules/${schedule.id}/history`);
    } catch {
      message.error('Failed to run schedule');
    }
  };

  const handleSubmit = async (payload: SchedulePayload) => {
    setSaving(true);
    try {
      if (scheduleMode === 'edit' && editingSchedule) {
        await updateSchedule(editingSchedule.id, payload);
        message.success('Schedule updated');
      } else {
        await createSchedule(projectId!, {
          name: payload.name,
          cron: payload.cron,
          timezone: payload.timezone,
          suiteId: payload.suiteId ?? undefined,
          testId: payload.testId ?? undefined,
          environmentId: payload.environmentId ?? undefined,
          enabled: payload.enabled
        });
        message.success('Schedule created');
      }
      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSchedule(id);
    message.success('Schedule deleted');
    await load();
  };

  const handleToggleEnabled = async (schedule: Schedule) => {
    await updateSchedule(schedule.id, { enabled: !schedule.enabled });
    message.success(schedule.enabled ? 'Schedule paused' : 'Schedule resumed');
    await load();
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text type="secondary">
                    <Link to={`/projects/${projectId}`}>Project</Link>
                  </Text>
                  <Title level={2} style={{ margin: 0 }}>{project?.name ?? 'Loading...'}</Title>
                  <Text type="secondary">Cron-based schedules for suites or single tests.</Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  New Schedule
                </Button>
              </Space>
            </Card>
          </Col>

          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Table
                dataSource={schedules}
                rowKey="id"
                loading={loading}
                pagination={false}
                rowClassName={() => 'clickable-row'}
                onRow={(row) => ({ onClick: () => openEdit(row) })}
                columns={[
                  {
                    title: 'Schedule',
                    dataIndex: 'name',
                    render: (value: string, row: Schedule) => (
                      <Space direction="vertical" size={0}>
                        <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openEdit(row)}>
                          {value}
                        </Button>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {describeCron(row.cron)}
                        </Text>
                      </Space>
                    )
                  },
                  {
                    title: 'Cron',
                    dataIndex: 'cron',
                    render: (value: string) => <Tag color="blue"><code>{value}</code></Tag>
                  },
                  {
                    title: 'Target',
                    render: (_, row) => {
                      const summary = getScheduleTargetSummary(row);
                      return (
                        <Space>
                          {row.suite ? <AppstoreOutlined /> : <FileTextOutlined />}
                          <Space direction="vertical" size={0}>
                            <Text strong>{summary.title}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {summary.subtitle}
                            </Text>
                          </Space>
                        </Space>
                      );
                    }
                  },
                  {
                    title: 'Last Run',
                    dataIndex: 'lastRunAt',
                    render: (value: string | null) =>
                      value ? (
                        <Space direction="vertical" size={0}>
                          <Text>{formatRelativeTime(value)}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatCompactDateTime(value)}
                          </Text>
                        </Space>
                      ) : (
                        <Text type="secondary">Never</Text>
                      )
                  },
                  {
                    title: 'Next Run',
                    render: (_, row) =>
                      row.enabled ? (
                        row.nextRunAt ? (
                          <Space direction="vertical" size={0}>
                            <Text>{formatNextRun(row).primary}</Text>
                            {formatNextRun(row).overdue ? (
                              <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                                Overdue
                              </Tag>
                            ) : (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatNextRun(row).secondary}
                              </Text>
                            )}
                          </Space>
                        ) : (
                          <Text type="secondary">—</Text>
                        )
                      ) : (
                        <Tag>Paused</Tag>
                      )
                  },
                  {
                    title: 'Status',
                    render: (_, row) => (
                      <Badge status={row.enabled ? 'success' : 'default'} text={row.enabled ? 'Active' : 'Paused'} />
                    )
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Space onClick={(event) => event.stopPropagation()} size={8}>
                        <Button size="small" onClick={() => void runScheduleNow(row)}>
                          Run now
                        </Button>
                        <Button size="small" icon={<HistoryOutlined />} onClick={() => navigate(`/schedules/${row.id}/history`)}>
                          History
                        </Button>
                        <Button size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              { key: 'toggle', label: row.enabled ? 'Pause' : 'Resume' },
                              { key: 'duplicate', label: 'Duplicate' },
                              { type: 'divider' },
                              { key: 'delete', label: 'Delete', danger: true }
                            ],
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'toggle') {
                                void handleToggleEnabled(row);
                              }
                              if (key === 'duplicate') {
                                openDuplicate(row);
                              }
                              if (key === 'delete') {
                                Modal.confirm({
                                  title: 'Delete schedule?',
                                  content: `This will remove "${row.name}" and stop automatic runs.`,
                                  okText: 'Delete',
                                  okButtonProps: { danger: true },
                                  centered: true,
                                  onOk: async () => {
                                    await handleDelete(row.id);
                                  }
                                });
                              }
                            }
                          }}
                        >
                          <Button size="small" icon={<EllipsisOutlined />} />
                        </Dropdown>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Content>

      <ScheduleFormModal
        open={modalOpen}
        mode={scheduleMode}
        schedule={editingSchedule}
        suites={suites}
        checks={projectTests}
        environments={environments}
        saving={saving}
        onCancel={() => setModalOpen(false)}
        onSubmit={(payload) => void handleSubmit(payload)}
      />
      <AppFooter />
    </Layout>
  );
}
