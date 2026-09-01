import { Input, Modal, Select, Space, Typography } from 'antd';
import { useProjectPage } from '../../hooks/useProjectPage';

const { Text } = Typography;

export default function InviteModal() {
  const {
    inviteModalOpen,
    setInviteModalOpen,
    inviteSaving,
    inviteForm,
    setInviteForm,
    handleCreateInvite,
    teams,
    groups,
    isSuperadmin
  } = useProjectPage();

  return (
    <Modal
      title="Invite a user"
      open={inviteModalOpen}
      onCancel={() => setInviteModalOpen(false)}
      confirmLoading={inviteSaving}
      onOk={() => void handleCreateInvite()}
      okText="Send invite"
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">Email</Text>
          <Input
            value={inviteForm.email}
            onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="teammate@company.com"
            style={{ marginTop: 8 }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            The invitee receives a link to set a password. They join with the team&apos;s access.
          </Text>
        </div>
        <div>
          <Text type="secondary">Team (membership)</Text>
          <Select
            allowClear
            value={inviteForm.teamId}
            onChange={(value) => setInviteForm((current) => ({ ...current, teamId: value as string | undefined }))}
            style={{ width: '100%', marginTop: 8 }}
            placeholder="Add to a team on this project"
            options={teams.map((t) => ({ label: t.name, value: t.id }))}
          />
        </div>
        {isSuperadmin && (
          <div>
            <Text type="secondary">Capability group (superadmin only)</Text>
            <Select
              allowClear
              value={inviteForm.groupId}
              onChange={(value) => setInviteForm((current) => ({ ...current, groupId: value as string | undefined }))}
              style={{ width: '100%', marginTop: 8 }}
              placeholder="Grant a global capability group"
              options={groups.map((g) => ({ label: g.name, value: g.id }))}
            />
          </div>
        )}
      </Space>
    </Modal>
  );
}
