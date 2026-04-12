import type { SetStateAction } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialPane } from '../lib/paneState'
import { createPaneLifecycleActions } from '../lib/paneLifecycleActions'
import type { BootstrapPayload, PaneState, ProviderCatalogResponse } from '../types'

const apiMocks = vi.hoisted(() => ({
  stopPaneRun: vi.fn(),
  stopShellRun: vi.fn()
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    stopPaneRun: apiMocks.stopPaneRun,
    stopShellRun: apiMocks.stopShellRun
  }
})

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

function createPane(bootstrap: BootstrapPayload, id: string, title: string, overrides: Partial<PaneState> = {}): PaneState {
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id,
    title,
    ...overrides
  }
}

function createLifecycleHarness(options: {
  bootstrap?: BootstrapPayload | null
  panes?: PaneState[]
  selectedPaneIds?: string[]
} = {}) {
  const bootstrap = options.bootstrap ?? createBootstrap()
  let panes = options.panes ?? [
    createPane(bootstrap, 'pane-a', 'Pane A'),
    createPane(bootstrap, 'pane-b', 'Pane B'),
    createPane(bootstrap, 'pane-c', 'Pane C')
  ]
  let focusedPaneId: string | null = panes[0]?.id ?? null
  let selectedPaneIds = options.selectedPaneIds ?? []

  const panesRef = { current: panes }
  const localWorkspacesRef = { current: bootstrap?.localWorkspaces ?? [] }
  const controllersRef = { current: {} as Record<string, AbortController> }
  const stopRequestedRef = { current: new Set<string>() }
  const shellControllersRef = { current: {} as Record<string, AbortController> }
  const shellStopRequestedRef = { current: new Set<string>() }

  const setPanes = vi.fn((update: SetStateAction<PaneState[]>) => {
    panes = applyStateUpdate(panes, update)
    panesRef.current = panes
  })
  const setFocusedPaneId = vi.fn((update: SetStateAction<string | null>) => {
    focusedPaneId = applyStateUpdate(focusedPaneId, update)
  })
  const setSelectedPaneIds = vi.fn((update: SetStateAction<string[]>) => {
    selectedPaneIds = applyStateUpdate(selectedPaneIds, update)
  })

  const clearMultiplePanePromptImages = vi.fn()
  const pruneSharedContextForDeletedPanes = vi.fn(() => ['ctx-removed'])

  const actions = createPaneLifecycleActions({
    bootstrap,
    panesRef,
    localWorkspacesRef,
    controllersRef,
    stopRequestedRef,
    shellControllersRef,
    shellStopRequestedRef,
    selectedPaneIds,
    setPanes,
    setFocusedPaneId,
    setSelectedPaneIds,
    clearMultiplePanePromptImages,
    pruneSharedContextForDeletedPanes
  })

  return {
    actions,
    controllersRef,
    stopRequestedRef,
    shellControllersRef,
    shellStopRequestedRef,
    clearMultiplePanePromptImages,
    pruneSharedContextForDeletedPanes,
    get panes() {
      return panes
    },
    get focusedPaneId() {
      return focusedPaneId
    },
    get selectedPaneIds() {
      return selectedPaneIds
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.stopPaneRun.mockResolvedValue({ success: true, stopped: true })
  apiMocks.stopShellRun.mockResolvedValue({ success: true, stopped: true })
})

describe('createPaneLifecycleActions', () => {
  it('closeAllPaneAccordions ですべての accordion を閉じる', () => {
    const bootstrap = createBootstrap()
    const harness = createLifecycleHarness({
      panes: [
        createPane(bootstrap, 'pane-a', 'Pane A', { settingsOpen: true, workspaceOpen: true, shellOpen: true }),
        createPane(bootstrap, 'pane-b', 'Pane B', { settingsOpen: true, workspaceOpen: false, shellOpen: true })
      ]
    })

    harness.actions.closeAllPaneAccordions()

    expect(harness.panes.every((pane) => !pane.settingsOpen && !pane.workspaceOpen && !pane.shellOpen)).toBe(true)
  })

  it('handleDuplicatePane は実行中状態を持ち越さず複製する', () => {
    const bootstrap = createBootstrap()
    const harness = createLifecycleHarness({
      panes: [
        createPane(bootstrap, 'pane-a', 'Pane A', {
          status: 'running',
          statusText: '実行中',
          runInProgress: true,
          prompt: 'Keep this?',
          sessionId: 'session-1',
          sessionScopeKey: 'scope-1',
          currentRequestText: 'request',
          logs: [{ id: 'log-1', role: 'assistant', text: 'answer', createdAt: 1 }],
          streamEntries: [{ id: 'stream-1', kind: 'system', text: 'running', createdAt: 1 }],
          lastResponse: 'answer'
        })
      ]
    })

    harness.actions.handleDuplicatePane('pane-a')

    expect(harness.panes).toHaveLength(2)
    const duplicated = harness.panes[1]
    expect(duplicated.id).not.toBe('pane-a')
    expect(duplicated.title).toBe('Pane A copy')
    expect(duplicated.status).toBe('idle')
    expect(duplicated.runInProgress).toBe(false)
    expect(duplicated.prompt).toBe('')
    expect(duplicated.logs).toEqual([])
    expect(duplicated.streamEntries).toEqual([])
    expect(duplicated.sessionId).toBeNull()
    expect(harness.focusedPaneId).toBe(duplicated.id)
  })

  it('handleDeleteSelectedPanes は確認後に選択ペインを削除し、controller と shared context cleanup を実行する', () => {
    const bootstrap = createBootstrap()
    const paneA = createPane(bootstrap, 'pane-a', 'Pane A', { attachedContextIds: ['ctx-removed', 'ctx-keep'] })
    const paneB = createPane(bootstrap, 'pane-b', 'Pane B')
    const paneC = createPane(bootstrap, 'pane-c', 'Pane C')
    const harness = createLifecycleHarness({
      panes: [paneA, paneB, paneC],
      selectedPaneIds: ['pane-b', 'pane-c']
    })

    const controllerB = new AbortController()
    const controllerC = new AbortController()
    const shellControllerB = new AbortController()
    const shellControllerC = new AbortController()
    const abortControllerB = vi.spyOn(controllerB, 'abort')
    const abortControllerC = vi.spyOn(controllerC, 'abort')
    const abortShellB = vi.spyOn(shellControllerB, 'abort')
    const abortShellC = vi.spyOn(shellControllerC, 'abort')
    harness.controllersRef.current['pane-b'] = controllerB
    harness.controllersRef.current['pane-c'] = controllerC
    harness.shellControllersRef.current['pane-b'] = shellControllerB
    harness.shellControllersRef.current['pane-c'] = shellControllerC

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    harness.actions.handleDeleteSelectedPanes()

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(harness.clearMultiplePanePromptImages).toHaveBeenCalledWith(['pane-b', 'pane-c'])
    expect(harness.pruneSharedContextForDeletedPanes).toHaveBeenCalledWith(['pane-b', 'pane-c'])
    expect(abortControllerB).toHaveBeenCalledOnce()
    expect(abortControllerC).toHaveBeenCalledOnce()
    expect(abortShellB).toHaveBeenCalledOnce()
    expect(abortShellC).toHaveBeenCalledOnce()
    expect(apiMocks.stopPaneRun).toHaveBeenCalledWith('pane-b')
    expect(apiMocks.stopPaneRun).toHaveBeenCalledWith('pane-c')
    expect(apiMocks.stopShellRun).toHaveBeenCalledWith('pane-b')
    expect(apiMocks.stopShellRun).toHaveBeenCalledWith('pane-c')
    expect(harness.stopRequestedRef.current.has('pane-b')).toBe(true)
    expect(harness.stopRequestedRef.current.has('pane-c')).toBe(true)
    expect(harness.shellStopRequestedRef.current.has('pane-b')).toBe(true)
    expect(harness.shellStopRequestedRef.current.has('pane-c')).toBe(true)
    expect(harness.panes.map((pane) => pane.id)).toEqual(['pane-a'])
    expect(harness.panes[0].attachedContextIds).toEqual(['ctx-keep'])
    expect(harness.focusedPaneId).toBe('pane-a')
    expect(harness.selectedPaneIds).toEqual([])
  })

  it('deletePanesById は最後の pane を消したとき replacement pane を補充する', () => {
    const bootstrap = createBootstrap()
    const harness = createLifecycleHarness({
      panes: [createPane(bootstrap, 'pane-only', 'Pane Only')]
    })

    harness.actions.deletePanesById(['pane-only'])

    expect(harness.panes).toHaveLength(1)
    expect(harness.panes[0].id).not.toBe('pane-only')
    expect(harness.focusedPaneId).toBe(harness.panes[0].id)
  })
})