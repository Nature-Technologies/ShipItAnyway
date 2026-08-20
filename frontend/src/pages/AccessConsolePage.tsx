import { useEffect, useState } from 'react';
import { Button, Card, Input, Layout, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import {
  getGroups, createGroup, updateGroup, deleteGroup,
  getUsers, getUserGroups, setUserGroups
} from '../api/client';
import type { Group } from '../types';

const { Content } = Layout;
const { Text } = Typography;

// Full backend Scope enum (underscored) — the gating catalog in utils/scopes is only the subset
// the UI gates on; custom groups may grant any scope.
const ALL_SCOPES = [
  'runs_read', 'runs_trigger', 'checks_read', 'checks_edit',
  'schedules_read', 'schedules_edit', 'environments_read', 'environments_edit',
  'environments_reveal_secrets', 'alerts_read', 'alerts_edit', 'members_read',
  'teams_manage', 'project_manage', 'project_delete'
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupForm, setGroupForm] = useState<{ name: string; scopes: string[] }>({ name: '', scopes: [] });
  const [groupSaving, setGroupSaving] = useState(false);

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

  useEffect(() => { void loadGroups(); void loadUsers(); }, []);

  const openNewGroup = () => {
    setEditingGroup(null);
    setGroupForm({ name: '', scopes: [] });
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: Group) => {
    setEditingGroup(group);
    setGroupForm({ name: group.name, scopes: group.scopes });
    setGroupModalOpen(true);
  };

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
    try {
      await deleteGroup(id);
      message.success('Group deleted');
      await loadGroups();
    } catch (error) {
      message.error(extractError(error, 'Failed to delete group'));
    }
  };

  const handleSetUserGroups = async (userId: string, groupIds: string[]) => {
    try {
      await setUserGroups(userId, groupIds);
      message.success('Groups updated');
    } catch (error) {
      message.error(extractError(error, 'Failed to update groups'));
    } finally {
      await loadUsers(); // reflect the true stored state (e.g. superadmin floor rejection)
    }
  };

  const cardStyle = { borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1560, width: '100%', margin: '0 auto' }}>
        <Typography.Title level={3}>Access console</Typography.Title>
        <Tabs
          items={[
            {
              key: 'groups',
              label: 'Groups',
              children: (
                <Card
                  style={cardStyle}
                  title="Capability groups"
                  extra={<Button type="primary" icon={<PlusOutlined />} onClick={openNewGroup}>New group</Button>}
                >
                  <Table<Group>
                    dataSource={groups}
                    rowKey="id"
                    pagination={false}
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
            },
            {
              key: 'users',
              label: 'Users',
              children: (
                <Card style={cardStyle} title="User group assignment">
                  <Table<UserRow>
                    dataSource={users}
                    rowKey="id"
                    pagination={false}
                    columns={[
                      { title: 'Email', dataIndex: 'email' },
                      { title: 'Groups', render: (_: unknown, row) => (
                        <Select
                          mode="multiple"
                          style={{ minWidth: 320 }}
                          value={row.groupIds}
                          options={groups.map((g) => ({ label: g.name, value: g.id }))}
                          onChange={(ids) => void handleSetUserGroups(row.id, ids)}
                        />
                      ) }
                    ]}
                  />
                </Card>
              )
            }
          ]}
        />
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
            <Input
              value={groupForm.name}
              onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. QA leads"
              style={{ marginTop: 8 }}
            />
          </div>
          <div>
            <Text type="secondary">Scopes</Text>
            <Select
              mode="multiple"
              value={groupForm.scopes}
              onChange={(scopes) => setGroupForm((current) => ({ ...current, scopes }))}
              style={{ width: '100%', marginTop: 8 }}
              options={ALL_SCOPES.map((s) => ({ label: s, value: s }))}
            />
          </div>
        </Space>
      </Modal>
    </Layout>
  );
}
