export type ProviderId = 'codex' | 'gemini' | 'copilot'
export type PaneStatus = 'idle' | 'running' | 'completed' | 'attention' | 'error'
export type WorkspaceMode = 'local' | 'ssh'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type AutonomyMode = 'balanced' | 'max'

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

export interface SshHost {
  id: string
  alias: string
  hostname?: string
  user?: string
  port?: string
  source: 'ssh-config' | 'manual'
}

export interface RemoteWorkspace {
  label: string
  path: string
}

export interface RemoteDirectoryEntry {
  label: string
  path: string
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
  features: {
    vscode: boolean
    ssh: boolean
    remoteDiscovery: boolean
    remoteBrowser: boolean
  }
  spec: SpecSection[]
}

export interface WorkspaceTarget {
  kind: 'local' | 'ssh'
  path: string
  label: string
  host?: string
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

export interface SharedContextItem {
  id: string
  sourcePaneId: string
  sourcePaneTitle: string
  provider: ProviderId
  workspaceLabel: string
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
}
