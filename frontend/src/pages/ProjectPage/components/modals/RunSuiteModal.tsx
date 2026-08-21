import { Button, Empty, Modal, Radio, Space, Tag, Typography } from 'antd';
import { useProjectPage } from '../../hooks/useProjectPage';

const { Text } = Typography;

export default function RunSuiteModal() {
  const {
    projectId,
    navigate,
    runSuiteModalOpen,
    setRunSuiteModalOpen,
    runningSuite,
    handleRunSuite,
    suites,
    runSuiteItems,
    selectedSuiteId,
    setSelectedSuiteId,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    environments
  } = useProjectPage();

  return (
    <Modal
      title="Run Suite"
      open={runSuiteModalOpen}
      onOk={() => void handleRunSuite()}
      onCancel={() => setRunSuiteModalOpen(false)}
      confirmLoading={runningSuite}
      okButtonProps={{ disabled: suites.length === 0 }}
    >
      {suites.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={4}>
              <Text strong>No suites yet</Text>
              <Text type="secondary">Create a suite to run multiple browser checks together.</Text>
            </Space>
          }
        >
          <Button type="primary" onClick={() => navigate(`/projects/${projectId}/suites`)}>
            Create suite
          </Button>
        </Empty>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary">Suite</Text>
            <Radio.Group
              style={{ display: 'grid', gap: 12, width: '100%', marginTop: 8 }}
              value={selectedSuiteId}
              onChange={(event) => setSelectedSuiteId(event.target.value)}
            >
              {runSuiteItems.map((suite) => (
                <Radio key={suite.value} value={suite.value}>
                  {suite.label}
                </Radio>
              ))}
            </Radio.Group>
          </div>
          <div>
            <Text type="secondary">Environment</Text>
            <Radio.Group
              style={{ display: 'grid', gap: 12, width: '100%', marginTop: 8 }}
              value={selectedEnvironmentId ?? ''}
              onChange={(event) => setSelectedEnvironmentId(event.target.value || undefined)}
            >
              <Radio value="">No environment (use values as-is)</Radio>
              {environments.map((environment) => (
                <Radio key={environment.id} value={environment.id}>
                  {environment.name}
                  <Tag style={{ marginLeft: 8 }}>{Object.keys(environment.variables).length} variables</Tag>
                </Radio>
              ))}
            </Radio.Group>
          </div>
        </Space>
      )}
    </Modal>
  );
}
