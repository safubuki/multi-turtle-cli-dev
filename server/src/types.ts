export type ProviderId = 'codex' | 'gemini' | 'copilot'
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
  isWorkspace: boolean
}

export interface SpecSection {
  title: string
  body: string
  bullets: string[]
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

export interface MemoryEntry {
  role: 'user' | 'assistant' | 'system'
  text: string
}

export interface SharedContextPayload {
  sourcePaneTitle: string
  provider: ProviderId
  workspaceLabel: string
  summary: string
  detail: string
}

export interface RunRequestBody {
  paneId: string
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  autonomyMode: AutonomyMode
  target: WorkspaceTarget
  prompt: string
  sessionId: string | null
  memory: MemoryEntry[]
  sharedContext: SharedContextPayload[]
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

export interface CliExecResult {
  response: string
  statusHint: 'completed' | 'attention' | 'error'
  sessionId: string | null
}

export interface ActiveCliRun {
  promise: Promise<CliExecResult>
  stop: () => void
}
