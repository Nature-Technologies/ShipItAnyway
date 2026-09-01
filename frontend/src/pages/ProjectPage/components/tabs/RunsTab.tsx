import { Button, Card, Col, Empty, Space, Table, Tag, Typography } from 'antd';
import RunStatusBadge from '../../../../components/RunStatusBadge';
import type { ProjectCheck } from '../../../../types';
import { useProjectPage } from '../../hooks/useProjectPage';
import { formatDurationLabel, formatRelativeTime, formatShortTimestamp } from '../../utils';

const { Text } = Typography;

export default function RunsTab() {
  const { latestChecks, openLatestRun, openRunSuiteModal, canWriteProject } = useProjectPage();

  return (
    <Col span={24}>
      <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Recent results">
        {latestChecks.some((check) => check.lastRunAt) ? (
          <Table<ProjectCheck>
            dataSource={latestChecks.filter((check) => check.lastRunAt)}
            rowKey="id"
            pagination={false}
            columns={[
              {
                title: 'Check',
                dataIndex: 'name',
                render: (_: string, row: ProjectCheck) => (
                  <Space direction="vertical" size={0}>
                    <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600, height: 'auto' }} onClick={() => openLatestRun(row)}>
                      {row.name}
                    </Button>
                    <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {row.url}
                    </Text>
                  </Space>
                )
              },
              {
                title: 'Status',
                render: (_: unknown, row: ProjectCheck) =>
                  row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>Never run</Tag>
              },
              {
                title: 'Last run',
                render: (_: unknown, row: ProjectCheck) =>
                  row.lastRunAt ? (
                    <Space direction="vertical" size={0}>
                      <Text>{formatRelativeTime(row.lastRunAt)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt)}
                      </Text>
                    </Space>
                  ) : (
                    <Text type="secondary">Never</Text>
                  )
              },
              {
                title: 'Open',
                render: (_: unknown, row: ProjectCheck) => (
                  <Button size="small" onClick={() => openLatestRun(row)}>
                    Open
                  </Button>
                )
              }
            ]}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Run history will appear here once checks have been executed."
          >
            <Button type="primary" onClick={openRunSuiteModal} disabled={!canWriteProject}>
              Run suite
            </Button>
          </Empty>
        )}
      </Card>
    </Col>
  );
}
