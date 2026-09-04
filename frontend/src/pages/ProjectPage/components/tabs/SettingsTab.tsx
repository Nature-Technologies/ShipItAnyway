import { useEffect, useState } from 'react';
import { Button, Card, Col, Input, Row, Select, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectPage } from '../../hooks/useProjectPage';
import { DEFAULT_DEVICE_OPTIONS, formatCompactDateTime, formatDateTime } from '../../utils';
import { getProjectGithubConfig, setProjectGithubConfig } from '../../../../api/client';
import { qk } from '../../../../lib/queryKeys';

const { Text } = Typography;

export default function SettingsTab() {
  const {
    project,
    summary,
    projectChecks,
    environments,
    channels,
    gates,
    isSuperadmin,
    projectId,
    projectName,
    setProjectName,
    projectNameError,
    setProjectNameError,
    projectDescription,
    setProjectDescription,
    projectDescriptionError,
    setProjectDescriptionError,
    projectDefaultEnvironmentId,
    setProjectDefaultEnvironmentId,
    projectDefaultDevice,
    setProjectDefaultDevice,
    savingProject,
    handleSaveProject,
    handleResetProjectSettings,
    openDeleteProjectModal
  } = useProjectPage();

  const qc = useQueryClient();
  const [ghRepo, setGhRepo] = useState('');
  const [ghPat, setGhPat] = useState('');
  const canEditGithub = isSuperadmin || gates.canManageProject;

  const githubQuery = useQuery({
    queryKey: qk.projectGithubConfig(projectId ?? ''),
    queryFn: () => getProjectGithubConfig(projectId!),
    enabled: Boolean(projectId) && canEditGithub
  });
  const ghConfig = githubQuery.data;

  useEffect(() => {
    if (ghConfig?.repo && !ghRepo) setGhRepo(ghConfig.repo);
  }, [ghConfig?.repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveGithubMutation = useMutation({
    mutationFn: () =>
      setProjectGithubConfig(projectId!, {
        repo: ghRepo.trim(),
        ...(ghPat.trim() ? { pat: ghPat.trim() } : {})
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectGithubConfig(projectId ?? '') });
      setGhPat('');
      void message.success('GitHub config saved');
    },
    onError: () => { void message.error('Failed to save GitHub config'); }
  });

  return (
    <Col span={24}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <Row gutter={[24, 24]}>
          <Col xs={24} xl={14}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Project settings">
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12}>
                    <div>
                      <Text type="secondary">Project name</Text>
                      <Input
                        value={projectName}
                        disabled={gates.readOnly}
                        onChange={(event) => {
                          setProjectName(event.target.value);
                          if (event.target.value.trim()) setProjectNameError(null);
                        }}
                        placeholder="Project name"
                        style={{ marginTop: 8 }}
                        status={projectNameError ? 'error' : undefined}
                      />
                      {projectNameError ? (
                        <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                          {projectNameError}
                        </Text>
                      ) : null}
                    </div>
                  </Col>
                  <Col xs={24} md={12}>
                    <div>
                      <Text type="secondary">Default environment</Text>
                      <Select
                        value={environments.length === 0 ? '' : projectDefaultEnvironmentId}
                        disabled={gates.readOnly || environments.length === 0}
                        onChange={(value) => setProjectDefaultEnvironmentId(value)}
                        placeholder="No default environment"
                        style={{ marginTop: 8, width: '100%' }}
                        options={[
                          { label: 'No default environment', value: '' },
                          ...environments.map((environment) => ({ label: environment.name, value: environment.id }))
                        ]}
                      />
                    </div>
                  </Col>
                  <Col xs={24} md={12}>
                    <div>
                      <Text type="secondary">Description</Text>
                      <Input.TextArea
                        value={projectDescription}
                        disabled={gates.readOnly}
                        onChange={(event) => {
                          setProjectDescription(event.target.value);
                          if (event.target.value.length <= 500) setProjectDescriptionError(null);
                        }}
                        placeholder="Describe what this project monitors"
                        autoSize={{ minRows: 3, maxRows: 4 }}
                        maxLength={500}
                        style={{ marginTop: 8 }}
                        status={projectDescriptionError ? 'error' : undefined}
                      />
                      <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 6 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Optional. Up to 500 characters.
                        </Text>
                        {projectDescriptionError ? (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {projectDescriptionError}
                          </Text>
                        ) : null}
                      </Space>
                    </div>
                  </Col>
                  <Col xs={24} md={12}>
                    <div>
                      <Text type="secondary">Default device</Text>
                      <Select
                        value={projectDefaultDevice}
                        disabled={gates.readOnly}
                        onChange={(value) => setProjectDefaultDevice(value)}
                        style={{ marginTop: 8, width: '100%' }}
                        options={DEFAULT_DEVICE_OPTIONS.map((device) => ({ label: device, value: device }))}
                      />
                    </div>
                  </Col>
                </Row>
                <Space wrap>
                  <Button type="primary" loading={savingProject} onClick={() => void handleSaveProject()} disabled={gates.readOnly}>
                    Save changes
                  </Button>
                  <Button onClick={handleResetProjectSettings} disabled={!project || gates.readOnly}>
                    Reset
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Metadata">
              <Row gutter={[12, 12]}>
                <Col span={24}>
                  <div
                    style={{
                      padding: '12px 14px',
                      border: '1px solid #f1f5f9',
                      borderRadius: 14,
                      background: '#fafcff'
                    }}
                  >
                    <Text type="secondary">Project ID</Text>
                    <Text code style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                      {project?.id ?? '—'}
                    </Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Created</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>
                      {project ? formatDateTime(project.createdAt) : '—'}
                    </Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Checks</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>{summary?.checksCount ?? 0}</Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Runs</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>
                      {summary?.totalRuns30d ?? projectChecks.reduce((count, check) => count + check.runCount, 0) ?? 0}
                    </Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Schedules</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>{summary?.activeSchedulesCount ?? 0}</Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Environments</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>{environments.length}</Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Alert channels</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>{channels.length}</Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Last run</Text>
                    <Text style={{ display: 'block', marginTop: 4 }}>
                      {summary?.lastRunAt ? formatCompactDateTime(summary.lastRunAt) : '—'}
                    </Text>
                  </div>
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                    <Text type="secondary">Last result</Text>
                    <div style={{ marginTop: 4 }}>
                      {summary?.lastResult === 'PASSED' ? (
                        <Tag color="green">Passed</Tag>
                      ) : summary?.lastResult === 'FAILED' ? (
                        <Tag color="red">Failed</Tag>
                      ) : (
                        <Tag color="default">No runs</Tag>
                      )}
                    </div>
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
        {canEditGithub && (
          <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="GitHub CI">
            <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 480 }}>
              <div>
                <Text type="secondary">Repository (owner/repo)</Text>
                <Input
                  value={ghRepo}
                  onChange={(e) => setGhRepo(e.target.value)}
                  placeholder="e.g. acme/monorepo"
                  style={{ marginTop: 8 }}
                />
              </div>
              {ghConfig?.ghPatMasked && (
                <div>
                  <Text type="secondary">Current PAT</Text>
                  <Text code style={{ display: 'block', marginTop: 4 }}>{ghConfig.ghPatMasked}</Text>
                </div>
              )}
              <div>
                <Text type="secondary">New PAT (leave blank to keep existing)</Text>
                <Input.Password
                  value={ghPat}
                  onChange={(e) => setGhPat(e.target.value)}
                  placeholder="ghp_…"
                  style={{ marginTop: 8 }}
                />
              </div>
              <Button
                type="primary"
                loading={saveGithubMutation.isPending}
                onClick={() => void saveGithubMutation.mutate()}
                disabled={!ghRepo.trim()}
              >
                Save GitHub config
              </Button>
            </Space>
          </Card>
        )}
        <Card
          style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderColor: '#fecaca' }}
          title="Danger zone"
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Text strong>Delete project</Text>
              <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                Permanently delete this project, checks, schedules, environments, alerts, run history, screenshots, and traces.
              </Text>
            </div>
            <Button danger ghost onClick={openDeleteProjectModal} disabled={!isSuperadmin}>
              Delete project
            </Button>
          </Space>
        </Card>
      </Space>
    </Col>
  );
}
