import { Button, Card, Col, Dropdown, Empty, Space, Table, Tag, Typography } from 'antd';
import { EllipsisOutlined, PlusOutlined } from '@ant-design/icons';
import type { Schedule } from '../../../../types';
import { describeCron } from '../../../../components/ScheduleFormModal';
import { useProjectPage } from '../../hooks/useProjectPage';
import { formatCompactDateTime, formatRelativeTime, formatScheduleNextRun } from '../../utils';

const { Text } = Typography;

export default function SchedulesTab() {
  const {
    schedules,
    loading,
    canManageSchedules,
    navigate,
    confirmModal,
    openScheduleCreate,
    openScheduleEdit,
    runScheduleNow,
    toggleSchedule,
    deleteExistingSchedule
  } = useProjectPage();

  return (
    <Col span={24}>
      <Card
        style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
        title="Schedules"
        extra={
          <Button
            type={canManageSchedules ? 'primary' : 'default'}
            icon={<PlusOutlined />}
            onClick={openScheduleCreate}
            disabled={!canManageSchedules}
          >
            New Schedule
          </Button>
        }
      >
        <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
          <Text type="secondary">Run browser checks or suites automatically on a cron expression.</Text>
        </Space>

        {schedules.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Text strong>No schedules yet</Text>
                <Text type="secondary">Create a schedule to run checks automatically.</Text>
              </Space>
            }
          >
            <Button type={canManageSchedules ? 'primary' : 'default'} onClick={openScheduleCreate} disabled={!canManageSchedules}>
              New Schedule
            </Button>
          </Empty>
        ) : (
          <Table<Schedule>
            dataSource={schedules}
            rowKey="id"
            loading={loading}
            pagination={false}
            rowClassName={() => (canManageSchedules ? 'clickable-row' : '')}
            onRow={(row) => (canManageSchedules ? { onClick: () => openScheduleEdit(row) } : {})}
            columns={[
              {
                title: 'Schedule',
                dataIndex: 'name',
                render: (value: string, row: Schedule) => (
                  <Space direction="vertical" size={0}>
                    {canManageSchedules ? (
                      <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openScheduleEdit(row)}>
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
                title: 'Target',
                render: (_: unknown, row) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{row.suite?.name ?? row.test?.name ?? '—'}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {row.environment?.name ?? 'No environment'}
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
                title: 'Status',
                render: (_: unknown, row) => (row.enabled ? <Tag color="green">Active</Tag> : <Tag>Paused</Tag>)
              },
              {
                title: 'Last run',
                render: (_: unknown, row) =>
                  row.lastRunAt ? (
                    <Space direction="vertical" size={0}>
                      <Text>{formatRelativeTime(row.lastRunAt)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCompactDateTime(row.lastRunAt)}
                      </Text>
                    </Space>
                  ) : (
                    <Text type="secondary">Never</Text>
                  )
              },
              {
                title: 'Next run',
                render: (_: unknown, row) =>
                  row.enabled ? (
                    formatScheduleNextRun(row).overdue ? (
                      <Space direction="vertical" size={0}>
                        <Text>{formatScheduleNextRun(row).primary}</Text>
                        <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                          Overdue
                        </Tag>
                      </Space>
                    ) : (
                      <Space direction="vertical" size={0}>
                        <Text>{formatScheduleNextRun(row).primary}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatScheduleNextRun(row).secondary}
                        </Text>
                      </Space>
                    )
                  ) : (
                    <Text type="secondary">Paused</Text>
                  )
              },
              {
                title: 'Actions',
                render: (_: unknown, row) => (
                  <Space onClick={(event) => event.stopPropagation()} size={8}>
                    <Button size="small" onClick={() => navigate(`/schedules/${row.id}/history`)}>
                      History
                    </Button>
                    {canManageSchedules ? (
                      <>
                        <Button size="small" onClick={() => void runScheduleNow(row)}>
                          Run now
                        </Button>
                        <Button size="small" onClick={() => openScheduleEdit(row)}>
                          Edit
                        </Button>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              { key: 'toggle', label: row.enabled ? 'Pause' : 'Resume' },
                              { type: 'divider' },
                              { key: 'delete', label: 'Delete', danger: true }
                            ],
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'toggle') {
                                void toggleSchedule(row);
                              }
                              if (key === 'delete') {
                                confirmModal.confirm({
                                  title: 'Delete schedule?',
                                  content: `This will remove "${row.name}" and stop automatic runs.`,
                                  okText: 'Delete',
                                  okButtonProps: { danger: true },
                                  centered: true,
                                  onOk: async () => {
                                    await deleteExistingSchedule(row.id);
                                  }
                                });
                              }
                            }
                          }}
                        >
                          <Button size="small" icon={<EllipsisOutlined />} />
                        </Dropdown>
                      </>
                    ) : (
                      <Text type="secondary">Read-only</Text>
                    )}
                  </Space>
                )
              }
            ]}
          />
        )}
      </Card>
    </Col>
  );
}
