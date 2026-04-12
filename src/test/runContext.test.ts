import { describe, expect, it } from 'vitest'
import { createInitialPane } from '../lib/paneState'
import { selectPaneContextMemory } from '../lib/runContext'
import { buildPaneSessionScopeKey } from '../lib/providerState'
import type { BootstrapPayload, PaneState, ProviderCatalogResponse } from '../types'

function createProvider(provider: ProviderCatalogResponse['provider'], label: string): ProviderCatalogResponse {
  return {
    provider,
    label,
    source: 'test',
    fetchedAt: null,
    available: true,
    models: [{
      id: `${provider}-model`,
      name: `${label} Model`,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    }],
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
      codex: createProvider('codex', 'Codex'),
      copilot: createProvider('copilot', 'Copilot'),
      gemini: createProvider('gemini', 'Gemini')
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

function createPane(overrides: Partial<PaneState> = {}): PaneState {
  const bootstrap = createBootstrap()
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id: 'pane-1',
    title: 'Primary Pane',
    provider: 'codex',
    model: 'codex-model',
    localWorkspacePath: bootstrap.localWorkspaces[0].path,
    ...overrides
  }
}

describe('selectPaneContextMemory', () => {
  it('同一CLIの継続会話では未同期差分がなければ補助コンテキストを付けない', () => {
    const pane = createPane({
      logs: [
        { id: 'log-1', role: 'user', text: 'first user prompt', createdAt: 1, provider: 'codex', model: 'codex-model' },
        { id: 'log-2', role: 'assistant', text: 'assistant response', createdAt: 2, provider: 'codex', model: 'codex-model' }
      ],
      sessionId: 'session-codex',
      sessionScopeKey: buildPaneSessionScopeKey({
        provider: 'codex',
        model: 'codex-model',
        workspaceMode: 'local',
        localWorkspacePath: 'C:\\workspace',
        sshHost: '',
        sshUser: '',
        sshPort: '',
        remoteWorkspacePath: ''
      }),
      providerSessions: {
        codex: {
          sessionId: 'session-codex',
          sessionScopeKey: buildPaneSessionScopeKey({
            provider: 'codex',
            model: 'codex-model',
            workspaceMode: 'local',
            localWorkspacePath: 'C:\\workspace',
            sshHost: '',
            sshUser: '',
            sshPort: '',
            remoteWorkspacePath: ''
          }),
          lastSharedLogEntryId: 'log-2',
          lastSharedStreamEntryId: null,
          updatedAt: 2
        },
        copilot: { sessionId: null, sessionScopeKey: null, lastSharedLogEntryId: null, lastSharedStreamEntryId: null, updatedAt: null },
        gemini: { sessionId: null, sessionScopeKey: null, lastSharedLogEntryId: null, lastSharedStreamEntryId: null, updatedAt: null }
      }
    })

    expect(selectPaneContextMemory(pane, 'codex')).toEqual([])
  })

  it('別CLIで増えた未同期差分だけを元のCLIへ補助コンテキストとして渡す', () => {
    const pane = createPane({
      logs: [
        { id: 'log-1', role: 'user', text: 'codex request', createdAt: 1, provider: 'codex', model: 'codex-model' },
        { id: 'log-2', role: 'assistant', text: 'codex answer', createdAt: 2, provider: 'codex', model: 'codex-model' },
        { id: 'log-3', role: 'user', text: 'gemini request', createdAt: 3, provider: 'gemini', model: 'gemini-model' },
        { id: 'log-4', role: 'assistant', text: 'gemini answer', createdAt: 4, provider: 'gemini', model: 'gemini-model' }
      ],
      providerSessions: {
        codex: {
          sessionId: 'session-codex',
          sessionScopeKey: 'local::codex::codex-model::C:\\workspace',
          lastSharedLogEntryId: 'log-2',
          lastSharedStreamEntryId: null,
          updatedAt: 2
        },
        copilot: { sessionId: null, sessionScopeKey: null, lastSharedLogEntryId: null, lastSharedStreamEntryId: null, updatedAt: null },
        gemini: {
          sessionId: 'session-gemini',
          sessionScopeKey: 'local::gemini::gemini-model::C:\\workspace',
          lastSharedLogEntryId: 'log-4',
          lastSharedStreamEntryId: null,
          updatedAt: 4
        }
      }
    })

    expect(selectPaneContextMemory(pane, 'codex').map((entry) => entry.id)).toEqual(['log-3', 'log-4'])
  })
})