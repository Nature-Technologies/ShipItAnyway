import { Button, Card, Col, Dropdown, Empty, Space, Table, Tag, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, EllipsisOutlined, PlusOutlined } from '@ant-design/icons';
import type { Environment } from '../../../../types';
import { useProjectPage } from '../../hooks/useProjectPage';
import { formatDateOnly } from '../../utils';

const { Text } = Typography;

export default function EnvironmentsTab() {
  const {
    environments,
    environmentUsage,
    loading,
    canManageEnvironments,
    confirmModal,
    openEnvironmentCreate,
    openEnvironmentEdit,
    duplicateEnvironment,
    deleteEnvironmentById
  } = useProjectPage();

  return (
    <Col span={24}>
      <Card
        style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
        title="Environments"
        extra={
          <Button
            type={canManageEnvironments ? 'primary' : 'default'}
            icon={<PlusOutlined />}
            onClick={openEnvironmentCreate}
            disabled={!canManageEnvironments}
          >
            New Environment
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginBottom: 16 }}>
          <Text type="secondary">Manage variable sets used in check URLs and steps.</Text>
          <Text type="secondary">Use variables in checks as {'{{BASE_URL}}'}, {'{{USERNAME}}'}, or {'{{PASSWORD}}'}.</Text>
        </div>

        {environments.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text strong>No environments yet</Text>
                <Text type="secondary">Create an environment to reuse variables like {'{{BASE_URL}}'} across checks.</Text>
              </div>
            }
          >
            <Button type={canManageEnvironments ? 'primary' : 'default'} onClick={openEnvironmentCreate} disabled={!canManageEnvironments}>
              New Environment
            </Button>
          </Empty>
        ) : (
          <Table<Environment & { usedByChecks: number }>
            dataSource={environmentUsage}
            rowKey="id"
            loading={loading}
            pagination={false}
            rowClassName={() => (canManageEnvironments ? 'clickable-row' : '')}
            onRow={(row) => (canManageEnvironments ? { onClick: () => openEnvironmentEdit(row) } : {})}
            columns={[
              {
                title: 'Environment',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
                    {canManageEnvironments ? (
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
                        onClick={() => openEnvironmentEdit(row)}
                      >
                        {value}
                      </Button>
                    ) : (
                      <Text strong style={{ lineHeight: '20px' }}>
                        {value}
                      </Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {Object.keys(row.variables).length} variables
                    </Text>
                  </div>
                )
              },
              {
                title: 'Variables',
                render: (_: unknown, row) => <Tag color="purple">{Object.keys(row.variables).length}</Tag>
              },
              {
                title: 'Used by checks',
                render: (_: unknown, row) => <Tag color={row.usedByChecks > 0 ? 'blue' : 'default'}>{row.usedByChecks}</Tag>
              },
              {
                title: 'Created',
                dataIndex: 'createdAt',
                render: (value: string) => formatDateOnly(value)
              },
              {
                title: 'Actions',
                render: (_: unknown, row) => (
                  <Space onClick={(event) => event.stopPropagation()} size={8}>
                    {canManageEnvironments ? (
                      <>
                        <Button size="small" onClick={() => openEnvironmentEdit(row)}>
                          Edit
                        </Button>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
                              { type: 'divider' },
                              { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }
                            ],
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'duplicate') {
                                void duplicateEnvironment(row);
                              }
                              if (key === 'delete') {
                                confirmModal.confirm({
                                  title: 'Delete environment?',
                                  content: `This will remove "${row.name}" and stop variable reuse.`,
                                  okText: 'Delete',
                                  okButtonProps: { danger: true },
                                  centered: true,
                                  onOk: async () => {
                                    await deleteEnvironmentById(row.id);
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
