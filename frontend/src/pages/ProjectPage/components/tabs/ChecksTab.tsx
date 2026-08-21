import { Button, Card, Col, Dropdown, Empty, Space, Table, Tag, Typography, Upload } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  ExportOutlined,
  MobileOutlined
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import RunStatusBadge from '../../../../components/RunStatusBadge';
import type { ProjectCheck } from '../../../../types';
import { useProjectPage } from '../../hooks/useProjectPage';
import { formatDurationLabel, formatRelativeTime, formatScheduleSummary, formatShortTimestamp } from '../../utils';

const { Text } = Typography;

export default function ChecksTab() {
  const {
    projectId,
    navigate,
    loading,
    hasChecks,
    projectChecks,
    schedules,
    canWriteProject,
    confirmModal,
    openCheck,
    handleRunCheck,
    handleDuplicateCheck,
    handleExportCheck,
    handleDeleteCheck,
    handleImport
  } = useProjectPage();

  const checkColumns = [
    {
      title: 'Check',
      dataIndex: 'name',
      width: 340,
      render: (_: string, row: ProjectCheck) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, alignItems: 'stretch' }}>
          <Link
            to={`/tests/${row.id}/edit`}
            onClick={(event) => event.stopPropagation()}
            style={{
              display: 'block',
              fontWeight: 600,
              lineHeight: 1.45,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              textAlign: 'left'
            }}
          >
            {row.name}
          </Link>
          <Text
            type="secondary"
            style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left' }}
          >
            {row.url} · {row.steps.length} steps · {row.runCount} runs
          </Text>
        </div>
      )
    },
    {
      title: 'Status',
      width: 130,
      render: (_: unknown, row: ProjectCheck) =>
        row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag color="default">Never run</Tag>
    },
    {
      title: 'Last run',
      width: 200,
      render: (_: unknown, row: ProjectCheck) =>
        row.lastRunAt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <Text>{formatRelativeTime(row.lastRunAt)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt)}
            </Text>
          </div>
        ) : (
          <Text type="secondary">Never</Text>
        )
    },
    {
      title: 'Schedule',
      width: 160,
      render: (_: unknown, row: ProjectCheck) => <Tag color="purple">{formatScheduleSummary(row, schedules)}</Tag>
    },
    {
      title: 'Device',
      width: 150,
      render: (_: unknown, row: ProjectCheck) =>
        row.device ? (
          <Tag icon={<MobileOutlined />} color="blue">
            {row.device}
          </Tag>
        ) : (
          <Tag>Desktop</Tag>
        )
    },
    {
      title: 'Runs',
      width: 88,
      render: (_: unknown, row: ProjectCheck) => <Tag>{row.runCount}</Tag>
    },
    {
      title: 'Actions',
      width: 190,
      fixed: 'right' as const,
      render: (_: unknown, row: ProjectCheck) => (
        <Space onClick={(event) => event.stopPropagation()} size={8}>
          {canWriteProject ? (
            <Button size="small" type="primary" onClick={(event) => void handleRunCheck(row.id, event)}>
              Run
            </Button>
          ) : null}
          <Button size="small" onClick={() => openCheck(row.id)}>
            Open
          </Button>
          {canWriteProject ? (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'edit', icon: <EditOutlined />, label: 'Edit' },
                  { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
                  { key: 'export', icon: <ExportOutlined />, label: 'Export .spec.ts' },
                  { type: 'divider' },
                  { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();

                  if (key === 'edit') {
                    openCheck(row.id);
                  }

                  if (key === 'duplicate') {
                    void handleDuplicateCheck(row);
                  }

                  if (key === 'export') {
                    void handleExportCheck(row);
                  }

                  if (key === 'delete') {
                    confirmModal.confirm({
                      title: 'Delete check?',
                      content: `This will remove "${row.name}" and its run history.`,
                      okText: 'Delete',
                      okButtonProps: { danger: true },
                      centered: true,
                      onOk: async () => {
                        await handleDeleteCheck(row.id);
                      }
                    });
                  }
                }
              }}
            >
              <Button size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <Col span={24}>
      <Card
        style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
        title="Checks"
      >
        {loading ? (
          <Table
            dataSource={[]}
            columns={checkColumns as never}
            loading
            pagination={false}
            rowKey="id"
          />
        ) : hasChecks ? (
          <Table<ProjectCheck>
            dataSource={projectChecks}
            rowKey="id"
            pagination={false}
            rowClassName={() => 'clickable-row'}
            onRow={(row) => ({ onClick: () => openCheck(row.id) })}
            columns={checkColumns as never}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Text strong>No browser checks yet</Text>
                <Text type="secondary">Create your first check or import an existing Playwright .spec.ts file.</Text>
              </Space>
            }
          >
            <Space wrap>
              <Button type="primary" onClick={() => navigate(`/projects/${projectId}/tests/new`)} disabled={!canWriteProject}>
                New Check
              </Button>
              <Upload
                accept=".ts,.js"
                showUploadList={false}
                disabled={!canWriteProject}
                beforeUpload={(file) => {
                  void handleImport(file);
                  return false;
                }}
              >
                <Button disabled={!canWriteProject}>Import .spec.ts</Button>
              </Upload>
            </Space>
          </Empty>
        )}
      </Card>
    </Col>
  );
}
