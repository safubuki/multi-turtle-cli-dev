import { clipText, MAX_LIVE_OUTPUT, MAX_SHELL_OUTPUT } from './text'
import {
  createEmptyProviderSessions,
  createProviderSettingsMap,
  isProviderId,
  isReasoningEffort,
  normalizeProviderSettings,
  normalizeProviderSettingsMap,
  normalizeProviderSessionsMap
} from './providerState'
import { chooseInitialLocalWorkspacePath } from './workspacePaths'
import {
  appendStreamEntry,
  buildSessionLabel,
  createId,
  MAX_LOGS,
  MAX_STREAM_ENTRIES,
  PROVIDER_ORDER
} from './appCore'
import type {
  BootstrapPayload,
  LocalDirectoryEntry,
  LocalWorkspace,
  PaneSessionRecord,
  PaneState,
  PaneStatus,
  RemoteDirectoryEntry
} from '../types'

const STALL_MS = 120_000

export function statusLabel(status: PaneStatus): string {
  switch (status) {
    case 'running':
      return '\u5b9f\u884c\u4e2d'
    case 'updating':
      return 'AI\u66f4\u65b0\u4e2d'
    case 'completed':
      return '\u5b8c\u4e86'
    case 'attention':
      return '\u5165\u529b / \u78ba\u8a8d\u5f85\u3061'
    case 'error':
      return '\u30a8\u30e9\u30fc'
    default:
      return '\u5f85\u6a5f\u4e2d'
  }
}

export function createInitialPane(index: number, payload: BootstrapPayload, localWorkspaces: LocalWorkspace[]): PaneState {
  const provider = PROVIDER_ORDER[index % PROVIDER_ORDER.length]
  const providerSettings = createProviderSettingsMap(payload.providers)
  const providerSetting = providerSettings[provider]
  const initialWorkspacePath = chooseInitialLocalWorkspacePath(localWorkspaces)

  return {
    id: createId('pane'),
    title: `Task ${index + 1}`,
    settingsOpen: false,
    workspaceOpen: false,
    shellOpen: false,
    provider,
    model: providerSetting.model,
    reasoningEffort: providerSetting.reasoningEffort,
    autonomyMode: providerSetting.autonomyMode,
    codexFastMode: providerSetting.codexFastMode,
    providerSettings,
    providerSessions: createEmptyProviderSessions(),
    status: 'idle',
    statusText: statusLabel('idle'),
    runInProgress: false,
    shellCommand: '',
    shellOutput: '',
    shellHistory: [],
    shellHistoryIndex: null,
    localShellPath: initialWorkspacePath,
    remoteShellPath: '',
    shellRunning: false,
    shellLastExitCode: null,
    shellLastError: null,
    shellLastRunAt: null,
    workspaceMode: 'local',
    localWorkspacePath: initialWorkspacePath,
    localBrowserPath: '',
    localBrowserEntries: [],
    localBrowserLoading: false,
    sshHost: '',
    sshUser: '',
    sshPort: '',
    sshPassword: '',
    sshIdentityFile: '',
    sshProxyJump: '',
    sshProxyCommand: '',
    sshExtraArgs: '',
    sshLocalKeys: [],
    sshSelectedKeyPath: '',
    sshPublicKeyText: '',
    sshKeyName: 'id_ed25519',
    sshKeyComment: 'tako-cli-dev-tool',
    sshDiagnostics: [],
    sshActionState: 'idle',
    sshActionMessage: null,
    sshPasswordPulseAt: 0,
    sshLocalPath: initialWorkspacePath,
    sshRemotePath: '',
    remoteWorkspacePath: '',
    remoteWorkspaces: [],
    remoteAvailableProviders: [],
    remoteHomeDirectory: null,
    remoteBrowserPath: '',
    remoteBrowserEntries: [],
    remoteParentPath: null,
    remoteNewDirectoryName: '',
    remoteBrowserLoading: false,
    prompt: '',
    logs: [],
    streamEntries: [],
    sessionHistory: [],
    selectedSessionKey: null,
    liveOutput: '',
    attachedContextIds: [],
    sessionId: null,
    sessionScopeKey: null,
    autoShare: false,
    autoShareTargetIds: [],
    pendingShareGlobal: false,
    pendingShareTargetIds: [],
    currentRequestText: null,
    currentRequestAt: null,
    stopRequested: false,
    stopRequestAvailable: false,
    lastRunAt: null,
    runningSince: null,
    lastActivityAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResponse: null
  }
}

