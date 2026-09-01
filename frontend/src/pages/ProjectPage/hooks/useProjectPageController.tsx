import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, message } from 'antd';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  createTest,
  createChannel,
  createEnvironment,
  createSchedule,
  deleteTest,
  deleteProject,
  deleteChannel,
  deleteEnvironment,
  deleteSchedule,
  getChannels,
  getEnvironments,
  getProject,
  getProjectMembers,
  getProjectTeams,
  getSchedules,
  getSuites,
  importTestSpec,
  runSuite,
  runAllEnabledTestCases,
  runTestWithEnvironment,
  testChannel,
  testChannelDraft,
  updateChannel,
  updateEnvironment,
  updateSchedule,
  updateProject,
  getTeams,
  createTeam,
  deleteTeam,
  attachTeamToProject,
  detachTeamFromProject,
  addTeamMember,
  removeTeamMember,
  getInvites,
  createInvite,
  revokeInvite,
  getGroups,
  getUsers
} from '../../../api/client';
import { qk } from '../../../lib/queryKeys';
import type { SchedulePayload } from '../../../components/ScheduleFormModal';
import {
  clearProjectSettingsDraft,
  readProjectSettingsDraft,
  writeProjectSettingsDraft
} from '../../../utils/projectSettings';
import type {
  Environment,
  NotificationChannel,
  ProjectMember,
  ProjectCheck,
  ProjectWorkspace,
  Schedule,
  Suite,
  Team,
  Invite,
  Group
} from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import { deriveProjectGates } from '../../../utils/scopes';
import {
  DEFAULT_DEVICE_OPTIONS,
  countEnvironmentUsage,
  createEnvRow,
  envRecordFromRows,
  envRowsFromRecord,
  getEnabledDataCaseCount,
  getFirstEnabledDataCaseIndex,
  resolveInitialEnvironmentId,
  resolveTabFromPathname,
  validateEnvironmentRows,
  type ChannelFormState,
  type EntityMode,
  type EnvironmentRowState,
  type ProjectTabKey
} from '../utils';

