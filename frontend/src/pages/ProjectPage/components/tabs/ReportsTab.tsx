import { useState } from 'react';
import { Button, Card, Col, Empty, Space, Table, Tag, Typography, message } from 'antd';
import { DownOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteReport,
  getReportSends,
  getReports,
  previewReport,
  sendReportNow
} from '../../../../api/client';
import { qk } from '../../../../lib/queryKeys';
import { describeCron } from '../../../../components/ScheduleFormModal';
import { useProjectPage } from '../../hooks/useProjectPage';
import { formatCompactDateTime, formatRelativeTime } from '../../utils';
import type { ReportConfig, ReportSend } from '../../../../types';
import ReportModal from '../modals/ReportModal';

const { Text } = Typography;

const STATUS_COLOR: Record<ReportSend['status'], string> = {
  SENT: 'green',
  SKIPPED_EMPTY: 'orange',
  FAILED: 'red'
};

const STATUS_LABEL: Record<ReportSend['status'], string> = {
  SENT: 'Sent',
  SKIPPED_EMPTY: 'Skipped (no runs)',
  FAILED: 'Failed'
};

function HistoryPanel({ reportId }: { reportId: string }) {
  const { data: sends = [], isLoading } = useQuery({
    queryKey: qk.reportSends(reportId),
    queryFn: () => getReportSends(reportId)
  });

  if (isLoading) return <Text type="secondary">Loading…</Text>;
  if (sends.length === 0) return <Text type="secondary">No sends yet.</Text>;

  return (
    <Table<ReportSend>
      dataSource={sends}
      rowKey="id"
      pagination={false}
      size="small"
      style={{ marginLeft: 8 }}
      columns={[
        {
          title: 'Date',
          dataIndex: 'createdAt',
          render: (v: string) => formatCompactDateTime(v)
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: (v: ReportSend['status']) => (
            <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>
          )
        },
        {
          title: 'Window',
          render: (_: unknown, row) =>
            `${formatCompactDateTime(row.windowStart)} → ${formatCompactDateTime(row.windowEnd)}`
        },
        { title: 'Runs', dataIndex: 'runCount' },
        {
          title: 'Pass rate',
          render: (_: unknown, row) => `${row.passRate}%`
        },
        {
          title: 'Recipients',
          render: (_: unknown, row) => row.recipients.length
        }
      ]}
    />
  );
}