export function resetActiveSessionFields(pane: PaneState): PaneState {
  return {
    ...pane,
    prompt: '',
    status: 'idle',
    statusText: statusLabel('idle'),
    runInProgress: false,
    logs: [],
    streamEntries: [],
    selectedSessionKey: null,
    liveOutput: '',
    sessionId: null,
    sessionScopeKey: null,
    providerSessions: createEmptyProviderSessions(),
    currentRequestText: null,
    currentRequestAt: null,
    stopRequested: false,
    stopRequestAvailable: false,
    lastRunAt: null,
    runningSince: null,
    lastActivityAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResponse: null
  }
}

export function isPaneBusyForExecution(pane: Pick<PaneState, 'status' | 'runInProgress'>): boolean {
  return pane.runInProgress || pane.status === 'running' || pane.status === 'updating'
}

export function getPaneVisualStatus(pane: PaneState, now: number): PaneStatus | 'stalled' {
  if (pane.runInProgress && pane.lastActivityAt !== null && now - pane.lastActivityAt > STALL_MS) {
    return 'stalled'
  }

  return pane.status
}

export function applyBackgroundActionSuccess(pane: PaneState, statusText: string, eventAt: number): PaneState {
  if (isPaneBusyForExecution(pane)) {
    return {
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'system', statusText, eventAt, pane.provider, pane.model)
    }
  }

  return {
    ...pane,
    status: 'idle',
    statusText: statusLabel('idle'),
    streamEntries: appendStreamEntry(pane.streamEntries, 'system', statusText, eventAt, pane.provider, pane.model),
    lastError: null
  }
}

export function applyBackgroundActionFailure(pane: PaneState, statusText: string, errorMessage: string, eventAt: number): PaneState {
  if (isPaneBusyForExecution(pane)) {
    return {
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'stderr', `${statusText}: ${errorMessage}`, eventAt)
    }
  }

  return {
    ...pane,
    status: 'error',
    statusText,
    lastError: errorMessage
  }
}

export function normalizeLocalDirectoryEntry(rawEntry: Partial<LocalDirectoryEntry> | null | undefined): LocalDirectoryEntry | null {
  if (!rawEntry?.label || !rawEntry.path) {
    return null
  }

  return {
    label: rawEntry.label,
    path: rawEntry.path,
    isDirectory: rawEntry.isDirectory !== false
  }
}

export function normalizeRemoteDirectoryEntry(rawEntry: Partial<RemoteDirectoryEntry> | null | undefined): RemoteDirectoryEntry | null {
  if (!rawEntry?.label || !rawEntry.path) {
    return null
  }

  return {
    label: rawEntry.label,
    path: rawEntry.path,
    isDirectory: rawEntry.isDirectory !== false,
    isWorkspace: Boolean(rawEntry.isWorkspace)
  }
}

export function normalizeSessionRecord(rawRecord: Partial<PaneSessionRecord> | null | undefined): PaneSessionRecord | null {
  if (!rawRecord?.key) {
    return null
  }

  const logs = Array.isArray(rawRecord.logs) ? rawRecord.logs.slice(-MAX_LOGS) : []
  const createdAt = typeof rawRecord.createdAt === 'number' ? rawRecord.createdAt : Date.now()
  const sessionId = typeof rawRecord.sessionId === 'string' ? rawRecord.sessionId : null

  return {
    key: rawRecord.key,
    label: buildSessionLabel(sessionId, createdAt, logs),
    sessionId,
    createdAt,
    updatedAt: typeof rawRecord.updatedAt === 'number' ? rawRecord.updatedAt : null,
    status:
      rawRecord.status === 'completed' || rawRecord.status === 'attention' || rawRecord.status === 'error' || rawRecord.status === 'running' || rawRecord.status === 'updating'
        ? rawRecord.status
        : 'idle',
    logs,
    streamEntries: Array.isArray(rawRecord.streamEntries) ? rawRecord.streamEntries.slice(-MAX_STREAM_ENTRIES) : []
  }
}

