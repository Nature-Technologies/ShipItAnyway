import { Button, Input, Modal, Space, Typography } from 'antd';
import { useProjectPage } from '../../hooks/useProjectPage';
import { createEnvRow, isSecretKey } from '../../utils';

const { Text } = Typography;

export default function EnvironmentModal() {
  const {
    environmentModalOpen,
    setEnvironmentModalOpen,
    environmentMode,
    editingEnvironment,
    environmentName,
    setEnvironmentName,
    environmentRows,
    setEnvironmentRows,
    environmentSaving,
    saveEnvironment,
    canManageEnvironments
  } = useProjectPage();

  return (
    <Modal
      title={environmentMode === 'edit' ? `Edit Environment: ${editingEnvironment?.name ?? ''}` : 'New Environment'}
      open={environmentModalOpen}
      onOk={() => void saveEnvironment()}
      onCancel={() => setEnvironmentModalOpen(false)}
      confirmLoading={environmentSaving}
      width={920}
      centered
      style={{ top: 24 }}
      styles={{
        body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
      }}
      okText={environmentMode === 'edit' ? 'Save changes' : 'Create environment'}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">Environment name</Text>
          <Input
            value={environmentName}
            onChange={(event) => setEnvironmentName(event.target.value)}
            placeholder="Dev"
            disabled={!canManageEnvironments}
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '240px minmax(0, 1fr) 112px',
              gap: 12,
              padding: '0 4px',
              marginBottom: 8
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              Variable name
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Value
            </Text>
            <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
              Actions
            </Text>
          </div>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {environmentRows.map((row, index) => (
              <div
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '240px minmax(0, 1fr) 112px',
                  gap: 12,
                  alignItems: 'start'
                }}
              >
                <Input
                  value={row.key}
                  onChange={(event) =>
                    setEnvironmentRows((current) =>
                      current.map((item, idx) => (idx === index ? { ...item, key: event.target.value } : item))
                    )
                  }
                  placeholder="BASE_URL"
                  disabled={!canManageEnvironments}
                  style={{ width: '100%' }}
                />
                {isSecretKey(row.key) ? (
                  <Input.Password
                    value={row.value}
                    onChange={(event) =>
                      setEnvironmentRows((current) =>
                        current.map((item, idx) => (idx === index ? { ...item, value: event.target.value } : item))
                      )
                    }
                    placeholder="https://dev.example.com"
                    disabled={!canManageEnvironments}
                    style={{ width: '100%' }}
                  />
                ) : (
                  <Input
                    value={row.value}
                    onChange={(event) =>
                      setEnvironmentRows((current) =>
                        current.map((item, idx) => (idx === index ? { ...item, value: event.target.value } : item))
                      )
                    }
                    placeholder="https://dev.example.com"
                    disabled={!canManageEnvironments}
                    style={{ width: '100%' }}
                  />
                )}
                <Button
                  danger
                  onClick={() =>
                    setEnvironmentRows((current) => {
                      if (current.length === 1) return current;
                      return current.filter((_, idx) => idx !== index);
                    })
                  }
                  disabled={!canManageEnvironments || environmentRows.length === 1}
                  style={{ justifySelf: 'end' }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div style={{ display: 'grid', gap: 8 }}>
              <Button type="dashed" block onClick={() => setEnvironmentRows((current) => [...current, createEnvRow()])} disabled={!canManageEnvironments}>
                Add variable
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Use variables in checks as {'{{BASE_URL}}'}, {'{{USERNAME}}'}, or {'{{PASSWORD}}'}.
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Variable names should use uppercase letters, numbers, and underscores.
              </Text>
            </div>
          </Space>
        </div>
      </Space>
    </Modal>
  );
}