export function useProjectPageController() {
  const { isSuperadmin } = useAuth();
  const confirm = useConfirm();
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [confirmModal, confirmModalContextHolder] = Modal.useModal();

  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [activeTab, setActiveTab] = useState<ProjectTabKey>(() => resolveTabFromPathname(location.pathname));
  const [importing, setImporting] = useState(false);
  const [runCheckModalOpen, setRunCheckModalOpen] = useState(false);
  const [runCheckId, setRunCheckId] = useState<string | null>(null);
  const [runSuiteModalOpen, setRunSuiteModalOpen] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | undefined>(undefined);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(undefined);
  const [checkRunLoading, setCheckRunLoading] = useState(false);
  const [runningSuite, setRunningSuite] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [environmentModalOpen, setEnvironmentModalOpen] = useState(false);
  const [environmentMode, setEnvironmentMode] = useState<EntityMode>('create');
  const [editingEnvironment, setEditingEnvironment] = useState<Environment | null>(null);
  const [environmentName, setEnvironmentName] = useState('');
  const [environmentRows, setEnvironmentRows] = useState<EnvironmentRowState[]>([createEnvRow()]);
  const [environmentSaving, setEnvironmentSaving] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [channelMode, setChannelMode] = useState<EntityMode>('create');
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [channelType, setChannelType] = useState<'telegram' | 'slack'>('telegram');
  const [channelForm, setChannelForm] = useState<ChannelFormState>({
    name: '',
    botToken: '',
    chatId: '',
    webhookUrl: '',
    onFailed: true,
    onRecovered: true,
    onPassed: false,
    enabled: true
  });
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelTesting, setChannelTesting] = useState(false);
  const [channelTestFeedback, setChannelTestFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<EntityMode>('create');
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [projectDescription, setProjectDescription] = useState('');
  const [savedProjectDescription, setSavedProjectDescription] = useState('');
  const [projectDefaultEnvironmentId, setProjectDefaultEnvironmentId] = useState<string | undefined>(undefined);
  const [projectDefaultDevice, setProjectDefaultDevice] = useState<string>(DEFAULT_DEVICE_OPTIONS[0]);
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [projectDescriptionError, setProjectDescriptionError] = useState<string | null>(null);
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [deleteProjectConfirmText, setDeleteProjectConfirmText] = useState('');
  const [deletingProject, setDeletingProject] = useState(false);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [attachedTeams, setAttachedTeams] = useState<{ id: string; name: string }[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ email: string; teamId?: string; groupId?: string }>({ email: '' });
  const [teamName, setTeamName] = useState('');
  const [teamSaving, setTeamSaving] = useState(false);
  const settingsHydratedRef = useRef(false);

  const summary = project?.summary;
  const hasChecks = (project?.tests.length ?? 0) > 0;
  const gates = deriveProjectGates(project?.currentUserScopes ?? []);
  const canWriteProject = !gates.readOnly;          // editor-equivalent: holds some *_edit scope
  const canManageMembers = gates.canReadMembers;    // Members tab visibility
  const canManageTeams = gates.canManageTeams;      // team + invite mutations
  const canManageSchedules = gates.canEditSchedules;
  const canManageEnvironments = gates.canEditEnvironments;
  const canReadReports = gates.canReadReports;
  const canEditReports = gates.canEditReports;

  const qc = useQueryClient();

  function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
    return result.status === 'fulfilled' ? result.value : fallback;
  }

  const fetchWorkspace = async () => {
    const projectData = await getProject(projectId!);
    const [suiteDataResult, environmentDataResult, scheduleDataResult, channelDataResult, memberDataResult] = await Promise.allSettled([
      getSuites(projectId!),
      getEnvironments(projectId!),
      getSchedules(projectId!),
      getChannels(projectId!),
      deriveProjectGates(projectData.currentUserScopes ?? []).canReadMembers ? getProjectMembers(projectId!) : Promise.resolve([])
    ]);
    return {
      project: projectData,
      suites: settledValue(suiteDataResult, []),
      environments: settledValue(environmentDataResult, []),
      schedules: settledValue(scheduleDataResult, []),
      channels: settledValue(channelDataResult, []),
      members: settledValue(memberDataResult, [])
    };
  };

  // Distinct key: this composite ({project,suites,...}) must NOT collide with the raw getProject
  // shape that TestEditor/Suites/Environments/etc. cache under qk.project(id). Prefix-matched
  // invalidations of qk.project(id) still refresh this.
  const workspaceQuery = useQuery({
    queryKey: [...qk.project(projectId!), 'workspace'],
    queryFn: fetchWorkspace,
    enabled: Boolean(projectId)
  });
  const loading = workspaceQuery.isLoading;

  useEffect(() => {
    const d = workspaceQuery.data;
    if (!d) return;
    setProject(d.project);
    setProjectName(d.project.name);
    setSuites(d.suites);
    setEnvironments(d.environments);
    setSchedules(d.schedules);
    setChannels(d.channels);
    setProjectMembers(d.members);
  }, [workspaceQuery.data]);

  const fetchMembersData = async () => {
    const [membersR, teamsR, attachedR, invitesR, groupsR, usersR] = await Promise.allSettled([
      getProjectMembers(projectId!),
      // ponytail: dropdowns fetch first 1000 teams/users; add server-side search when lists outgrow that.
      getTeams({ limit: 1000 }).then((r) => r.teams),
      getProjectTeams(projectId!),
      canManageTeams ? getInvites() : Promise.resolve([] as Invite[]),
      isSuperadmin ? getGroups() : Promise.resolve([] as Group[]),
      canManageTeams ? getUsers({ limit: 1000 }).then((r) => r.users) : Promise.resolve([] as Array<{ id: string; email: string }>)
    ]);
    return {
      members: settledValue(membersR, []),
      teams: settledValue(teamsR, []),
      attachedTeams: settledValue(attachedR, [] as { id: string; name: string }[]),
      invites: settledValue(invitesR, []),
      groups: settledValue(groupsR, []),
      users: settledValue(usersR, [])
    };
  };

  const membersQuery = useQuery({
    queryKey: [...qk.project(projectId!), 'members-tab'],
    queryFn: fetchMembersData,
    enabled: Boolean(projectId) && activeTab === 'members' && canManageMembers
  });

  useEffect(() => {
    const d = membersQuery.data;
    if (!d) return;
    setProjectMembers(d.members);
    setTeams(d.teams);
    setAttachedTeams(d.attachedTeams);
    setInvites(d.invites);
    setGroups(d.groups);
    setUsers(d.users);
  }, [membersQuery.data]);

  useEffect(() => {
    settingsHydratedRef.current = false;
    setProjectDescription('');
    setSavedProjectDescription('');
    setProjectDefaultEnvironmentId(undefined);
    setProjectDefaultDevice(DEFAULT_DEVICE_OPTIONS[0]);
    setProjectNameError(null);
    setProjectDescriptionError(null);
    setDeleteProjectConfirmText('');
    setDeleteProjectModalOpen(false);
    setProjectMembers([]);
    setTeams([]);
    setAttachedTeams([]);
    setInvites([]);
    setInviteModalOpen(false);
  }, [projectId]);

  useEffect(() => {
    setActiveTab(resolveTabFromPathname(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (!project || settingsHydratedRef.current) return;
    const draft = readProjectSettingsDraft(project.id);
    const nextDefaultEnvironmentId =
      draft?.defaultEnvironmentId && environments.some((environment) => environment.id === draft.defaultEnvironmentId)
        ? draft.defaultEnvironmentId
        : resolveInitialEnvironmentId(environments);
    const nextDescription = draft?.description ?? '';

    setProjectName(project.name);
    setProjectDescription(nextDescription);
    setSavedProjectDescription(nextDescription.trim());
    setProjectDefaultEnvironmentId(nextDefaultEnvironmentId);
    setProjectDefaultDevice(draft?.defaultDevice ?? DEFAULT_DEVICE_OPTIONS[0]);
    settingsHydratedRef.current = true;
  }, [environments, project]);

  const projectHeaderDescription = savedProjectDescription || 'Monitor browser checks, schedules, and alerts for this project.';

  const projectChecks = useMemo(() => project?.tests ?? [], [project]);
  const latestChecks = useMemo(() => {
    return [...projectChecks].sort((left, right) => {
      const leftDate = left.lastRunAt ? new Date(left.lastRunAt).getTime() : 0;
      const rightDate = right.lastRunAt ? new Date(right.lastRunAt).getTime() : 0;
      return rightDate - leftDate;
    });
  }, [projectChecks]);

  const environmentUsage = useMemo(
    () =>
      environments.map((environment) => ({
        ...environment,
        usedByChecks: countEnvironmentUsage(environment, projectChecks)
      })),
    [environments, projectChecks]
  );

  const overviewChecks = useMemo(() => {
    return latestChecks.filter((check) => check.lastRunAt).slice(0, 5);
  }, [latestChecks]);

  const attentionChecks = useMemo(() => {
    return latestChecks.filter((check) => check.lastRunStatus === 'FAILED' || (check.lastRunAt && check.steps.length > 0 && check.runCount > 1));
  }, [latestChecks]);

  const projectSetupItems = useMemo(
    () => [
      { label: 'Checks created', done: (projectChecks.length ?? 0) > 0 },
      { label: 'Environment configured', done: environments.length > 0 },
      { label: 'Schedule configured', done: schedules.some((schedule) => schedule.enabled) },
      { label: 'Alert channel configured', done: channels.length > 0 }
    ],
    [channels.length, environments.length, projectChecks.length, schedules]
  );

  const openEnvironmentCreate = () => {
    if (!canManageEnvironments) {
      message.info('Read-only access');
      return;
    }
    setEnvironmentMode('create');
    setEditingEnvironment(null);
    setEnvironmentName('');
    setEnvironmentRows([createEnvRow()]);
    setEnvironmentModalOpen(true);
  };

  const openEnvironmentEdit = (environment: Environment) => {
    if (!canManageEnvironments) {
      message.info('Read-only access');
      return;
    }
    setEnvironmentMode('edit');
    setEditingEnvironment(environment);
    setEnvironmentName(environment.name);
    setEnvironmentRows(envRowsFromRecord(environment.variables));
    setEnvironmentModalOpen(true);
  };

  const saveEnvironment = async () => {
    if (!canManageEnvironments) {
      message.info('Read-only access');
      return;
    }
    const validationError = validateEnvironmentRows(environmentName, environmentRows);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setEnvironmentSaving(true);
    try {
      const payload = {
        name: environmentName.trim(),
        variables: envRecordFromRows(environmentRows)
      };
      if (environmentMode === 'edit' && editingEnvironment) {
        await updateEnvironment(editingEnvironment.id, payload);
        message.success('Environment updated');
      } else {
        await createEnvironment(projectId!, payload);
        message.success('Environment created');
      }
      setEnvironmentModalOpen(false);
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to save environment');
    } finally {
      setEnvironmentSaving(false);
    }
  };

  const duplicateEnvironment = async (environment: Environment) => {
    if (!canManageEnvironments) {
      message.info('Read-only access');
      return;
    }
    try {
      await createEnvironment(projectId!, {
        name: `${environment.name} Copy`,
        variables: environment.variables
      });
      message.success('Environment duplicated');
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to duplicate environment');
    }
  };

  const deleteEnvironmentById = async (environmentId: string) => {
    await deleteEnvironment(environmentId);
    message.success('Environment deleted');
    await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
  };

  const openChannelCreate = (type: 'telegram' | 'slack') => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    setChannelMode('create');
    setEditingChannel(null);
    setChannelType(type);
    setChannelForm({
      name: '',
      botToken: '',
      chatId: '',
      webhookUrl: '',
      onFailed: true,
      onRecovered: true,
      onPassed: false,
      enabled: true
    });
    setChannelTestFeedback(null);
    setChannelModalOpen(true);
  };

  const openChannelEdit = (channel: NotificationChannel) => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    setChannelMode('edit');
    setEditingChannel(channel);
    setChannelType(channel.type);
    setChannelForm({
      name: channel.name,
      botToken: channel.type === 'telegram' ? channel.config.botToken ?? '' : '',
      chatId: channel.type === 'telegram' ? channel.config.chatId ?? '' : '',
      webhookUrl: channel.type === 'slack' ? channel.config.webhookUrl ?? '' : '',
      onFailed: channel.onFailed,
      onRecovered: channel.onRecovered,
      onPassed: channel.onPassed,
      enabled: channel.enabled
    });
    setChannelTestFeedback(null);
    setChannelModalOpen(true);
  };

  const saveChannel = async () => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    if (!channelForm.name.trim()) {
      message.error('Alert name is required');
      return;
    }

    if (channelType === 'telegram') {
      if (!channelForm.botToken.trim()) {
        message.error('Bot token is required');
        return;
      }
      if (!channelForm.chatId.trim()) {
        message.error('Chat ID is required');
        return;
      }
    } else if (!channelForm.webhookUrl.trim()) {
      message.error('Webhook URL is required');
      return;
    } else if (!channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')) {
      message.error('Webhook URL must start with https://hooks.slack.com/services/');
      return;
    }

    setChannelSaving(true);
    try {
      const payload: {
        type: 'telegram' | 'slack';
        name: string;
        config: Record<string, string>;
        onFailed: boolean;
        onRecovered: boolean;
        onPassed: boolean;
        enabled: boolean;
      } = channelType === 'telegram'
        ? {
            type: 'telegram',
            name: channelForm.name.trim(),
            config: {
              botToken: channelForm.botToken.trim(),
              chatId: channelForm.chatId.trim()
            },
            onFailed: channelForm.onFailed,
            onRecovered: channelForm.onRecovered,
            onPassed: channelForm.onPassed,
            enabled: channelForm.enabled
          }
        : {
            type: 'slack',
            name: channelForm.name.trim(),
            config: {
              webhookUrl: channelForm.webhookUrl.trim()
            },
            onFailed: channelForm.onFailed,
            onRecovered: channelForm.onRecovered,
            onPassed: channelForm.onPassed,
            enabled: channelForm.enabled
          };

      if (channelMode === 'edit' && editingChannel) {
        await updateChannel(editingChannel.id, {
          name: payload.name,
          config: payload.config,
          onFailed: payload.onFailed,
          onRecovered: payload.onRecovered,
          onPassed: payload.onPassed,
          enabled: payload.enabled
        });
        message.success('Channel updated');
      } else {
        await createChannel(projectId!, payload);
        message.success('Channel created');
      }

      setChannelModalOpen(false);
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to save channel');
    } finally {
      setChannelSaving(false);
    }
  };

  const sendChannelDraftTest = async () => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    setChannelTestFeedback(null);

    if (!channelForm.name.trim()) {
      setChannelTestFeedback({ type: 'error', text: 'Alert name is required' });
      return;
    }

    if (channelType === 'telegram') {
      if (!channelForm.botToken.trim() || !channelForm.chatId.trim()) {
        setChannelTestFeedback({ type: 'error', text: 'Bot token and Chat ID are required' });
        return;
      }
    } else if (!channelForm.webhookUrl.trim()) {
      setChannelTestFeedback({ type: 'error', text: 'Webhook URL is required' });
      return;
    } else if (!channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')) {
      setChannelTestFeedback({ type: 'error', text: 'Webhook URL must start with https://hooks.slack.com/services/' });
      return;
    }

    setChannelTesting(true);
    try {
      await testChannelDraft(projectId!, {
        type: channelType,
        name: channelForm.name.trim(),
        config:
          channelType === 'telegram'
            ? {
                botToken: channelForm.botToken.trim(),
                chatId: channelForm.chatId.trim()
              }
            : {
                webhookUrl: channelForm.webhookUrl.trim()
              }
        });
      setChannelTestFeedback({ type: 'success', text: 'Test notification sent.' });
    } catch (error) {
      const apiError = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setChannelTestFeedback({
        type: 'error',
        text: typeof apiError === 'string' && apiError.trim().length > 0 ? apiError : 'Failed to send test notification'
      });
    } finally {
      setChannelTesting(false);
    }
  };

  const testExistingChannel = async (channel: NotificationChannel) => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    try {
      await testChannel(channel.id);
      message.success('Test notification sent');
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to send test notification');
    }
  };

  const deleteExistingChannel = async (channelId: string) => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    await deleteChannel(channelId);
    message.success('Channel deleted');
    await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
  };

  const toggleChannelEnabled = async (channel: NotificationChannel) => {
    if (!canWriteProject) {
      message.info('Read-only access');
      return;
    }
    try {
      await updateChannel(channel.id, { enabled: !channel.enabled });
      message.success(channel.enabled ? 'Alert paused' : 'Alert activated');
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to update alert status');
    }
  };

  const channelDraftReadyForTest = channelType === 'telegram'
    ? Boolean(channelForm.name.trim() && channelForm.botToken.trim() && channelForm.chatId.trim())
    : Boolean(
        channelForm.name.trim() &&
          channelForm.webhookUrl.trim() &&
          channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')
      );

  const openScheduleCreate = () => {
    if (!canManageSchedules) {
      message.info('Read-only access');
      return;
    }
    setScheduleMode('create');
    setEditingSchedule(null);
    setScheduleModalOpen(true);
  };

  const openScheduleEdit = (schedule: Schedule) => {
    if (!canManageSchedules) {
      message.info('Read-only access');
      return;
    }
    setScheduleMode('edit');
    setEditingSchedule(schedule);
    setScheduleModalOpen(true);
  };

  const saveSchedule = async (payload: SchedulePayload) => {
    if (!canManageSchedules) {
      message.info('Read-only access');
      return;
    }
    setScheduleSaving(true);
    try {
      if (scheduleMode === 'edit' && editingSchedule) {
        await updateSchedule(editingSchedule.id, payload);
        message.success('Schedule updated');
      } else {
        await createSchedule(projectId!, {
          name: payload.name,
          cron: payload.cron,
          timezone: payload.timezone,
          suiteId: payload.suiteId ?? undefined,
          testId: payload.testId ?? undefined,
          environmentId: payload.environmentId ?? undefined,
          enabled: payload.enabled
        });
        message.success('Schedule created');
      }
      setScheduleModalOpen(false);
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to save schedule');
    } finally {
      setScheduleSaving(false);
    }
  };

  const runScheduleNow = async (schedule: Schedule) => {
    if (!canManageSchedules) {
      message.info('Read-only access');
      return;
    }
    try {
      if (schedule.suiteId) {
        const result = await runSuite(schedule.suiteId, schedule.environmentId ?? undefined);
        if (result.jobs.length > 0) {
          navigate(`/runs/${result.jobs[0].testRunId}`);
        }
      } else if (schedule.testId) {
        const result = await runTestWithEnvironment(schedule.testId, schedule.environmentId ?? undefined);
        navigate(`/runs/${result.testRunId}`);
      }
      message.success('Schedule run started');
    } catch {
      message.error('Failed to run schedule');
    }
  };

  const toggleSchedule = async (schedule: Schedule) => {
    if (!canManageSchedules) {
      message.info('Read-only access');
      return;
    }
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      message.success(schedule.enabled ? 'Schedule paused' : 'Schedule resumed');
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } catch {
      message.error('Failed to update schedule');
    }
  };

  const deleteExistingSchedule = async (scheduleId: string) => {
    if (!canManageSchedules) {
      message.info('Read-only access');
      return;
    }
    await deleteSchedule(scheduleId);
    message.success('Schedule deleted');
    await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
  };

  const openCheck = (testId: string) => {
    navigate(`/tests/${testId}/edit`);
  };

  const openLatestRun = (row: ProjectCheck) => {
    if (row.latestRun?.id) {
      navigate(`/runs/${row.latestRun.id}`);
    } else {
      openCheck(row.id);
    }
  };

  const handleRunCheck = async (testId: string, event?: MouseEvent) => {
    event?.stopPropagation();
    try {
      const check = project?.tests.find((test) => test.id === testId);
      const dataCaseIndex = getFirstEnabledDataCaseIndex(check);
      if (dataCaseIndex === null) {
        message.error('No enabled test data cases');
        return;
      }
      const enabledDataCaseCount = getEnabledDataCaseCount(check);
      if (enabledDataCaseCount > 1 && environments.length === 0) {
        const result = await runAllEnabledTestCases(testId);
        message.success(`${result.queued} test cases queued.`);
        navigate(`/run-batches/${result.batchId}`);
        return;
      }

      if (environments.length === 0) {
        const { testRunId } = await runTestWithEnvironment(testId, undefined, dataCaseIndex);
        message.success('Check started');
        navigate(`/runs/${testRunId}`);
        return;
      }

      setRunCheckId(testId);
      setSelectedEnvironmentId(undefined);
      setRunCheckModalOpen(true);
    } catch {
      message.error('Failed to start check');
    }
  };

  const handleConfirmCheckRun = async () => {
    if (!runCheckId) return;

    setCheckRunLoading(true);
    try {
      const check = project?.tests.find((test) => test.id === runCheckId);
      const dataCaseIndex = getFirstEnabledDataCaseIndex(check);
      if (dataCaseIndex === null) {
        message.error('No enabled test data cases');
        return;
      }
      const enabledDataCaseCount = getEnabledDataCaseCount(check);
      if (enabledDataCaseCount > 1) {
        const result = await runAllEnabledTestCases(runCheckId, selectedEnvironmentId);
        setRunCheckModalOpen(false);
        message.success(`${result.queued} test cases queued.`);
        navigate(`/run-batches/${result.batchId}`);
        return;
      }

      const { testRunId } = await runTestWithEnvironment(runCheckId, selectedEnvironmentId, dataCaseIndex);
      setRunCheckModalOpen(false);
      message.success('Check started');
      navigate(`/runs/${testRunId}`);
    } catch {
      message.error('Failed to start check');
    } finally {
      setCheckRunLoading(false);
    }
  };

  const handleDeleteCheck = async (testId: string) => {
    await deleteTest(testId);
    message.success('Check deleted');
    await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
  };

  const handleDuplicateCheck = async (check: ProjectCheck) => {
    try {
      const created = await createTest(projectId!, {
        name: `${check.name} Copy`,
        url: check.url,
        device: check.device ?? undefined,
        steps: check.steps
      });
      message.success('Check duplicated');
      navigate(`/tests/${created.id}/edit`);
    } catch {
      message.error('Failed to duplicate check');
    }
  };

  const handleExportCheck = async (check: ProjectCheck) => {
    try {
      const response = await api.get(`/tests/${check.id}/export`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${check.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'check'}.spec.ts`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      message.success('Check exported');
    } catch {
      message.error('Failed to export check');
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const code = await file.text();
      const { test, parsedSteps } = await importTestSpec(projectId!, code);
      message.success(`Imported "${test.name}" — ${parsedSteps} steps`);
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
      navigate(`/tests/${test.id}/edit`);
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      message.error(typeof responseError === 'string' ? responseError : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const openRunSuiteModal = () => {
    if (!canWriteProject) {
      message.warning('Read-only access cannot run suites');
      return;
    }
    setSelectedSuiteId(suites[0]?.id);
    setSelectedEnvironmentId(undefined);
    setRunSuiteModalOpen(true);
  };

  const handleRunSuite = async () => {
    if (!selectedSuiteId) {
      message.warning('Create a suite first to run multiple checks together');
      return;
    }

    setRunningSuite(true);
    try {
      const result = await runSuite(selectedSuiteId, selectedEnvironmentId);
      setRunSuiteModalOpen(false);
      if (result.jobs.length > 0) {
        navigate(`/runs/${result.jobs[0].testRunId}`);
      } else {
        navigate('/dashboard');
      }
    } catch {
      message.error('Failed to run suite');
    } finally {
      setRunningSuite(false);
    }
  };

  const handleSaveProject = async () => {
    if (!project) return;

    const nextName = projectName.trim();
    const nextDescription = projectDescription.trim();
    const nextDefaultEnvironmentId = projectDefaultEnvironmentId || undefined;

    setProjectNameError(null);
    setProjectDescriptionError(null);

    if (!nextName) {
      setProjectNameError('Project name is required');
      message.error('Project name is required');
      return;
    }

    if (nextDescription.length > 500) {
      setProjectDescriptionError('Description must be 500 characters or fewer');
      message.error('Description must be 500 characters or fewer');
      return;
    }

    setSavingProject(true);
    try {
      if (nextName !== project.name) {
        const updated = await updateProject(project.id, { name: nextName });
        setProject((current) => (current ? { ...current, ...updated, name: updated.name } : current));
      }
      writeProjectSettingsDraft(project.id, {
        description: nextDescription,
        defaultEnvironmentId: nextDefaultEnvironmentId,
        defaultDevice: projectDefaultDevice
      });
      setProjectDescription(nextDescription);
      setSavedProjectDescription(nextDescription);
      setProjectDefaultEnvironmentId(nextDefaultEnvironmentId);
      message.success('Project settings saved');
      await qc.invalidateQueries({ queryKey: qk.project(projectId!) });
    } finally {
      setSavingProject(false);
    }
  };

  const handleResetProjectSettings = () => {
    if (!project) return;
    clearProjectSettingsDraft(project.id);
    setProjectName(project.name);
    setProjectDescription('');
    setSavedProjectDescription('');
    setProjectDefaultEnvironmentId(resolveInitialEnvironmentId(environments));
    setProjectDefaultDevice(DEFAULT_DEVICE_OPTIONS[0]);
    setProjectNameError(null);
    setProjectDescriptionError(null);
    message.info('Project settings reset');
  };

  const openDeleteProjectModal = () => {
    if (!isSuperadmin) {
      message.warning('Only the project owner can delete the project');
      return;
    }
    setDeleteProjectConfirmText('');
    setDeleteProjectModalOpen(true);
  };

  const handleDeleteProject = async () => {
    if (!project || deleteProjectConfirmText.trim() !== project.name.trim()) return;

    setDeletingProject(true);
    try {
      clearProjectSettingsDraft(project.id);
      await deleteProject(project.id);
      message.success('Project deleted');
      setDeleteProjectModalOpen(false);
      navigate('/projects');
    } catch {
      message.error('Failed to delete project');
    } finally {
      setDeletingProject(false);
    }
  };

  const extractError = (error: unknown, fallback: string) => {
    const responseError =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
    return typeof responseError === 'string' ? responseError : fallback;
  };

  const openInvite = () => {
    setInviteForm({ email: '' });
    setInviteModalOpen(true);
  };

  // Teams are global and created in the Access console; here we only attach an existing team so
  // its members gain access to this project.
  const handleAttachExistingTeam = async (teamId: string) => {
    if (!project) return;
    try {
      await attachTeamToProject(teamId, project.id);
      message.success('Team attached');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to attach team'));
    }
  };

  const handleDetachTeam = async (teamId: string) => {
    if (!project) return;
    try { await confirm({ title: 'Detach team?', description: "The team's members lose access to this project.", confirmationText: 'Detach', danger: true }); }
    catch { return; }
    try {
      await detachTeamFromProject(teamId, project.id);
      message.success('Team detached');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to detach team'));
    }
  };

  const handleCreateTeam = async () => {
    if (!project || !teamName.trim()) { message.error('Team name is required'); return; }
    setTeamSaving(true);
    try {
      const team = await createTeam({ name: teamName.trim() });
      await attachTeamToProject(team.id, project.id);
      message.success('Team created');
      setTeamName('');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to create team'));
    } finally {
      setTeamSaving(false);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    try {
      await deleteTeam(teamId);
      message.success('Team deleted');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to delete team'));
    }
  };

  const handleAddTeamMember = async (teamId: string, userId: string) => {
    try {
      await addTeamMember(teamId, userId);
      message.success('Member added');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to add member'));
    }
  };

  const handleRemoveTeamMember = async (teamId: string, userId: string) => {
    try { await confirm({ title: 'Remove member?', description: 'They lose access granted through this team.', confirmationText: 'Remove', danger: true }); }
    catch { return; }
    try {
      await removeTeamMember(teamId, userId);
      message.success('Member removed');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to remove member'));
    }
  };

  const handleCreateInvite = async () => {
    if (!inviteForm.email.trim()) { message.error('Email is required'); return; }
    setInviteSaving(true);
    try {
      await createInvite({
        email: inviteForm.email.trim().toLowerCase(),
        teamId: inviteForm.teamId,
        groupId: inviteForm.groupId
      });
      message.success('Invite sent');
      setInviteModalOpen(false);
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to send invite'));
    } finally {
      setInviteSaving(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try { await confirm({ title: 'Revoke invite?', description: 'The invite link stops working immediately.', confirmationText: 'Revoke', danger: true }); }
    catch { return; }
    try {
      await revokeInvite(id);
      message.success('Invite revoked');
      await qc.invalidateQueries({ queryKey: [...qk.project(projectId!), 'members-tab'] });
    } catch (error) {
      message.error(extractError(error, 'Failed to revoke invite'));
    }
  };

  const deleteProjectReady = Boolean(
    project && deleteProjectConfirmText.trim() === project.name.trim()
  );

  // attachedTeams comes from GET /projects/:id/teams (true attachment set, incl. empty teams).
  const attachedTeamIds = new Set(attachedTeams.map((t) => t.id));

  const runSuiteItems = suites.map((suite) => ({
    value: suite.id,
    label: `${suite.name}${Array.isArray(suite.testIds) ? ` • ${suite.testIds.length} checks` : ''}`
  }));

  return {
    // identity / routing
    projectId,
    navigate,
    isSuperadmin,
    confirmModal,
    confirmModalContextHolder,
    // data
    project,
    summary,
    hasChecks,
    loading,
    suites,
    environments,
    schedules,
    channels,
    projectMembers,
    teams,
    attachedTeams,
    attachedTeamIds,
    invites,
    groups,
    users,
    // derived
    gates,
    canWriteProject,
    canManageMembers,
    canManageTeams,
    canManageSchedules,
    canManageEnvironments,
    canReadReports,
    canEditReports,
    projectChecks,
    latestChecks,
    environmentUsage,
    overviewChecks,
    attentionChecks,
    projectSetupItems,
    projectHeaderDescription,
    runSuiteItems,
    // tabs
    activeTab,
    setActiveTab,
    // import
    importing,
    handleImport,
    // check run
    runCheckModalOpen,
    setRunCheckModalOpen,
    checkRunLoading,
    handleConfirmCheckRun,
    handleRunCheck,
    openCheck,
    openLatestRun,
    handleDeleteCheck,
    handleDuplicateCheck,
    handleExportCheck,
    // suite run
    runSuiteModalOpen,
    setRunSuiteModalOpen,
    runningSuite,
    selectedSuiteId,
    setSelectedSuiteId,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    openRunSuiteModal,
    handleRunSuite,
    // environments
    environmentModalOpen,
    setEnvironmentModalOpen,
    environmentMode,
    editingEnvironment,
    environmentName,
    setEnvironmentName,
    environmentRows,
    setEnvironmentRows,
    environmentSaving,
    openEnvironmentCreate,
    openEnvironmentEdit,
    saveEnvironment,
    duplicateEnvironment,
    deleteEnvironmentById,
    // channels
    channelModalOpen,
    setChannelModalOpen,
    channelMode,
    channelType,
    channelForm,
    setChannelForm,
    channelSaving,
    channelTesting,
    channelTestFeedback,
    channelDraftReadyForTest,
    openChannelCreate,
    openChannelEdit,
    saveChannel,
    sendChannelDraftTest,
    testExistingChannel,
    deleteExistingChannel,
    toggleChannelEnabled,
    // schedules
    scheduleModalOpen,
    setScheduleModalOpen,
    scheduleMode,
    editingSchedule,
    scheduleSaving,
    openScheduleCreate,
    openScheduleEdit,
    saveSchedule,
    runScheduleNow,
    toggleSchedule,
    deleteExistingSchedule,
    // settings
    projectName,
    setProjectName,
    projectDescription,
    setProjectDescription,
    projectDefaultEnvironmentId,
    setProjectDefaultEnvironmentId,
    projectDefaultDevice,
    setProjectDefaultDevice,
    projectNameError,
    setProjectNameError,
    projectDescriptionError,
    setProjectDescriptionError,
    savingProject,
    handleSaveProject,
    handleResetProjectSettings,
    // delete project
    deleteProjectModalOpen,
    setDeleteProjectModalOpen,
    deleteProjectConfirmText,
    setDeleteProjectConfirmText,
    deletingProject,
    deleteProjectReady,
    openDeleteProjectModal,
    handleDeleteProject,
    // members / teams / invites
    teamName,
    setTeamName,
    teamSaving,
    openInvite,
    handleAttachExistingTeam,
    handleDetachTeam,
    handleCreateTeam,
    handleDeleteTeam,
    handleAddTeamMember,
    handleRemoveTeamMember,
    // invites
    inviteModalOpen,
    setInviteModalOpen,
    inviteSaving,
    inviteForm,
    setInviteForm,
    handleCreateInvite,
    handleRevokeInvite
  };
}
