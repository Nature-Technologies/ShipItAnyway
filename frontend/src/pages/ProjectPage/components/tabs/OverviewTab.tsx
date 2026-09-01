import { Button, Card, Col, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import RunStatusBadge from '../../../../components/RunStatusBadge';
import type { ProjectCheck } from '../../../../types';
import { useProjectPage } from '../../hooks/useProjectPage';
import {
  RECENT_RESULTS_GRID_COLUMNS,
  formatCompactDateTime,
  formatDurationLabel,
  formatRelativeTime,
  formatShortTimestamp,
  renderRecentResultCell
} from '../../utils';

export default function OverviewTab() {
  const {
    summary,
    overviewChecks,
    attentionChecks,
    projectSetupItems,
    openCheck,
    handleRunCheck,
    openRunSuiteModal,
    setActiveTab,
    canWriteProject
  } = useProjectPage();

  return (
    <Col span={24}>
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={14}>
          <Card
            style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
            title="Recent results"
            extra={summary?.totalRuns30d ? <Tag color="blue">{summary.totalRuns30d} runs in 30 days</Tag> : <Tag color="default">No runs yet</Tag>}
          >
            {overviewChecks.length > 0 ? (
              <div style={{ width: '100%', minWidth: 0 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: RECENT_RESULTS_GRID_COLUMNS,
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 16px 12px',
                    color: '#8c8c8c',
                    fontSize: 12,
                    fontWeight: 500
                  }}
                >
                  <div style={{ minWidth: 0 }}>Check</div>
                  <div style={{ minWidth: 0 }}>Status</div>
                  <div style={{ minWidth: 0 }}>Last run</div>
                  <div style={{ minWidth: 0 }}>Open</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {overviewChecks.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: RECENT_RESULTS_GRID_COLUMNS,
                        alignItems: 'center',
                        gap: 16,
                        padding: '14px 16px',
                        borderRadius: 16,
                        border: '1px solid #edf2f7',
                        background: '#fff'
                      }}
                    >
                      {renderRecentResultCell(row, openCheck)}
                      <div style={{ minWidth: 0 }}>
                        {row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>Never run</Tag>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        {row.lastRunAt ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <Typography.Text>{formatRelativeTime(row.lastRunAt)}</Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt)}
                            </Typography.Text>
                          </div>
                        ) : (
                          <Typography.Text type="secondary">Never</Typography.Text>
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <Button size="small" onClick={() => openCheck(row.id)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text strong>No runs yet</Typography.Text>
                    <Typography.Text type="secondary">
                      Run a check manually or create a schedule to start collecting results.
                    </Typography.Text>
                  </Space>
                }
              >
                <Space wrap>
                  <Button type="primary" onClick={openRunSuiteModal} disabled={!canWriteProject}>
                    Run suite
                  </Button>
                  <Button onClick={() => setActiveTab('checks')}>Go to Checks</Button>
                </Space>
              </Empty>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
            title="Needs attention"
            extra={summary?.flakyChecks ? <Tag color="gold">{summary.flakyChecks} flaky</Tag> : <Tag color="green">All clear</Tag>}
          >
            {attentionChecks.filter((check) => check.lastRunStatus === 'FAILED').length > 0 ? (
              <Table<ProjectCheck>
                dataSource={attentionChecks.filter((check) => check.lastRunStatus === 'FAILED')}
                rowKey="id"
                pagination={false}
                columns={[
                  {
                    title: 'Check',
                    dataIndex: 'name',
                    render: (value: string, row: ProjectCheck) => (
                      <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openCheck(row.id)}>
                        {value}
                      </Button>
                    )
                  },
                  {
                    title: 'Status',
                    render: (_: unknown, row: ProjectCheck) =>
                      row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>Never run</Tag>
                  },
                  {
                    title: 'Last failure',
                    render: (_: unknown, row: ProjectCheck) =>
                      row.lastRunAt ? <Typography.Text>{formatCompactDateTime(row.lastRunAt)}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>
                  },
                  {
                    title: 'Error summary',
                    render: (_: unknown, row: ProjectCheck) => (
                      <Typography.Text type="secondary" ellipsis={{ tooltip: row.latestRun?.error ?? 'No error summary' }} style={{ maxWidth: 220, display: 'inline-block' }}>
                        {row.latestRun?.error ?? 'No error summary'}
                      </Typography.Text>
                    )
                  },
                  {
                    title: 'Actions',
                    render: (_: unknown, row: ProjectCheck) => (
                      <Space>
                        <Button size="small" onClick={() => openCheck(row.id)}>
                          Open result
                        </Button>
                        <Button size="small" onClick={() => void handleRunCheck(row.id)}>
                          Rerun
                        </Button>
                      </Space>
                    )
                  }
                ]}
              />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Title level={5} style={{ margin: 0 }}>No active failures</Typography.Title>
                <Typography.Text type="secondary">All browser checks in this project are currently passing.</Typography.Text>
                {summary?.flakyChecks ? (
                  <Typography.Text type="secondary">{summary.flakyChecks} flaky checks were detected in recent runs.</Typography.Text>
                ) : null}
              </Space>
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
            <Typography.Title level={4}>Project setup</Typography.Title>
            <Row gutter={[16, 16]}>
              {projectSetupItems.map((item) => (
                <Col key={item.label} xs={24} sm={12} xl={6}>
                  <Space align="start">
                    {item.done ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <WarningOutlined style={{ color: '#8c8c8c' }} />}
                    <div>
                      <Typography.Text strong>{item.label}</Typography.Text>
                      <br />
                      <Typography.Text type="secondary">{item.done ? 'Configured' : 'Not configured'}</Typography.Text>
                    </div>
                  </Space>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </Col>
  );
}
