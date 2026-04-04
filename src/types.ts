export type ProviderId = 'codex' | 'gemini' | 'copilot'
export type PaneStatus = 'idle' | 'running' | 'completed' | 'attention' | 'error'
export type WorkspaceMode = 'local' | 'ssh'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type AutonomyMode = 'balanced' | 'max'
export type HostPlatform = 'windows' | 'linux' | 'macos' | 'unknown'

export interface ProviderModelInfo {
  id: string
  name: string
  description?: string
  supportedReasoningEfforts: ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort | null
}

export interface ProviderCatalogResponse {
  provider: ProviderId
  label: string
  source: string
  fetchedAt: string | null
  available: boolean
  models: ProviderModelInfo[]
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
  }
  spec: SpecSection[]
}

export type WorkspaceTarget =
  | {
      kind: 'local'
      path: string
      label: string
      resourceType?: 'folder' | 'file'
    }
  | {
      kind: 'ssh'
      host: string
      path: string
      label: string
      resourceType?: 'folder' | 'file'
      connection?: SshConnectionOptions
    }

export interface PaneLogEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
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
  createdAt: number
}

export interface PaneState {
  id: string
  title: string
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  autonomyMode: AutonomyMode
  status: PaneStatus
  statusText: string
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
  sshDiagnostics: string[]
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
  autoShare: boolean
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
  target: WorkspaceTarget
  prompt: string
  sessionId: string | null
  memory: PaneLogEntry[]
  sharedContext: SharedContextItem[]
}

export interface RunPaneResponse {
  success: boolean
  response: string
  statusHint: 'completed' | 'attention' | 'error'
  sessionId: string | null
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
}

export interface SshKeyInstallResponse {
  success: boolean
  host: string
  installed: boolean
}

export interface SshTransferResponse {
  success: boolean
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
}
