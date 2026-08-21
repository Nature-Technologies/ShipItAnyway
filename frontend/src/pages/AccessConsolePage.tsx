import { useEffect, useState } from 'react';
import { Button, Card, Input, Layout, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../context/AuthContext';
import {
  getGroups, createGroup, updateGroup, deleteGroup,
  getUsers, getUserGroups, setUserGroups,
  getTeams, getTeam, createTeam, updateTeam, deleteTeam,
  addTeamMember, removeTeamMember, attachTeamToProject, detachTeamFromProject,
  getProjects
} from '../api/client';
import type { Group, Team, TeamDetail } from '../types';

const { Content } = Layout;
const { Text } = Typography;

// Full scope catalog in the API `resource:action` form. The gating catalog in utils/scopes is
// only the subset the UI gates on; custom groups may grant any scope.
const ALL_SCOPES = [
  'runs:read', 'runs:trigger', 'checks:read', 'checks:edit',
  'schedules:read', 'schedules:edit', 'environments:read', 'environments:edit',
  'environments:reveal-secrets', 'alerts:read', 'alerts:edit', 'members:read',
  'teams:manage', 'project:manage', 'project:delete'
];

function extractError(error: unknown, fallback: string) {
  const responseError =
    error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
      : null;
  return typeof responseError === 'string' ? responseError : fallback;
}

type UserRow = { id: string; email: string; groupIds: string[] };

export default function AccessConsolePage() {
  const { isSuperadmin } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupForm, setGroupForm] = useState<{ name: string; scopes: string[] }>({ name: '', scopes: [] });
  const [groupSaving, setGroupSaving] = useState(false);

  // Teams
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamSaving, setTeamSaving] = useState(false);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [allProjects, setAllProjects] = useState<Array<{ id: string; name: string }>>([]);

  const loadGroups = async () => {
    try { setGroups(await getGroups()); } catch (error) { message.error(extractError(error, 'Failed to load groups')); }
  };

  const loadUsers = async () => {
    try {
      const list = await getUsers();
      const withGroups = await Promise.all(list.map(async (u) => ({
        id: u.id, email: u.email,
        groupIds: (await getUserGroups(u.id)).map((g) => g.id)
      })));
      setUsers(withGroups);
    } catch (error) {
      message.error(extractError(error, 'Failed to load users'));
    }
  };

  const loadTeams = async () => {
    try { setTeams(await getTeams()); } catch (error) { message.error(extractError(error, 'Failed to load teams')); }
  };

  useEffect(() => {
    if (isSuperadmin) { void loadGroups(); void loadUsers(); }
    void loadTeams();
    void getProjects().then((ps) => setAllProjects(ps.map((p) => ({ id: p.id, name: p.name })))).catch(() => undefined);
  }, [isSuperadmin]);

  const openNewGroup = () => { setEditingGroup(null); setGroupForm({ name: '', scopes: [] }); setGroupModalOpen(true); };
  const openEditGroup = (group: Group) => { setEditingGroup(group); setGroupForm({ name: group.name, scopes: group.scopes }); setGroupModalOpen(true); };

  const handleSaveGroup = async () => {
    if (!groupForm.name.trim()) { message.error('Name is required'); return; }
    setGroupSaving(true);
    try {
      if (editingGroup) {
        await updateGroup(editingGroup.id, { name: groupForm.name.trim(), scopes: groupForm.scopes });
        message.success('Group updated');
      } else {
        await createGroup({ name: groupForm.name.trim(), scopes: groupForm.scopes });
        message.success('Group created');
      }
      setGroupModalOpen(false);
      await loadGroups();
    } catch (error) {
      message.error(extractError(error, 'Failed to save group'));
    } finally {
      setGroupSaving(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try { await deleteGroup(id); message.success('Group deleted'); await loadGroups(); }
    catch (error) { message.error(extractError(error, 'Failed to delete group')); }
  };

  const handleSetUserGroups = async (userId: string, groupIds: string[]) => {
    try { await setUserGroups(userId, groupIds); message.success('Groups updated'); }
    catch (error) { message.error(extractError(error, 'Failed to update groups')); }
    finally { await loadUsers(); }
  };

  const openNewTeam = () => { setEditingTeam(null); setTeamName(''); setTeamModalOpen(true); };
  const openEditTeam = (team: Team) => { setEditingTeam(team); setTeamName(team.name); setTeamModalOpen(true); };

  const handleSaveTeam = async () => {
    if (!teamName.trim()) { message.error('Name is required'); return; }
    setTeamSaving(true);
    try {
      if (editingTeam) { await updateTeam(editingTeam.id, { name: teamName.trim() }); message.success('Team renamed'); }
      else { await createTeam({ name: teamName.trim() }); message.success('Team created'); }
      setTeamModalOpen(false);
      await loadTeams();
    } catch (error) {
      message.error(extractError(error, 'Failed to save team'));
    } finally {
      setTeamSaving(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    try { await deleteTeam(id); message.success('Team deleted'); await loadTeams(); }
    catch (error) { message.error(extractError(error, 'Failed to delete team')); }
  };

  const openDetail = async (id: string) => {
    try { setDetail(await getTeam(id)); } catch (error) { message.error(extractError(error, 'Failed to load team')); }
  };
  const refreshDetail = async () => { if (detail) setDetail(await getTeam(detail.id)); };

  const handleAddMember = async (userId: string) => {
    if (!detail) return;
    try { await addTeamMember(detail.id, userId); await refreshDetail(); await loadTeams(); }
    catch (error) { message.error(extractError(error, 'Failed to add member')); }
  };
  const handleRemoveMember = async (userId: string) => {
    if (!detail) return;
    try { await removeTeamMember(detail.id, userId); await refreshDetail(); await loadTeams(); }
    catch (error) { message.error(extractError(error, 'Failed to remove member')); }
  };
  const handleAttach = async (projectId: string) => {
    if (!detail) return;
    try { await attachTeamToProject(detail.id, projectId); await refreshDetail(); await loadTeams(); }
    catch (error) { message.error(extractError(error, 'Failed to attach project')); }
  };
  const handleDetach = async (projectId: string) => {
    if (!detail) return;
    try { await detachTeamFromProject(detail.id, projectId); await refreshDetail(); await loadTeams(); }
    catch (error) { message.error(extractError(error, 'Failed to detach project')); }
  };

  const cardStyle = { borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' };

  const groupsTab = {
    key: 'groups',
    label: 'Groups',
    children: (
      <Card style={cardStyle} title="Capability groups"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openNewGroup}>New group</Button>}>
        <Table<Group>
          dataSource={groups} rowKey="id" pagination={false}
          columns={[
            { title: 'Name', render: (_: unknown, row) => (
              <Space size={6}><Text strong>{row.name}</Text>{row.isSystem && <Tag color="gold">System</Tag>}{row.isGlobal && <Tag color="red">Global</Tag>}</Space>
            ) },
            { title: 'Scopes', render: (_: unknown, row) => (
              <Space size={4} wrap>{row.scopes.map((s) => <Tag key={s} color="blue">{s}</Tag>)}</Space>
            ) },
            { title: 'Actions', render: (_: unknown, row) => row.isSystem ? <Text type="secondary">Read-only</Text> : (
              <Space>
                <Button size="small" onClick={() => openEditGroup(row)}>Edit</Button>
                <Button size="small" danger onClick={() => void handleDeleteGroup(row.id)}>Delete</Button>
              </Space>
            ) }
          ]}
        />
      </Card>
    )
  };

  const usersTab = {
    key: 'users',
    label: 'Users',
    children: (
      <Card style={cardStyle} title="User group assignment">
        <Table<UserRow>
          dataSource={users} rowKey="id" pagination={false}
          columns={[
            { title: 'Email', dataIndex: 'email' },
            { title: 'Groups', render: (_: unknown, row) => (
              <Select mode="multiple" style={{ minWidth: 320 }} value={row.groupIds}
                options={groups.map((g) => ({ label: g.name, value: g.id }))}
                onChange={(ids) => void handleSetUserGroups(row.id, ids)} />
            ) }
          ]}
        />
      </Card>
    )
  };

  const teamsTab = {
    key: 'teams',
    label: 'Teams',
    children: (
      <Card style={cardStyle} title="Teams (membership)"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openNewTeam}>New team</Button>}>
        <Text type="secondary">
          Teams are global collections of users assigned to projects — they grant project access, not capability.
        </Text>
        <Table<Team>
          style={{ marginTop: 16 }}
          dataSource={teams} rowKey="id" pagination={false}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (name: string) => <Text strong>{name}</Text> },
            { title: 'Members', dataIndex: 'memberCount' },
            { title: 'Projects', dataIndex: 'projectCount' },
            { title: 'Actions', render: (_: unknown, row) => (
              <Space>
                <Button size="small" onClick={() => void openDetail(row.id)}>Manage</Button>
                <Button size="small" onClick={() => openEditTeam(row)}>Rename</Button>
                <Button size="small" danger onClick={() => void handleDeleteTeam(row.id)}>Delete</Button>
              </Space>
            ) }
          ]}
        />
      </Card>
    )
  };

  const tabs = [
    ...(isSuperadmin ? [groupsTab, usersTab] : []),
    teamsTab
  ];

  const attachableProjects = allProjects.filter((p) => !detail?.projects.some((dp) => dp.projectId === p.id));
  const addableUsers = users.filter((u) => !detail?.members.some((m) => m.userId === u.id));

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1560, width: '100%', margin: '0 auto' }}>
        <Typography.Title level={3}>Access console</Typography.Title>
        <Tabs items={tabs} />
      </Content>
      <AppFooter />

      <Modal
        title={editingGroup ? 'Edit group' : 'New group'}
        open={groupModalOpen}
        onCancel={() => setGroupModalOpen(false)}
        confirmLoading={groupSaving}
        onOk={() => void handleSaveGroup()}
        okText={editingGroup ? 'Save' : 'Create'}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">Name</Text>
            <Input value={groupForm.name}
              onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. QA leads" style={{ marginTop: 8 }} />
          </div>
          <div>
            <Text type="secondary">Scopes</Text>
            <Select mode="multiple" value={groupForm.scopes}
              onChange={(scopes) => setGroupForm((current) => ({ ...current, scopes }))}
              style={{ width: '100%', marginTop: 8 }}
              options={ALL_SCOPES.map((s) => ({ label: s, value: s }))} />
          </div>
        </Space>
      </Modal>

      <Modal
        title={editingTeam ? 'Rename team' : 'New team'}
        open={teamModalOpen}
        onCancel={() => setTeamModalOpen(false)}
        confirmLoading={teamSaving}
        onOk={() => void handleSaveTeam()}
        okText={editingTeam ? 'Save' : 'Create'}
      >
        <Text type="secondary">Team name</Text>
        <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Web QA" style={{ marginTop: 8 }} />
      </Modal>

      <Modal
        title={detail ? `Manage team — ${detail.name}` : 'Manage team'}
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={<Button type="primary" onClick={() => setDetail(null)}>Close</Button>}
        width={640}
      >
        {detail && (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <div>
              <Text strong>Members</Text>
              <div style={{ marginTop: 8 }}>
                <Space size={4} wrap>
                  {detail.members.length === 0 && <Text type="secondary">No members</Text>}
                  {detail.members.map((m) => (
                    <Tag key={m.userId} closable onClose={(e) => { e.preventDefault(); void handleRemoveMember(m.userId); }}>
                      {m.email}
                    </Tag>
                  ))}
                </Space>
              </div>
              <Select<string> showSearch style={{ width: '100%', marginTop: 8 }} placeholder="Add a user…"
                value={undefined} optionFilterProp="label"
                options={addableUsers.map((u) => ({ label: u.email, value: u.id }))}
                onChange={(userId) => void handleAddMember(userId)} />
            </div>
            <div>
              <Text strong>Projects</Text>
              <div style={{ marginTop: 8 }}>
                <Space size={4} wrap>
                  {detail.projects.length === 0 && <Text type="secondary">Not attached to any project</Text>}
                  {detail.projects.map((p) => (
                    <Tag key={p.projectId} color="blue" closable onClose={(e) => { e.preventDefault(); void handleDetach(p.projectId); }}>
                      {p.name}
                    </Tag>
                  ))}
                </Space>
              </div>
              <Select<string> showSearch style={{ width: '100%', marginTop: 8 }} placeholder="Attach a project…"
                value={undefined} optionFilterProp="label"
                options={attachableProjects.map((p) => ({ label: p.name, value: p.id }))}
                onChange={(projectId) => void handleAttach(projectId)} />
            </div>
          </Space>
        )}
      </Modal>
    </Layout>
  );
}
