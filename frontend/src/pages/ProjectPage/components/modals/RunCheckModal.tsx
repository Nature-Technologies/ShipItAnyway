import { Modal, Radio, Tag } from 'antd';
import { useProjectPage } from '../../hooks/useProjectPage';

export default function RunCheckModal() {
  const {
    runCheckModalOpen,
    setRunCheckModalOpen,
    checkRunLoading,
    handleConfirmCheckRun,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    environments
  } = useProjectPage();

  return (
    <Modal
      title="Select Environment"
      open={runCheckModalOpen}
      onOk={() => void handleConfirmCheckRun()}
      onCancel={() => setRunCheckModalOpen(false)}
      confirmLoading={checkRunLoading}
    >
      <Radio.Group
        style={{ display: 'grid', gap: 12, width: '100%' }}
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
    </Modal>
  );
}
