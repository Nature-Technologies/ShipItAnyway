import { Button, Input, Modal, Space, Typography } from 'antd';
import { useProjectPage } from '../../hooks/useProjectPage';

const { Text } = Typography;

export default function DeleteProjectModal() {
  const {
    project,
    deleteProjectModalOpen,
    setDeleteProjectModalOpen,
    deletingProject,
    deleteProjectReady,
    deleteProjectConfirmText,
    setDeleteProjectConfirmText,
    handleDeleteProject
  } = useProjectPage();

  return (
    <Modal
      title="Delete project?"
      open={deleteProjectModalOpen}
      onCancel={() => setDeleteProjectModalOpen(false)}
      centered
      confirmLoading={deletingProject}
      footer={
        <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={() => setDeleteProjectModalOpen(false)} disabled={deletingProject}>
            Cancel
          </Button>
          <Button
            danger
            onClick={() => void handleDeleteProject()}
            loading={deletingProject}
            disabled={!deleteProjectReady || deletingProject}
          >
            Delete project
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Text type="secondary">
          This action cannot be undone. It will permanently delete this project and all related data:
          {' '}
          checks, schedules, environments, alert channels, run history, screenshots, and traces.
        </Text>
        <div>
          <Text type="secondary">Type project name to confirm</Text>
          <Input
            value={deleteProjectConfirmText}
            onChange={(event) => setDeleteProjectConfirmText(event.target.value)}
            placeholder={project?.name ?? 'Project name'}
            style={{ marginTop: 8 }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            Type &quot;{project?.name ?? 'project'}&quot; to enable deletion.
          </Text>
        </div>
      </Space>
    </Modal>
  );
}
