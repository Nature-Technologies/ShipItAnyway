import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Checkbox, Col, Input, Layout, Modal, Popconfirm, Radio, Row, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createSuite, deleteSuite, getEnvironments, getProject, getSuites, runSuite, updateSuite } from '../api/client';
import { qk } from '../lib/queryKeys';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import type { Suite, Test } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function suiteTestNames(suite: Suite, tests: Test[]) {
  const byId = new Map(tests.map((test) => [test.id, test.name]));
  return Array.isArray(suite.testIds) ? suite.testIds.map((id) => byId.get(id) ?? id) : [];
}

export default function SuitesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projectQuery = useQuery({
    queryKey: qk.project(projectId!),
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId)
  });
  const suitesQuery = useQuery({
    queryKey: qk.projectSuites(projectId!),
    queryFn: () => getSuites(projectId!),
    enabled: Boolean(projectId)
  });
  const environmentsQuery = useQuery({
    queryKey: qk.projectEnvironments(projectId!),
    queryFn: () => getEnvironments(projectId!),
    enabled: Boolean(projectId)
  });
  const project = projectQuery.data ?? null;
  const suites = suitesQuery.data ?? [];
  const environments = environmentsQuery.data ?? [];
  const loading = projectQuery.isLoading || suitesQuery.isLoading || environmentsQuery.isLoading;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSuite, setEditingSuite] = useState<Suite | null>(null);
  const [name, setName] = useState('');
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runSuiteId, setRunSuiteId] = useState<string | null>(null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(undefined);

  const invalidateSuites = () => qc.invalidateQueries({ queryKey: qk.projectSuites(projectId!) });
  const createMutation = useMutation({
    mutationFn: (payload: { name: string; testIds: string[] }) => createSuite(projectId!, payload),
    onSuccess: invalidateSuites
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; testIds: string[] } }) =>
      updateSuite(id, payload),
    onSuccess: invalidateSuites
  });
  const deleteMutation = useMutation({ mutationFn: deleteSuite, onSuccess: invalidateSuites });
  const runMutation = useMutation({
    mutationFn: ({ suiteId, environmentId }: { suiteId: string; environmentId?: string }) =>
      runSuite(suiteId, environmentId)
  });
  const saving = createMutation.isPending || updateMutation.isPending;

  const projectTests = useMemo(() => project?.tests ?? [], [project]);

  const openCreate = () => {
    setEditingSuite(null);
    setName('');
    setSelectedTestIds([]);
    setModalOpen(true);
  };

  const openEdit = (suite: Suite) => {
    setEditingSuite(suite);
    setName(suite.name);
    setSelectedTestIds(Array.isArray(suite.testIds) ? suite.testIds : []);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      message.error('Suite name is required');
      return;
    }

    if (selectedTestIds.length === 0) {
      message.error('Select at least one test');
      return;
    }

    const payload = { name: name.trim(), testIds: selectedTestIds };
    if (editingSuite) {
      await updateMutation.mutateAsync({ id: editingSuite.id, payload });
      message.success('Suite updated');
    } else {
      await createMutation.mutateAsync(payload);
      message.success('Suite created');
    }
    setModalOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
    message.success('Suite deleted');
  };

  const handleRun = async (suiteId: string) => {
    if (environments.length === 0) {
      await runMutation.mutateAsync({ suiteId });
      message.success('Suite queued');
      navigate('/dashboard');
      return;
    }

    setRunSuiteId(suiteId);
    setSelectedEnvironmentId(undefined);
    setRunModalOpen(true);
  };

  const handleConfirmRun = async () => {
    if (!runSuiteId) return;

    try {
      await runMutation.mutateAsync({ suiteId: runSuiteId, environmentId: selectedEnvironmentId });
      setRunModalOpen(false);
      message.success('Suite queued');
      navigate('/dashboard');
    } catch {
      message.error('Failed to run suite');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text type="secondary">
                    <Link to={`/projects/${projectId}`}>Project</Link>
                    <Link to="/dashboard" style={{ marginLeft: 16 }}>Dashboard</Link>
                  </Text>
                  <Title level={2} style={{ margin: 0 }}>{project?.name ?? 'Loading...'}</Title>
                  <Text type="secondary">Reusable test suites you can run with one button.</Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  New Suite
                </Button>
              </Space>
            </Card>
          </Col>

          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Table
                dataSource={suites}
                rowKey="id"
                loading={loading}
                pagination={false}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  {
                    title: 'Tests',
                    render: (_, row) => (
                      <Space wrap>
                        <Tag color="blue">{Array.isArray(row.testIds) ? row.testIds.length : 0} tests</Tag>
                        {suiteTestNames(row, projectTests).slice(0, 3).map((testName) => (
                          <Tag key={testName}>{testName}</Tag>
                        ))}
                      </Space>
                    )
                  },
                  {
                    title: 'Schedules',
                    dataIndex: ['_count', 'schedules'],
                    render: (value: number | undefined) => <Tag color="purple">{value ?? 0}</Tag>
                  },
                  {
                    title: 'Updated',
                    dataIndex: 'updatedAt',
                    render: (value: string) => formatTime(value)
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Space onClick={(event) => event.stopPropagation()}>
                        <Button icon={<PlayCircleOutlined />} size="small" type="primary" onClick={() => void handleRun(row.id)}>
                          Run
                        </Button>
                        <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Popconfirm title="Delete suite?" onConfirm={() => void handleDelete(row.id)}>
                          <Button danger icon={<DeleteOutlined />} size="small">
                            Delete
                          </Button>
                        </Popconfirm>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Content>

      <Modal
        title={editingSuite ? `Edit Suite: ${editingSuite.name}` : 'New Suite'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={840}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary">Suite name</Text>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Smoke tests" />
          </div>

          <div>
            <Text type="secondary">Select tests</Text>
            <div style={{ marginTop: 8 }}>
              <Checkbox.Group value={selectedTestIds} onChange={(values) => setSelectedTestIds(values as string[])}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {projectTests.map((test) => (
                    <Checkbox key={test.id} value={test.id}>
                      {test.name}
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {test.url}
                      </Typography.Text>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </div>
          </div>
        </Space>
      </Modal>

      <Modal
        title="Run Suite"
        open={runModalOpen}
        onOk={() => void handleConfirmRun()}
        onCancel={() => setRunModalOpen(false)}
        confirmLoading={runMutation.isPending}
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
      <AppFooter />
    </Layout>
  );
}
