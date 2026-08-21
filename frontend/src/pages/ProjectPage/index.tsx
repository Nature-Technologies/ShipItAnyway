import { Alert, Button, Card, Col, Layout, Row, Space, Statistic, Tabs, Tag, Typography, Upload } from 'antd';
import { PlayCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import AppHeader from '../../components/AppHeader';
import AppFooter from '../../components/AppFooter';
import RunStatusBadge from '../../components/RunStatusBadge';
import UserMenu from '../../components/UserMenu';
import { ScheduleFormModal } from '../../components/ScheduleFormModal';
import { ProjectPageProvider, useProjectPage } from './hooks/useProjectPage';
import { formatCreatedLabel, formatDuration, type ProjectTabKey } from './utils';
import OverviewTab from './components/tabs/OverviewTab';
import ChecksTab from './components/tabs/ChecksTab';
import RunsTab from './components/tabs/RunsTab';
import SchedulesTab from './components/tabs/SchedulesTab';
import EnvironmentsTab from './components/tabs/EnvironmentsTab';
import AlertsTab from './components/tabs/AlertsTab';
import SettingsTab from './components/tabs/SettingsTab';
import MembersTab from './components/tabs/MembersTab';
import RunCheckModal from './components/modals/RunCheckModal';
import RunSuiteModal from './components/modals/RunSuiteModal';
import EnvironmentModal from './components/modals/EnvironmentModal';
import ChannelModal from './components/modals/ChannelModal';
import DeleteProjectModal from './components/modals/DeleteProjectModal';
import InviteModal from './components/modals/InviteModal';

const { Content } = Layout;
const { Title, Text } = Typography;

function ProjectPageShell() {
  const {
    projectId,
    navigate,
    project,
    summary,
    gates,
    canWriteProject,
    canManageMembers,
    projectHeaderDescription,
    importing,
    handleImport,
    openRunSuiteModal,
    activeTab,
    setActiveTab,
    confirmModalContextHolder,
    // schedule modal
    scheduleModalOpen,
    scheduleMode,
    editingSchedule,
    suites,
    projectChecks,
    environments,
    scheduleSaving,
    setScheduleModalOpen,
    saveSchedule
  } = useProjectPage();

  const tabs: { key: ProjectTabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'checks', label: 'Checks' },
    { key: 'runs', label: 'Runs' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'environments', label: 'Environments' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'settings', label: 'Settings' },
    ...(canManageMembers ? [{ key: 'members' as const, label: 'Members' }] : [])
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 48%, #ffffff 100%)' }}>
      {confirmModalContextHolder}
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1560, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 24, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <Text type="secondary">
                      <Link to="/projects">Projects</Link>
                    </Text>
                    <Title level={2} style={{ margin: 0 }}>
                      {project?.name ?? 'Loading...'}
                    </Title>
                    <Text
                      type="secondary"
                      style={{
                        maxWidth: 760,
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {projectHeaderDescription}
                    </Text>
                    {gates.readOnly && (
                      <Alert
                        type="info"
                        showIcon
                        message="Read-only access"
                        description="You can view this project, but you cannot make changes."
                        style={{ marginTop: 8, width: 'fit-content' }}
                      />
                    )}
                    {project && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCreatedLabel(project.createdAt)}
                      </Text>
                    )}
                  </div>

                  <Space wrap>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`/projects/${projectId}/tests/new`)} disabled={!canWriteProject}>
                      New Check
                    </Button>
                    <Upload
                      accept=".ts,.js"
                      showUploadList={false}
                      disabled={!canWriteProject}
                      beforeUpload={(file) => {
                        void handleImport(file);
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />} loading={importing} disabled={!canWriteProject}>
                        Import .spec.ts
                      </Button>
                    </Upload>
                    <Button icon={<PlayCircleOutlined />} onClick={openRunSuiteModal} disabled={!canWriteProject}>
                      Run suite
                    </Button>
                  </Space>
                </div>

                <Tabs
                  activeKey={activeTab}
                  items={tabs.map((tab) => ({ key: tab.key, label: tab.label }))}
                  onChange={(key) => setActiveTab(key as ProjectTabKey)}
                />
              </div>
            </Card>
          </Col>

          <Col span={24}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic title="Checks" value={summary?.checksCount ?? 0} />
                  <Text type="secondary">Browser checks in this project</Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Text type="secondary">Last result</Text>
                    {summary?.lastResult ? (
                      <RunStatusBadge status={summary.lastResult} />
                    ) : (
                      <Tag color="default">No runs</Tag>
                    )}
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Text type="secondary">Pass rate</Text>
                    <Text
                      style={{
                        fontSize: 28,
                        lineHeight: 1.1,
                        fontWeight: 600,
                        color:
                          summary?.passRate30d == null ? '#8c8c8c' : summary.passRate30d >= 80 ? '#52c41a' : '#ff4d4f'
                      }}
                    >
                      {summary?.passRate30d == null ? '—' : `${summary.passRate30d}%`}
                    </Text>
                    <Text type="secondary">
                      {summary?.totalRuns30d ? `${summary.passedRuns30d}/${summary.totalRuns30d} runs in last 30 days` : 'No runs yet'}
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic title="Active schedules" value={summary?.activeSchedulesCount ?? 0} />
                  <Text type="secondary">Project-level schedules</Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic title="Alert channels" value={summary?.alertChannelsCount ?? 0} />
                  <Text type="secondary">Telegram and Slack</Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic
                    title="Avg duration"
                    value={summary?.avgDurationMs != null ? formatDuration(summary.avgDurationMs) : '—'}
                  />
                  <Text type="secondary">
                    {summary?.failedChecks ? `${summary.failedChecks} failing checks` : 'Healthy checks'}
                  </Text>
                </Card>
              </Col>
            </Row>
          </Col>

          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'checks' && <ChecksTab />}
          {activeTab === 'runs' && <RunsTab />}
          {activeTab === 'schedules' && <SchedulesTab />}
          {activeTab === 'environments' && <EnvironmentsTab />}
          {activeTab === 'alerts' && <AlertsTab />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'members' && canManageMembers && <MembersTab />}
        </Row>
      </Content>

      <RunCheckModal />
      <RunSuiteModal />
      <EnvironmentModal />
      <ChannelModal />
      <ScheduleFormModal
        open={scheduleModalOpen}
        mode={scheduleMode}
        schedule={editingSchedule}
        suites={suites}
        checks={projectChecks}
        environments={environments}
        saving={scheduleSaving}
        onCancel={() => setScheduleModalOpen(false)}
        onSubmit={(payload) => void saveSchedule(payload)}
      />
      <DeleteProjectModal />
      <InviteModal />
      <AppFooter />
    </Layout>
  );
}

export default function ProjectPage() {
  return (
    <ProjectPageProvider>
      <ProjectPageShell />
    </ProjectPageProvider>
  );
}
