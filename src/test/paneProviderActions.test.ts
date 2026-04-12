import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaneProviderActions } from '../lib/paneProviderActions'
import { createInitialPane } from '../lib/paneState'
import { buildPaneSessionScopeKey } from '../lib/providerState'
import type { BootstrapPayload, PaneState, PromptImageAttachment, ProviderCatalogResponse } from '../types'

function createProvider(
  provider: ProviderCatalogResponse['provider'],
  label: string,
  models: ProviderCatalogResponse['models']
): ProviderCatalogResponse {
  return {
    provider,
    label,
    source: 'test',
    fetchedAt: null,
    available: true,
    models,
    versionInfo: {
      packageName: `${provider}-cli`,
      installedVersion: '1.0.0',
      latestVersion: '1.0.0',
      updateAvailable: false,
      updateCommand: `npm install -g ${provider}-cli@latest`,
      latestCheckError: null
    },
    error: null
  }
}

function createBootstrap(): BootstrapPayload {
  return {
    success: true,
    providers: {
      codex: createProvider('codex', 'Codex', [
        {
          id: 'codex-model',
          name: 'Codex Model',
          supportedReasoningEfforts: ['medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        },
        {
          id: 'codex-lite',
          name: 'Codex Lite',
          supportedReasoningEfforts: ['low', 'medium'],
          defaultReasoningEffort: 'low'
        }
      ]),
      copilot: createProvider('copilot', 'Copilot', [{
        id: 'copilot-model',
        name: 'Copilot Model',
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium'
      }]),
      gemini: createProvider('gemini', 'Gemini', [{
        id: 'gemini-model',
        name: 'Gemini Model',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }])
    },
    localWorkspaces: [{
      id: 'ws-1',
      label: 'Workspace',
      path: 'C:\\workspace',
      indicators: [],
      source: 'manual'
    }],
    sshHosts: [],
    remoteRoots: [],
    hostPlatform: 'windows',
    features: {
      vscode: true,
      ssh: true,
      remoteDiscovery: true,
      remoteBrowser: true,
      shell: true
    },
    spec: []
  }
}

function createPane(bootstrap: BootstrapPayload, overrides: Partial<PaneState> = {}): PaneState {
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id: 'pane-1',
    title: 'Provider Pane',
    provider: 'codex',
    model: 'codex-model',
    reasoningEffort: 'xhigh',
    localWorkspacePath: bootstrap.localWorkspaces[0].path,
    localShellPath: bootstrap.localWorkspaces[0].path,
    ...overrides
  }
}

function createReadyImage(): PromptImageAttachment {
  return {
    id: 'img-1',
    fileName: 'diagram.png',
    mimeType: 'image/png',
    size: 128,
    localPath: 'C:\\temp\\diagram.png',
    previewUrl: 'blob:diagram',
    status: 'ready',
    source: 'picker',
    error: null
  }
}

function createProviderHarness(options: {
  paneOverrides?: Partial<PaneState>
  attachments?: PromptImageAttachment[]
} = {}) {
  const bootstrap = createBootstrap()
  let panes = [createPane(bootstrap, options.paneOverrides)]
  let paneImageAttachments: Record<string, PromptImageAttachment[]> = {
    [panes[0].id]: options.attachments ?? []
  }

  const panesRef = { current: panes }
  const paneImageAttachmentsRef = { current: paneImageAttachments }

  const mutatePane = (paneId: string, updater: (pane: PaneState) => PaneState) => {
    panes = panes.map((pane) => (pane.id === paneId ? updater(pane) : pane))
    panesRef.current = panes
  }

  const clearPanePromptImages = vi.fn((paneId: string) => {
    paneImageAttachments = { ...paneImageAttachments, [paneId]: [] }
    paneImageAttachmentsRef.current = paneImageAttachments
  })

  const actions = createPaneProviderActions({
    bootstrap,
    panesRef,
    paneImageAttachmentsRef,
    clearPanePromptImages,
    mutatePane
  })

  return {
    actions,
    bootstrap,
    clearPanePromptImages,
    get pane() {
      return panes[0]
    },
    get attachments() {
      return paneImageAttachments['pane-1'] ?? []
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPaneProviderActions', () => {
  it('provider 切り替えで既存 native session を再利用し、必要なら画像添付を解除する', () => {
    const bootstrap = createBootstrap()
    const geminiScopeKey = buildPaneSessionScopeKey({
      provider: 'gemini',
      model: 'gemini-model',
      workspaceMode: 'local',
      localWorkspacePath: bootstrap.localWorkspaces[0].path,
      sshHost: '',
      sshUser: '',
      sshPort: '',
      remoteWorkspacePath: ''
    })

    const harness = createProviderHarness({
      paneOverrides: {
        providerSessions: {
          codex: { sessionId: 'session-codex', sessionScopeKey: 'codex-scope', lastSharedLogEntryId: null, lastSharedStreamEntryId: null, updatedAt: null },
          copilot: { sessionId: null, sessionScopeKey: null, lastSharedLogEntryId: null, lastSharedStreamEntryId: null, updatedAt: null },
          gemini: { sessionId: 'session-gemini', sessionScopeKey: geminiScopeKey, lastSharedLogEntryId: null, lastSharedStreamEntryId: null, updatedAt: 1 }
        }
      },
      attachments: [createReadyImage()]
    })

    harness.actions.handleProviderChange('pane-1', 'copilot')

    expect(harness.clearPanePromptImages).toHaveBeenCalledWith('pane-1')
    expect(harness.attachments).toEqual([])
    expect(harness.pane.provider).toBe('copilot')
    expect(harness.pane.model).toBe('copilot-model')
    expect(harness.pane.codexFastMode).toBe('off')
    expect(harness.pane.status).toBe('attention')
    expect(harness.pane.lastError).toContain('画像入力未対応')

    harness.actions.handleProviderChange('pane-1', 'gemini')

    expect(harness.pane.provider).toBe('gemini')
    expect(harness.pane.model).toBe('gemini-model')
    expect(harness.pane.sessionId).toBe('session-gemini')
    expect(harness.pane.sessionScopeKey).toBe(geminiScopeKey)
    expect(harness.pane.streamEntries.at(-1)?.text).toContain('native session: 再利用 (session-gemini)')
  })

  it('model 切り替えで unsupported な reasoning を補正し、session をリセットする', () => {
    const harness = createProviderHarness({
      paneOverrides: {
        sessionId: 'session-1',
        sessionScopeKey: 'scope-1',
        selectedSessionKey: 'selected-1',
        reasoningEffort: 'xhigh'
      }
    })

    harness.actions.handleModelChange('pane-1', 'codex-lite')

    expect(harness.pane.model).toBe('codex-lite')
    expect(harness.pane.reasoningEffort).toBe('low')
    expect(harness.pane.sessionId).toBeNull()
    expect(harness.pane.sessionScopeKey).toBeNull()
    expect(harness.pane.selectedSessionKey).toBeNull()
  })

  it('reasoning・autonomy・fast mode を current provider settings に同期する', () => {
    const harness = createProviderHarness({
      paneOverrides: {
        reasoningEffort: 'xhigh',
        autonomyMode: 'balanced',
        codexFastMode: 'off'
      }
    })

    harness.actions.handleReasoningEffortChange('pane-1', 'low')
    harness.actions.handleAutonomyModeChange('pane-1', 'max')
    harness.actions.handleCodexFastModeChange('pane-1', 'fast')

    expect(harness.pane.reasoningEffort).toBe('medium')
    expect(harness.pane.autonomyMode).toBe('max')
    expect(harness.pane.codexFastMode).toBe('fast')
    expect(harness.pane.providerSettings.codex.reasoningEffort).toBe('medium')
    expect(harness.pane.providerSettings.codex.autonomyMode).toBe('max')
    expect(harness.pane.providerSettings.codex.codexFastMode).toBe('fast')
  })
})