export default function ReportsTab() {
  const { projectId, canEditReports, environments, confirmModal } = useProjectPage();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingReport, setEditingReport] = useState<ReportConfig | null>(null);
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: qk.projectReports(projectId!),
    queryFn: () => getReports(projectId!),
    enabled: Boolean(projectId)
  });

  const deleteMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectReports(projectId!) });
      void message.success('Report deleted');
    },
    onError: () => { void message.error('Delete failed'); }
  });

  const sendMutation = useMutation({
    mutationFn: sendReportNow,
    onSuccess: (result) => {
      if (!result || result.status === 'SKIPPED_EMPTY') {
        void message.info('No runs in window — report skipped');
      } else if (result.status === 'SENT') {
        void message.success('Report sent');
        void qc.invalidateQueries({ queryKey: qk.reportSends(result.reportConfigId) });
      } else {
        void message.error(`Failed: ${result.error ?? 'unknown error'}`);
      }
      void qc.invalidateQueries({ queryKey: qk.projectReports(projectId!) });
    },
    onError: () => { void message.error('Send failed'); }
  });

  const previewMutation = useMutation({
    mutationFn: previewReport,
    onSuccess: (data) => {
      void message.success(`Preview sent to ${data.previewedTo}`);
    },
    onError: () => { void message.error('Preview failed'); }
  });

  const envMap = new Map(environments.map((e) => [e.id, e.name]));

  const openCreate = () => {
    setEditingReport(null);
    setModalMode('create');
    setModalOpen(true);
  };

  const openEdit = (report: ReportConfig) => {
    setEditingReport(report);
    setModalMode('edit');
    setModalOpen(true);
  };

  const toggleHistory = (id: string) => {
    setExpandedRows((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  return (
    <Col span={24}>
      <Card
        style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
        title="Reports"
        extra={
          <Button
            type={canEditReports ? 'primary' : 'default'}
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={!canEditReports}
          >
            New Report
          </Button>
        }
      >
        <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
          <Text type="secondary">Send scheduled email digests with check pass-rate and failure summaries.</Text>
        </Space>

        {reports.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Text strong>No reports yet</Text>
                <Text type="secondary">Create a report to send periodic email digests.</Text>
              </Space>
            }
          >
            <Button
              type={canEditReports ? 'primary' : 'default'}
              onClick={openCreate}
              disabled={!canEditReports}
            >
              New Report
            </Button>
          </Empty>
        ) : (
          <Table<ReportConfig>
            dataSource={reports}
            rowKey="id"
            loading={isLoading}
            pagination={false}
            expandable={{
              expandedRowKeys: expandedRows,
              onExpand: (_, record) => toggleHistory(record.id),
              expandedRowRender: (row) => <HistoryPanel reportId={row.id} />,
              expandIcon: ({ expanded, onExpand, record }) => (
                <Button
                  size="small"
                  type="text"
                  icon={expanded ? <DownOutlined /> : <RightOutlined />}
                  onClick={(e) => onExpand(record, e)}
                />
              )
            }}
            columns={[
              {
                title: 'Report',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <Space direction="vertical" size={0}>
                    {canEditReports ? (
                      <Button
                        type="link"
                        style={{ padding: 0, fontWeight: 600 }}
                        onClick={() => openEdit(row)}
                      >
                        {value}
                      </Button>
                    ) : (
                      <Text strong>{value}</Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {describeCron(row.cron)}
                    </Text>
                  </Space>
                )
              },
              {
                title: 'Environment',
                render: (_: unknown, row) => (
                  <Tag color="blue">{envMap.get(row.environmentId) ?? row.environmentId}</Tag>
                )
              },
              {
                title: 'Recipients',
                render: (_: unknown, row) => (
                  <Tag color="purple">{row.recipients.length}</Tag>
                )
              },
              {
                title: 'Status',
                render: (_: unknown, row) =>
                  row.enabled ? <Tag color="green">Active</Tag> : <Tag>Paused</Tag>
              },
              {
                title: 'Last sent',
                render: (_: unknown, row) =>
                  row.lastSentAt ? (
                    <Space direction="vertical" size={0}>
                      <Text>{formatRelativeTime(row.lastSentAt)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCompactDateTime(row.lastSentAt)}
                      </Text>
                    </Space>
                  ) : (
                    <Text type="secondary">Never</Text>
                  )
              },
              {
                title: 'Actions',
                render: (_: unknown, row) => (
                  <Space size={8} wrap>
                    <Button size="small" onClick={() => toggleHistory(row.id)}>
                      {expandedRows.includes(row.id) ? 'Hide history' : 'History'}
                    </Button>
                    {canEditReports && (
                      <>
                        <Button
                          size="small"
                          loading={sendMutation.isPending}
                          onClick={() => sendMutation.mutate(row.id)}
                        >
                          Send now
                        </Button>
                        <Button
                          size="small"
                          loading={previewMutation.isPending}
                          onClick={() => previewMutation.mutate(row.id)}
                        >
                          Preview
                        </Button>
                        <Button size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          danger
                          loading={deleteMutation.isPending}
                          onClick={() => {
                            confirmModal.confirm({
                              title: 'Delete report?',
                              content: `This will remove "${row.name}" and stop scheduled sends.`,
                              okText: 'Delete',
                              okButtonProps: { danger: true },
                              centered: true,
                              onOk: async () => {
                                await deleteMutation.mutateAsync(row.id);
                              }
                            });
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                    {!canEditReports && <Text type="secondary">Read-only</Text>}
                  </Space>
                )
              }
            ]}
          />
        )}
      </Card>

      <ReportModal
        open={modalOpen}
        mode={modalMode}
        report={editingReport}
        onClose={() => setModalOpen(false)}
      />
    </Col>
  );
}
