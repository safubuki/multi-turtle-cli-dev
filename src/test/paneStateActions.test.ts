import type { SetStateAction } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaneStateActions } from '../lib/paneStateActions'
import { createInitialPane } from '../lib/paneState'
import type { BootstrapPayload, LocalSshKey, PaneState, ProviderCatalogResponse } from '../types'

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

function applyStateUpdate<T>(current: T, update: SetStateAction<T>): T {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update
}

function createPane(bootstrap: BootstrapPayload, id: string, overrides: Partial<PaneState> = {}): PaneState {
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id,
    title: id,
    workspaceMode: 'ssh',
    ...overrides
  }
}

function createLocalSshKey(): LocalSshKey {
  return {
    id: 'key-1',
    name: 'id_ed25519-test',
    publicKeyPath: 'C:\\Users\\me\\.ssh\\id_ed25519-test.pub',
    privateKeyPath: 'C:\\Users\\me\\.ssh\\id_ed25519-test',
    publicKey: 'ssh-ed25519 AAAATEST user@test',
    algorithm: 'ed25519',
    comment: 'user@test'
  }
}

function createHarness(options: { panes?: PaneState[] } = {}) {
  const bootstrap = createBootstrap()
  let panes = options.panes ?? [createPane(bootstrap, 'pane-a')]

  const setPanes = vi.fn((update: SetStateAction<PaneState[]>) => {
    panes = applyStateUpdate(panes, update)
  })

  const actions = createPaneStateActions({ setPanes })

  return {
    actions,
    get panes() {
      return panes
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPaneStateActions', () => {
  it('通常更新では current provider settings を同期する', () => {
    const bootstrap = createBootstrap()
    const harness = createHarness({
      panes: [createPane(bootstrap, 'pane-a', { autonomyMode: 'balanced' })]
    })

    harness.actions.updatePane('pane-a', { autonomyMode: 'max' })

    expect(harness.panes[0].autonomyMode).toBe('max')
    expect(harness.panes[0].providerSettings.codex.autonomyMode).toBe('max')
  })

  it('sshHost 更新では reusable pane から鍵情報を補完する', () => {
    const bootstrap = createBootstrap()
    const sharedKey = createLocalSshKey()
    const harness = createHarness({
      panes: [
        createPane(bootstrap, 'pane-a', {
          sshHost: '',
          sshLocalKeys: [],
          sshSelectedKeyPath: '',
          sshIdentityFile: '',
          sshPublicKeyText: '',
          sshKeyName: '',
          sshKeyComment: ''
        }),
        createPane(bootstrap, 'pane-b', {
          sshHost: 'shared-host',
          sshLocalKeys: [sharedKey],
          sshSelectedKeyPath: sharedKey.privateKeyPath,
          sshIdentityFile: sharedKey.privateKeyPath,
          sshPublicKeyText: sharedKey.publicKey,
          sshKeyName: sharedKey.name,
          sshKeyComment: sharedKey.comment,
          lastActivityAt: 10
        })
      ]
    })

    harness.actions.updatePane('pane-a', { sshHost: 'shared-host' })

    expect(harness.panes[0].sshHost).toBe('shared-host')
    expect(harness.panes[0].sshLocalKeys).toEqual([sharedKey])
    expect(harness.panes[0].sshSelectedKeyPath).toBe(sharedKey.privateKeyPath)
    expect(harness.panes[0].sshIdentityFile).toBe(sharedKey.privateKeyPath)
    expect(harness.panes[0].sshPublicKeyText).toBe(sharedKey.publicKey)
    expect(harness.panes[0].sshKeyName).toBe(sharedKey.name)
    expect(harness.panes[0].sshKeyComment).toBe(sharedKey.comment)
  })

  it('appendPaneSystemMessage は streamEntries と lastActivityAt を更新する', () => {
    const bootstrap = createBootstrap()
    const harness = createHarness({
      panes: [createPane(bootstrap, 'pane-a')]
    })

    harness.actions.appendPaneSystemMessage('pane-a', 'system message')

    expect(harness.panes[0].streamEntries.at(-1)?.kind).toBe('system')
    expect(harness.panes[0].streamEntries.at(-1)?.text).toBe('system message')
    expect(harness.panes[0].lastActivityAt).not.toBeNull()
  })
})