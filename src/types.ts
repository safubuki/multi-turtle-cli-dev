export type ProviderId = 'codex' | 'gemini' | 'copilot'
export type PaneStatus = 'idle' | 'running' | 'updating' | 'completed' | 'attention' | 'error'
export type WorkspaceMode = 'local' | 'ssh'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type AutonomyMode = 'balanced' | 'max'
export type CodexFastMode = 'off' | 'fast'
export type HostPlatform = 'windows' | 'linux' | 'macos' | 'unknown'

export interface ProviderModelInfo {
  id: string
  name: string
  description?: string
  supportedReasoningEfforts: ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort | null
}

export interface ProviderVersionInfo {
  packageName: string
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  updateCommand: string
  latestCheckError: string | null
}

export interface ProviderCatalogResponse {
  provider: ProviderId
  label: string
  source: string
  fetchedAt: string | null
  available: boolean
  models: ProviderModelInfo[]
  versionInfo: ProviderVersionInfo
  error: string | null
}

export interface LocalWorkspace {
  id: string
  label: string
  path: string
  indicators: string[]
  source: 'app' | 'manual'
}

export interface LocalDirectoryEntry {
  label: string
  path: string
  isDirectory: boolean
}

export interface LocalBrowseRoot {
  label: string
  path: string
}

export interface SshHost {
  id: string
  alias: string
  hostname?: string
  user?: string
  port?: string
  identityFile?: string
  proxyJump?: string
  proxyCommand?: string
  source: 'ssh-config' | 'manual'
}

export interface SshConnectionOptions {
  username?: string
  port?: string
  password?: string
  identityFile?: string
  proxyJump?: string
  proxyCommand?: string
  extraArgs?: string
}

export interface LocalSshKey {
  id: string
  name: string
  publicKeyPath: string
  privateKeyPath: string
  publicKey: string
  algorithm: string
  comment: string
}

export interface RemoteWorkspace {
  label: string
  path: string
}

export interface RemoteDirectoryEntry {
  label: string
  path: string
  isDirectory: boolean
  isWorkspace: boolean
}

export interface SpecSection {
  title: string
  body: string
  bullets: string[]
}

export interface BootstrapPayload {
  success: boolean
  providers: Record<ProviderId, ProviderCatalogResponse>
  localWorkspaces: LocalWorkspace[]
  sshHosts: SshHost[]
  remoteRoots: string[]
  hostPlatform: HostPlatform
  features: {
    vscode: boolean
    ssh: boolean
    remoteDiscovery: boolean
    remoteBrowser: boolean
    shell?: boolean
  }
  spec: SpecSection[]
}

export type WorkspaceTarget =
  | {
      kind: 'local'
      path: string
      label: string
      resourceType?: 'folder' | 'file'
      workspacePath?: string
    }
  | {
      kind: 'ssh'
      host: string
      path: string
      label: string
      resourceType?: 'folder' | 'file'
      workspacePath?: string
      connection?: SshConnectionOptions
    }

export interface PaneLogEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
}
export interface SharedContextPayload {
  sourcePaneTitle: string
  provider: ProviderId
  workspaceLabel: string
  summary: string
  detail: string
}

export interface RunImageAttachment {
  fileName: string
  mimeType: string
  size: number
  localPath: string
}

export type PromptImageAttachmentStatus = 'uploading' | 'ready' | 'error'
export type PromptImageAttachmentSource = 'picker' | 'drop' | 'clipboard'

export interface PromptImageAttachment {
  id: string
  fileName: string
  mimeType: string
  size: number
  localPath: string | null
  previewUrl: string
  status: PromptImageAttachmentStatus
  source: PromptImageAttachmentSource
  error: string | null
}

export interface StagePromptImageRequest {
  fileName: string
  mimeType: string
  contentBase64: string
}

export interface StagePromptImageResponse {
  success: boolean
  attachment: RunImageAttachment
}

export interface UnstagePromptImagesRequest {
  localPaths: string[]
}

export interface UnstagePromptImagesResponse {
  success: boolean
}

export interface PaneStreamEntry {
  id: string
  kind: 'status' | 'tool' | 'stderr' | 'system'
  text: string
  createdAt: number
}

export interface PaneSessionRecord {
  key: string
  label: string
  sessionId: string | null
  createdAt: number
  updatedAt: number | null
  status: PaneStatus
  logs: PaneLogEntry[]
  streamEntries: PaneStreamEntry[]
}

export interface SharedContextItem {
  id: string
  sourcePaneId: string
  sourcePaneTitle: string
  provider: ProviderId
  workspaceLabel: string
  scope: 'global' | 'direct'
  targetPaneIds: string[]
  targetPaneTitles: string[]
  contentLabel: string
  summary: string
  detail: string
  consumedByPaneIds: string[]
  createdAt: number
}