export function normalizePane(
  rawPane: Partial<PaneState>,
  payload: BootstrapPayload,
  localWorkspaces: LocalWorkspace[]
): PaneState {
  const provider = isProviderId(rawPane.provider) ? rawPane.provider : 'codex'
  const providerSettings = normalizeProviderSettingsMap(rawPane.providerSettings, payload.providers)
  const activeProviderSetting = normalizeProviderSettings(
    {
      ...providerSettings[provider],
      model: typeof rawPane.model === 'string' ? rawPane.model : providerSettings[provider].model,
      reasoningEffort: isReasoningEffort(rawPane.reasoningEffort) ? rawPane.reasoningEffort : providerSettings[provider].reasoningEffort,
      autonomyMode: rawPane.autonomyMode === 'max' ? 'max' : providerSettings[provider].autonomyMode,
      codexFastMode: rawPane.codexFastMode === 'fast' ? 'fast' : providerSettings[provider].codexFastMode
    },
    payload.providers,
    provider
  )
  providerSettings[provider] = activeProviderSetting
  const providerSessions = normalizeProviderSessionsMap(rawPane.providerSessions)
  const restoredSessionId = typeof rawPane.sessionId === 'string' ? rawPane.sessionId : null
  const restoredSessionScopeKey = typeof rawPane.sessionScopeKey === 'string' ? rawPane.sessionScopeKey : null
  if (restoredSessionId || restoredSessionScopeKey) {
    providerSessions[provider] = {
      ...providerSessions[provider],
      sessionId: restoredSessionId,
      sessionScopeKey: restoredSessionScopeKey,
      updatedAt: typeof rawPane.lastActivityAt === 'number' ? rawPane.lastActivityAt : providerSessions[provider].updatedAt
    }
  }
  const workspaceMode = rawPane.workspaceMode === 'ssh' ? 'ssh' : 'local'
  const persistedLocalWorkspacePath = typeof rawPane.localWorkspacePath === 'string' ? rawPane.localWorkspacePath.trim() : ''
  const localWorkspacePath = persistedLocalWorkspacePath || chooseInitialLocalWorkspacePath(localWorkspaces)
  const rawStatus = rawPane.status ?? 'idle'
  const rawLastError = typeof rawPane.lastError === 'string' && rawPane.lastError.trim() ? rawPane.lastError : null
  const hasPersistedRunActivity =
    typeof rawPane.lastRunAt === 'number' ||
    typeof rawPane.lastFinishedAt === 'number' ||
    (Array.isArray(rawPane.logs) && rawPane.logs.some((entry) => entry?.role === 'user' || entry?.role === 'assistant'))
  const restoredStatus: PaneStatus =
    rawStatus === 'running' || rawStatus === 'updating'
      ? 'attention'
    : rawStatus === 'error'
      ? 'error'
      : rawStatus === 'completed' && hasPersistedRunActivity
        ? 'completed'
        : rawStatus === 'attention' && rawLastError && hasPersistedRunActivity
          ? 'attention'
        : 'idle'
  const remoteBrowserEntries = Array.isArray(rawPane.remoteBrowserEntries)
    ? rawPane.remoteBrowserEntries
        .map((entry) => normalizeRemoteDirectoryEntry(entry))
        .filter((entry): entry is RemoteDirectoryEntry => Boolean(entry))
    : []
  const rawStatusText = typeof rawPane.statusText === 'string' ? rawPane.statusText : ''
  const statusText =
    rawStatus === 'running' || rawStatus === 'updating'
      ? '\u524d\u56de\u306e\u5b9f\u884c\u306f\u4e2d\u65ad\u3055\u308c\u307e\u3057\u305f'
      : restoredStatus === 'idle'
        ? statusLabel('idle')
        : rawStatusText.includes('\u5916\u90e8\u30bf\u30fc\u30df\u30ca\u30eb')
        ? statusLabel(restoredStatus)
        : rawStatusText || statusLabel(restoredStatus)
  const restoredLastError = restoredStatus === 'idle' ? null : rawLastError

  return {
    id: rawPane.id ?? createId('pane'),
    title: typeof rawPane.title === 'string' && rawPane.title.trim() ? rawPane.title : 'Task',
    settingsOpen: rawPane.settingsOpen === true,
    workspaceOpen: rawPane.workspaceOpen === true,
    shellOpen: rawPane.shellOpen === true,
    provider,
    model: activeProviderSetting.model,
    reasoningEffort: activeProviderSetting.reasoningEffort,
    autonomyMode: activeProviderSetting.autonomyMode,
    codexFastMode: activeProviderSetting.codexFastMode,
    providerSettings,
    providerSessions,
    status: restoredStatus,
    statusText,
    runInProgress: false,
    shellCommand: typeof rawPane.shellCommand === 'string' ? rawPane.shellCommand : '',
    shellOutput: typeof rawPane.shellOutput === 'string' ? clipText(rawPane.shellOutput, MAX_SHELL_OUTPUT) : '',
    shellHistory: Array.isArray(rawPane.shellHistory)
      ? rawPane.shellHistory.filter((item): item is string => typeof item === 'string').slice(-50)
      : [],
    shellHistoryIndex: typeof rawPane.shellHistoryIndex === 'number' ? rawPane.shellHistoryIndex : null,
    localShellPath: typeof rawPane.localShellPath === 'string' && rawPane.localShellPath.trim() ? rawPane.localShellPath : localWorkspacePath,
    remoteShellPath: typeof rawPane.remoteShellPath === 'string' ? rawPane.remoteShellPath : '',
    shellRunning: false,
    shellLastExitCode: typeof rawPane.shellLastExitCode === 'number' ? rawPane.shellLastExitCode : null,
    shellLastError: typeof rawPane.shellLastError === 'string' ? rawPane.shellLastError : null,
    shellLastRunAt: typeof rawPane.shellLastRunAt === 'number' ? rawPane.shellLastRunAt : null,
    workspaceMode,
    localWorkspacePath,
    localBrowserPath: typeof rawPane.localBrowserPath === 'string' ? rawPane.localBrowserPath : '',
    localBrowserEntries: Array.isArray(rawPane.localBrowserEntries)
      ? rawPane.localBrowserEntries
          .map((entry) => normalizeLocalDirectoryEntry(entry))
          .filter((entry): entry is LocalDirectoryEntry => Boolean(entry))
      : [],
    localBrowserLoading: false,
    sshHost: typeof rawPane.sshHost === 'string' ? rawPane.sshHost : '',
    sshUser: typeof rawPane.sshUser === 'string' ? rawPane.sshUser : '',
    sshPort: typeof rawPane.sshPort === 'string' ? rawPane.sshPort : '',
    sshPassword: typeof rawPane.sshPassword === 'string' ? rawPane.sshPassword : '',
    sshIdentityFile: typeof rawPane.sshIdentityFile === 'string' ? rawPane.sshIdentityFile : '',
    sshProxyJump: typeof rawPane.sshProxyJump === 'string' ? rawPane.sshProxyJump : '',
    sshProxyCommand: typeof rawPane.sshProxyCommand === 'string' ? rawPane.sshProxyCommand : '',
    sshExtraArgs: typeof rawPane.sshExtraArgs === 'string' ? rawPane.sshExtraArgs : '',
    sshLocalKeys: Array.isArray(rawPane.sshLocalKeys) ? rawPane.sshLocalKeys : [],
    sshSelectedKeyPath: typeof rawPane.sshSelectedKeyPath === 'string' ? rawPane.sshSelectedKeyPath : '',
    sshPublicKeyText: typeof rawPane.sshPublicKeyText === 'string' ? rawPane.sshPublicKeyText : '',
    sshKeyName: typeof rawPane.sshKeyName === 'string' && rawPane.sshKeyName.trim() ? rawPane.sshKeyName : 'id_ed25519',
    sshKeyComment: typeof rawPane.sshKeyComment === 'string' ? rawPane.sshKeyComment : 'tako-cli-dev-tool',
    sshDiagnostics: Array.isArray(rawPane.sshDiagnostics)
      ? rawPane.sshDiagnostics.filter((item): item is string => typeof item === 'string')
      : [],
    sshActionState: rawPane.sshActionState === 'running' || rawPane.sshActionState === 'success' || rawPane.sshActionState === 'error' ? rawPane.sshActionState : 'idle',
    sshActionMessage: typeof rawPane.sshActionMessage === 'string' ? rawPane.sshActionMessage : null,
    sshPasswordPulseAt: 0,
    sshLocalPath: typeof rawPane.sshLocalPath === 'string' ? rawPane.sshLocalPath : localWorkspacePath,
    sshRemotePath: typeof rawPane.sshRemotePath === 'string' ? rawPane.sshRemotePath : '',
    remoteWorkspacePath: typeof rawPane.remoteWorkspacePath === 'string' ? rawPane.remoteWorkspacePath : '',
    remoteWorkspaces: Array.isArray(rawPane.remoteWorkspaces) ? rawPane.remoteWorkspaces : [],
    remoteAvailableProviders: Array.isArray(rawPane.remoteAvailableProviders)
      ? rawPane.remoteAvailableProviders.filter(isProviderId)
      : [],
    remoteHomeDirectory: typeof rawPane.remoteHomeDirectory === 'string' ? rawPane.remoteHomeDirectory : null,
    remoteBrowserPath: typeof rawPane.remoteBrowserPath === 'string' ? rawPane.remoteBrowserPath : '',
    remoteBrowserEntries,
    remoteParentPath: typeof rawPane.remoteParentPath === 'string' ? rawPane.remoteParentPath : null,
    remoteNewDirectoryName: typeof rawPane.remoteNewDirectoryName === 'string' ? rawPane.remoteNewDirectoryName : '',
    remoteBrowserLoading: false,
    prompt: typeof rawPane.prompt === 'string' ? rawPane.prompt : '',
    logs: Array.isArray(rawPane.logs) ? rawPane.logs.slice(-MAX_LOGS) : [],
    streamEntries: Array.isArray(rawPane.streamEntries) ? rawPane.streamEntries.slice(-MAX_STREAM_ENTRIES) : [],
    sessionHistory: Array.isArray(rawPane.sessionHistory)
      ? rawPane.sessionHistory
          .map((item) => normalizeSessionRecord(item))
          .filter((item): item is PaneSessionRecord => Boolean(item))
      : [],
    selectedSessionKey: null,
    liveOutput: typeof rawPane.liveOutput === 'string' ? clipText(rawPane.liveOutput, MAX_LIVE_OUTPUT) : '',
    attachedContextIds: Array.isArray(rawPane.attachedContextIds)
      ? rawPane.attachedContextIds.filter((item): item is string => typeof item === 'string')
      : [],
    sessionId: restoredSessionId,
    sessionScopeKey: restoredSessionScopeKey,
    autoShare: Boolean(rawPane.autoShare),
    autoShareTargetIds: Array.isArray(rawPane.autoShareTargetIds)
      ? rawPane.autoShareTargetIds.filter((item): item is string => typeof item === 'string')
      : [],
    pendingShareGlobal: Boolean(rawPane.pendingShareGlobal),
    pendingShareTargetIds: Array.isArray(rawPane.pendingShareTargetIds)
      ? rawPane.pendingShareTargetIds.filter((item): item is string => typeof item === 'string')
      : [],
    currentRequestText: typeof rawPane.currentRequestText === 'string' && rawPane.currentRequestText.trim() ? rawPane.currentRequestText : null,
    currentRequestAt: typeof rawPane.currentRequestAt === 'number' ? rawPane.currentRequestAt : null,
    stopRequested: false,
    stopRequestAvailable: false,
    lastRunAt: typeof rawPane.lastRunAt === 'number' ? rawPane.lastRunAt : null,
    runningSince: null,
    lastActivityAt: typeof rawPane.lastActivityAt === 'number' ? rawPane.lastActivityAt : null,
    lastFinishedAt: typeof rawPane.lastFinishedAt === 'number' ? rawPane.lastFinishedAt : null,
    lastError: restoredLastError,
    lastResponse: typeof rawPane.lastResponse === 'string' ? rawPane.lastResponse : null
  }
}
