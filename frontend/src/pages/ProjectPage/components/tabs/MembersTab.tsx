import { Button, Card, Col, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { Invite, ProjectMember } from '../../../../types';
import { useProjectPage } from '../../hooks/useProjectPage';

const { Text } = Typography;

export default function MembersTab() {
  const {
    projectMembers,
    canManageTeams,
    openInvite,
    attachedTeams,
    attachedTeamIds,
    teams,
    invites,
    handleDetachTeam,
    handleAttachExistingTeam,
    handleRevokeInvite
  } = useProjectPage();

  return (
    <Col span={24}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card
          style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
          title="Project members"
          extra={canManageTeams && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openInvite}>Invite</Button>
          )}
        >
          <Table<ProjectMember>
            dataSource={projectMembers}
            rowKey="userId"
            pagination={false}
            locale={{ emptyText: 'No members yet' }}
            columns={[
              { title: 'Email', render: (_: unknown, row) => <Text strong>{row.email}</Text> },
              {
                title: 'Teams',
                render: (_: unknown, row) => (
                  <Space size={4} wrap>{row.teams.map((t) => <Tag key={t.id}>{t.name}</Tag>)}</Space>
                )
              },
              {
                title: 'Effective scopes',
                render: (_: unknown, row) => (
                  <Space size={4} wrap>{row.scopes.map((s) => <Tag key={s} color="blue">{s}</Tag>)}</Space>
                )
              }
            ]}
          />
        </Card>

        {canManageTeams && (
          <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Teams">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text type="secondary">
                Attach an existing team to grant its members access to this project. Create and
                manage teams globally in the Access console.
              </Text>
              <Space size={4} wrap>
                {attachedTeams.length === 0 && <Text type="secondary">No teams attached</Text>}
                {attachedTeams.map((t) => (
                  <Tag
                    key={t.id}
                    color="blue"
                    closable
                    onClose={(e) => { e.preventDefault(); void handleDetachTeam(t.id); }}
                  >
                    {t.name}
                  </Tag>
                ))}
              </Space>
              <Select<string>
                showSearch
                style={{ width: '100%', maxWidth: 420 }}
                placeholder="Attach a team…"
                value={undefined}
                options={teams.filter((t) => !attachedTeamIds.has(t.id)).map((t) => ({ label: t.name, value: t.id }))}
                onChange={(teamId) => { if (teamId) void handleAttachExistingTeam(teamId); }}
                filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              />
            </Space>
          </Card>
        )}

        {canManageTeams && (
          <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Pending invites">
            <Table<Invite>
              dataSource={invites.filter((i) => i.status === 'PENDING')}
              rowKey="id"
              pagination={false}
              locale={{ emptyText: 'No pending invites' }}
              columns={[
                { title: 'Email', dataIndex: 'email' },
                { title: 'Created', render: (_: unknown, row) => new Date(row.createdAt).toLocaleString() },
                {
                  title: 'Actions',
                  render: (_: unknown, row) => (
                    <Button size="small" danger onClick={() => void handleRevokeInvite(row.id)}>Revoke</Button>
                  )
                }
              ]}
            />
          </Card>
        )}
      </Space>
    </Col>
  );
}