export interface PaneState {
  settingsOpen: boolean
  workspaceOpen: boolean
  shellOpen: boolean
  shellCommand: string
  shellOutput: string
  shellHistory: string[]
  shellHistoryIndex: number | null
  localShellPath: string
  remoteShellPath: string
  shellRunning: boolean
  shellLastExitCode: number | null
  shellLastError: string | null
  shellLastRunAt: number | null
  id: string
  title: string
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  autonomyMode: AutonomyMode
  codexFastMode: CodexFastMode
  status: PaneStatus
  statusText: string
  runInProgress: boolean
  workspaceMode: WorkspaceMode
  localWorkspacePath: string
  localBrowserPath: string
  localBrowserEntries: LocalDirectoryEntry[]
  localBrowserLoading: boolean
  sshHost: string
  sshUser: string
  sshPort: string
  sshPassword: string
  sshIdentityFile: string
  sshProxyJump: string
  sshProxyCommand: string
  sshExtraArgs: string
  sshLocalKeys: LocalSshKey[]
  sshSelectedKeyPath: string
  sshPublicKeyText: string
  sshKeyName: string
  sshKeyComment: string
  sshDiagnostics: string[]
  sshActionState: 'idle' | 'running' | 'success' | 'error'
  sshActionMessage: string | null
  sshPasswordPulseAt: number
  sshLocalPath: string
  sshRemotePath: string
  remoteWorkspacePath: string
  remoteWorkspaces: RemoteWorkspace[]
  remoteAvailableProviders: ProviderId[]
  remoteHomeDirectory: string | null
  remoteBrowserPath: string
  remoteBrowserEntries: RemoteDirectoryEntry[]
  remoteParentPath: string | null
  remoteNewDirectoryName: string
  remoteBrowserLoading: boolean
  prompt: string
  logs: PaneLogEntry[]
  streamEntries: PaneStreamEntry[]
  sessionHistory: PaneSessionRecord[]
  selectedSessionKey: string | null
  liveOutput: string
  attachedContextIds: string[]
  sessionId: string | null
  sessionScopeKey: string | null
  autoShare: boolean
  autoShareTargetIds: string[]
  pendingShareGlobal: boolean
  pendingShareTargetIds: string[]
  currentRequestText: string | null
  currentRequestAt: number | null
  stopRequested: boolean
  stopRequestAvailable: boolean
  lastRunAt: number | null
  runningSince: number | null
  lastActivityAt: number | null
  lastFinishedAt: number | null
  lastError: string | null
  lastResponse: string | null
}

export interface RunPaneRequest {
  paneId: string
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  autonomyMode: AutonomyMode
  codexFastMode: CodexFastMode
  target: WorkspaceTarget
  prompt: string
  sessionId: string | null
  memory: PaneLogEntry[]
  sharedContext: SharedContextPayload[]
  imageAttachments: RunImageAttachment[]
}

export interface RunPaneResponse {
  success: boolean
  response: string
  statusHint: 'completed' | 'attention' | 'error'
  sessionId: string | null
}

export interface ShellRunRequest {
  paneId: string
  target: WorkspaceTarget
  command: string
  cwd: string | null
}

export type ShellRunEvent =
  | {
      type: 'stdout'
      text: string
    }
  | {
      type: 'stderr'
      text: string
    }
  | {
      type: 'cwd'
      cwd: string
    }
  | {
      type: 'exit'
      exitCode: number
      cwd: string
    }
  | {
      type: 'error'
      message: string
    }

export type RunStreamEvent =
  | {
      type: 'session'
      sessionId: string
    }
  | {
      type: 'status'
      text: string
    }
  | {
      type: 'assistant-delta'
      text: string
    }
  | {
      type: 'tool'
      text: string
    }
  | {
      type: 'stderr'
      text: string
    }
  | {
      type: 'final'
      response: string
      statusHint: 'completed' | 'attention' | 'error'
      sessionId: string | null
    }
  | {
      type: 'error'
      message: string
    }

export interface StopRunResponse {
  success: boolean
  stopped: boolean
}

export interface LocalBrowseResponse {
  success: boolean
  path: string
  entries: LocalDirectoryEntry[]
}

export interface LocalBrowseRootsResponse {
  success: boolean
  roots: LocalBrowseRoot[]
}

export interface LocalCreateDirectoryResponse {
  success: boolean
  path: string
  created: boolean
}

export interface RemoteWorkspaceResponse {
  success: boolean
  host: string
  workspaces: RemoteWorkspace[]
}

export interface RemoteBrowseResponse {
  success: boolean
  host: string
  path: string
  parentPath: string | null
  entries: RemoteDirectoryEntry[]
  homeDirectory: string | null
}

export interface RemoteCreateDirectoryResponse {
  success: boolean
  host: string
  path: string
  created: boolean
}

export interface SshInspectionResponse {
  success: boolean
  host: string
  availableProviders: ProviderId[]
  homeDirectory: string | null
  diagnostics: string[]
  localKeys: LocalSshKey[]
  suggestedUser: string | null
  suggestedPort: string | null
  suggestedIdentityFile: string | null
  suggestedProxyJump: string | null
  suggestedProxyCommand: string | null
}

export interface SshKeyGenerateResponse {
  success: boolean
  key: LocalSshKey
  created: boolean
}

export interface SshKeyDeleteResponse {
  success: boolean
  deleted: boolean
  remainingKeys: LocalSshKey[]
}

export interface SshKeyInstallResponse {
  success: boolean
  host: string
  installed: boolean
}

export interface SshKnownHostRemoveResponse {
  success: boolean
  removedHosts: string[]
}

export interface SshTransferResponse {
  success: boolean
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
}
