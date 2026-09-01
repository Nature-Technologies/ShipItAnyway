import { Button, Card, Col, Dropdown, Empty, Space, Table, Tag, Typography } from 'antd';
import { EllipsisOutlined, PlusOutlined } from '@ant-design/icons';
import type { NotificationChannel } from '../../../../types';
import { useProjectPage } from '../../hooks/useProjectPage';
import { formatAlertRules, formatCompactDateTime, formatRelativeTime } from '../../utils';

const { Text } = Typography;

export default function AlertsTab() {
  const {
    channels,
    loading,
    canWriteProject,
    confirmModal,
    openChannelCreate,
    openChannelEdit,
    testExistingChannel,
    toggleChannelEnabled,
    deleteExistingChannel
  } = useProjectPage();

  return (
    <Col span={24}>
      <Card
        style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
        title="Alerts"
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openChannelCreate('telegram')} disabled={!canWriteProject}>
              Add Telegram
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => openChannelCreate('slack')} disabled={!canWriteProject}>
              Add Slack
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginBottom: 16 }}>
          <Text type="secondary">Send failed and recovered check notifications to Telegram or Slack.</Text>
        </div>

        {channels.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text strong>No alert channels configured</Text>
                <Text type="secondary">Send failed and recovered browser check notifications to Telegram or Slack.</Text>
              </div>
            }
          >
            <Space wrap>
              <Button type="primary" onClick={() => openChannelCreate('telegram')} disabled={!canWriteProject}>
                Add Telegram
              </Button>
              <Button onClick={() => openChannelCreate('slack')} disabled={!canWriteProject}>Add Slack</Button>
            </Space>
          </Empty>
        ) : (
          <Table<NotificationChannel>
            dataSource={channels}
            rowKey="id"
            loading={loading}
            pagination={false}
            rowClassName={() => (canWriteProject ? 'clickable-row' : '')}
            onRow={(row) => (canWriteProject ? { onClick: () => openChannelEdit(row) } : {})}
            columns={[
              {
                title: 'Alert',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
                    {canWriteProject ? (
                      <Button
                        type="link"
                        style={{
                          padding: 0,
                          height: 'auto',
                          lineHeight: '20px',
                          textAlign: 'left',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                        onClick={() => openChannelEdit(row)}
                      >
                        {value}
                      </Button>
                    ) : (
                      <Text strong style={{ lineHeight: '20px' }}>
                        {value}
                      </Text>
                    )}
                  </div>
                )
              },
              {
                title: 'Type',
                dataIndex: 'type',
                render: (value: string) => <Tag color={value === 'telegram' ? 'blue' : 'gold'}>{value}</Tag>
              },
              {
                title: 'Rules',
                render: (_: unknown, row) => (
                  <Space wrap>
                    {formatAlertRules(row).map((rule) => (
                      <Tag key={rule} color="purple">
                        {rule}
                      </Tag>
                    ))}
                  </Space>
                )
              },
              {
                title: 'Status',
                render: (_: unknown, row) => (row.enabled ? <Tag color="green">Active</Tag> : <Tag color="default">Paused</Tag>)
              },
              {
                title: 'Last test',
                render: (_: unknown, row) =>
                  row.lastTestAt ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      <Text>{formatRelativeTime(row.lastTestAt)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCompactDateTime(row.lastTestAt)}
                      </Text>
                    </div>
                  ) : (
                    <Text type="secondary">Never</Text>
                  )
              },
              {
                title: 'Actions',
                render: (_: unknown, row) => (
                  <Space onClick={(event) => event.stopPropagation()} size={8}>
                    {canWriteProject ? (
                      <>
                        <Button size="small" onClick={() => openChannelEdit(row)}>
                          Edit
                        </Button>
                        <Button size="small" onClick={() => void testExistingChannel(row)}>
                          Send test
                        </Button>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              { key: 'toggle', label: row.enabled ? 'Pause' : 'Activate' },
                              { key: 'delete', label: 'Delete', danger: true }
                            ],
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'toggle') {
                                void toggleChannelEnabled(row);
                              }
                              if (key === 'delete') {
                                confirmModal.confirm({
                                  title: 'Delete alert channel?',
                                  content: `This will remove "${row.name}".`,
                                  okText: 'Delete',
                                  okButtonProps: { danger: true },
                                  centered: true,
                                  onOk: async () => {
                                    await deleteExistingChannel(row.id);
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
