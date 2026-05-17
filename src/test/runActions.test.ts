import type { SetStateAction } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRunActions } from '../lib/runActions'
import { createInitialPane } from '../lib/paneState'
import type {
  BootstrapPayload,
  PaneState,
  PreviewRunCommandResponse,
  PromptImageAttachment,
  ProviderCatalogResponse,
  SharedContextItem
} from '../types'

const apiMocks = vi.hoisted(() => ({
  fetchPaneRunStatus: vi.fn(),
  previewRunCommand: vi.fn(),
  runPaneStream: vi.fn(),
  stopPaneRun: vi.fn()
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchPaneRunStatus: apiMocks.fetchPaneRunStatus,
    previewRunCommand: apiMocks.previewRunCommand,
    runPaneStream: apiMocks.runPaneStream,
    stopPaneRun: apiMocks.stopPaneRun
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

function createBootstrap(localWorkspacePath = 'C:\\workspace'): BootstrapPayload {
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
      path: localWorkspacePath,
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

function createSharedContextItem(paneId: string, overrides: Partial<SharedContextItem> = {}): SharedContextItem {
  return {
    id: 'ctx-1',
    sourcePaneId: 'pane-source',
    sourcePaneTitle: 'Source Pane',
    provider: 'codex',
    workspaceLabel: 'Workspace',
    scope: 'direct',
    targetPaneIds: [paneId],
    targetPaneTitles: ['Primary Pane'],
    contentLabel: '最新結果',
    summary: 'Summary',
    detail: 'Shared context detail',
    consumedByPaneIds: [],
    createdAt: 1,
    ...overrides
  }
}

function createReadyImageAttachment(): PromptImageAttachment {
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

function createPane(bootstrap: BootstrapPayload, overrides: Partial<PaneState> = {}): PaneState {
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id: 'pane-1',
    title: 'Primary Pane',
    provider: 'codex',
    model: 'codex-model',
    localWorkspacePath: bootstrap.localWorkspaces[0].path,
    localShellPath: bootstrap.localWorkspaces[0].path,
    prompt: 'Investigate the failing workflow',
    ...overrides
  }
}

function createRunHarness(options: {
  paneOverrides?: Partial<PaneState>
  sharedContext?: SharedContextItem[]
  attachments?: PromptImageAttachment[]
} = {}) {
  const bootstrap = createBootstrap()
  let panes = [createPane(bootstrap, options.paneOverrides)]
  let sharedContext = options.sharedContext ?? []
  let paneImageAttachments: Record<string, PromptImageAttachment[]> = {
    [panes[0].id]: options.attachments ?? []
  }

  const panesRef = { current: panes }
  const sharedContextRef = { current: sharedContext }
  const localWorkspacesRef = { current: bootstrap.localWorkspaces }
  const paneImageAttachmentsRef = { current: paneImageAttachments }
  const controllersRef = { current: {} as Record<string, AbortController> }
  const stopRequestedRef = { current: new Set<string>() }
  const streamErroredRef = { current: new Set<string>() }
  const streamStatusThrottleRef = { current: {} as Record<string, { text: string; at: number }> }
  const runStatusCheckInFlightRef = { current: false }

  const updatePanes = (next: PaneState[]) => {
    panes = next
    panesRef.current = next
  }

  const updatePane = (paneId: string, updates: Partial<PaneState>) => {
    updatePanes(panes.map((pane) => (pane.id === paneId ? { ...pane, ...updates } : pane)))
  }

  const mutatePane = (paneId: string, updater: (pane: PaneState) => PaneState) => {
    updatePanes(panes.map((pane) => (pane.id === paneId ? updater(pane) : pane)))
  }

  const setSharedContext = vi.fn((update: SetStateAction<SharedContextItem[]>) => {
    sharedContext = applyStateUpdate(sharedContext, update)
    sharedContextRef.current = sharedContext
  })

  const queuePromptImageCleanup = vi.fn()
  const clearPanePromptImages = vi.fn((paneId: string) => {
    paneImageAttachments = { ...paneImageAttachments, [paneId]: [] }
    paneImageAttachmentsRef.current = paneImageAttachments
  })
  const flushQueuedPromptImageCleanup = vi.fn()
  const scheduleWorkspaceContentsRefresh = vi.fn()
  const setPendingShareSelection = vi.fn(() => true)
  const requestWorkspaceSelection = vi.fn()

  const actions = createRunActions({
    bootstrap,
    panesRef,
    sharedContextRef,
    localWorkspacesRef,
    paneImageAttachmentsRef,
    controllersRef,
    stopRequestedRef,
    streamErroredRef,
    streamStatusThrottleRef,
    runStatusCheckInFlightRef,
    setSharedContext,
    updatePane,
    mutatePane,
    queuePromptImageCleanup,
    clearPanePromptImages,
    flushQueuedPromptImageCleanup,
    scheduleWorkspaceContentsRefresh,
    setPendingShareSelection,
    requestWorkspaceSelection
  })

  return {
    actions,
    bootstrap,
    panesRef,
    controllersRef,
    queuePromptImageCleanup,
    clearPanePromptImages,
    flushQueuedPromptImageCleanup,
    scheduleWorkspaceContentsRefresh,
    setPendingShareSelection,
    requestWorkspaceSelection,
    get pane() {
      return panes[0]
    },
    get sharedContext() {
      return sharedContext
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRunActions', () => {
  it('preview では空プロンプトでもコマンドを生成できる', async () => {
    const previewResponse: PreviewRunCommandResponse = {
      success: true,
      commandLine: 'codex --model codex-model',
      stdinPrompt: null,
      effectivePrompt: '',
      workingDirectory: 'C:\\workspace',
      notes: []
    }
    apiMocks.previewRunCommand.mockResolvedValue(previewResponse)

    const harness = createRunHarness({
      paneOverrides: {
        prompt: ''
      }
    })

    const preview = await harness.actions.handlePreviewRunCommand('pane-1')

    expect(apiMocks.previewRunCommand).toHaveBeenCalledWith(expect.objectContaining({
      paneId: 'pane-1',
      prompt: '',
      target: expect.objectContaining({
        kind: 'local',
        path: 'C:\\workspace'
      })
    }))
    expect(preview.structuredInput && preview.structuredInput.length).toBeGreaterThan(0)
  })

  it('run で shared context と画像を引き継ぎ、final で完了状態へ遷移する', async () => {
    apiMocks.runPaneStream.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'session', sessionId: 'session-1' })
      onEvent({ type: 'assistant-delta', text: 'partial answer' })
      onEvent({
        type: 'final',
        response: 'Completed answer',
        statusHint: 'completed',
        sessionId: 'session-1'
      })
    })

    const harness = createRunHarness({
      paneOverrides: {
        attachedContextIds: ['ctx-1']
      },
      sharedContext: [createSharedContextItem('pane-1')],
      attachments: [createReadyImageAttachment()]
    })

    await harness.actions.handleRun('pane-1')

    expect(apiMocks.runPaneStream).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: 'pane-1',
        prompt: 'Investigate the failing workflow',
        sharedContext: [expect.objectContaining({ detail: 'Shared context detail' })],
        imageAttachments: [{
          fileName: 'diagram.png',
          mimeType: 'image/png',
          size: 128,
          localPath: 'C:\\temp\\diagram.png'
        }]
      }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(harness.queuePromptImageCleanup).toHaveBeenCalledWith('pane-1', ['C:\\temp\\diagram.png'])
    expect(harness.clearPanePromptImages).toHaveBeenCalledWith('pane-1', { cleanupFiles: false })
    expect(harness.flushQueuedPromptImageCleanup).toHaveBeenCalledWith('pane-1')
    expect(harness.sharedContext).toEqual([])
    expect(harness.pane.attachedContextIds).toEqual([])
    expect(harness.pane.status).toBe('completed')
    expect(harness.pane.runInProgress).toBe(false)
    expect(harness.pane.lastResponse).toBe('Completed answer')
    expect(harness.pane.sessionId).toBe('session-1')
    expect(harness.scheduleWorkspaceContentsRefresh).toHaveBeenCalledWith('pane-1')
  })

  it('started 前に失敗した場合は prompt と shared context と画像を保持する', async () => {
    apiMocks.runPaneStream.mockRejectedValue(new Error('network failed'))

    const harness = createRunHarness({
      paneOverrides: {
        attachedContextIds: ['ctx-1']
      },
      sharedContext: [createSharedContextItem('pane-1')],
      attachments: [createReadyImageAttachment()]
    })

    await harness.actions.handleRun('pane-1')

    expect(harness.pane.prompt).toBe('Investigate the failing workflow')
    expect(harness.pane.logs.filter((entry) => entry.role === 'user')).toHaveLength(0)
    expect(harness.pane.providerSessions.codex.lastSharedLogEntryId).toBeNull()
    expect(harness.pane.attachedContextIds).toEqual(['ctx-1'])
    expect(harness.pane.currentRequestText).toBeNull()
    expect(harness.sharedContext).toEqual([expect.objectContaining({ id: 'ctx-1' })])
    expect(harness.clearPanePromptImages).not.toHaveBeenCalled()
    expect(harness.queuePromptImageCleanup).not.toHaveBeenCalled()
  })

  it('ワークスペース未選択で run すると選択導線を要求する', async () => {
    const harness = createRunHarness({
      paneOverrides: {
        localWorkspacePath: '',
        localShellPath: ''
      }
    })

    await harness.actions.handleRun('pane-1')

    expect(harness.requestWorkspaceSelection).toHaveBeenCalledWith('pane-1')
    expect(apiMocks.runPaneStream).not.toHaveBeenCalled()
    expect(harness.pane.statusText).toBe('ワークスペースを選択してください')
    expect(harness.pane.lastError).toBe('ワークスペースが未設定です。')
  })

  it('共有コンテキストは上限付きで送信し、未送信分は attached のまま残す', async () => {
    apiMocks.runPaneStream.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'started' })
      onEvent({
        type: 'final',
        response: 'Completed answer',
        statusHint: 'completed',
        sessionId: 'session-1'
      })
    })

    const sharedContexts = [
      createSharedContextItem('pane-1', { id: 'ctx-1', detail: 'A'.repeat(2_500) }),
      createSharedContextItem('pane-1', { id: 'ctx-2', detail: 'B'.repeat(2_500) }),
      createSharedContextItem('pane-1', { id: 'ctx-3', detail: 'C'.repeat(2_500) }),
      createSharedContextItem('pane-1', { id: 'ctx-4', detail: 'D'.repeat(2_500) })
    ]

    const harness = createRunHarness({
      paneOverrides: {
        attachedContextIds: ['ctx-1', 'ctx-2', 'ctx-3', 'ctx-4']
      },
      sharedContext: sharedContexts
    })

    await harness.actions.handleRun('pane-1')

    const sentSharedContext = apiMocks.runPaneStream.mock.calls[0]?.[0].sharedContext
    const totalDetailLength = sentSharedContext.reduce((sum: number, item: { detail: string }) => sum + item.detail.length, 0)

    expect(sentSharedContext).toHaveLength(3)
    expect(sentSharedContext.every((item: { detail: string }) => item.detail.length <= 4_000)).toBe(true)
    expect(totalDetailLength).toBeLessThanOrEqual(8_000)
    expect(harness.pane.attachedContextIds).toEqual(['ctx-4'])
    expect(harness.sharedContext).toEqual([expect.objectContaining({ id: 'ctx-4' })])
  })

  it('stderr の専用要約は generic warning final で上書きしない', async () => {
    apiMocks.runPaneStream.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'stderr', text: 'windows sandbox: CreateProcessWithLogonW failed: 1056' })
      onEvent({
        type: 'final',
        response: 'Partial response',
        statusHint: 'attention',
        sessionId: 'session-1',
        warningMessage: '標準エラー出力がありました。Run Log を確認してください。',
        warningStatusText: 'ログ確認が必要です'
      })
    })

    const harness = createRunHarness()

    await harness.actions.handleRun('pane-1')

    expect(harness.pane.status).toBe('attention')
    expect(harness.pane.statusText).toBe('Codex の sandbox 起動に失敗しました')
    expect(harness.pane.lastError).toContain('CreateProcessWithLogonW failed: 1056')
  })

  it('stop は server stop を送ってからローカル controller を abort する', async () => {
    apiMocks.stopPaneRun.mockResolvedValue({ success: true, stopped: true })

    const harness = createRunHarness({
      paneOverrides: {
        status: 'running',
        statusText: '実行中',
        runInProgress: true
      }
    })
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, 'abort')
    harness.controllersRef.current['pane-1'] = controller

    await harness.actions.handleStop('pane-1')

    expect(apiMocks.stopPaneRun).toHaveBeenCalledWith('pane-1')
    expect(abortSpy).toHaveBeenCalledOnce()
    expect(apiMocks.stopPaneRun.mock.invocationCallOrder[0]).toBeLessThan(abortSpy.mock.invocationCallOrder[0])
    expect(harness.pane.stopRequested).toBe(true)
    expect(harness.pane.statusText).toBe('停止要求を送信中')
  })

  it('background status check で completed を復元できる', async () => {
    apiMocks.fetchPaneRunStatus.mockResolvedValue({
      success: true,
      status: 'completed',
      result: {
        success: true,
        response: 'Recovered output',
        statusHint: 'completed',
        sessionId: 'session-recovered'
      }
    })

    const harness = createRunHarness({
      paneOverrides: {
        status: 'running',
        statusText: '実行中',
        runInProgress: true,
        lastRunAt: 10,
        runningSince: 10,
        lastActivityAt: 10
      }
    })

    await harness.actions.checkBackgroundRunStatuses()

    expect(apiMocks.fetchPaneRunStatus).toHaveBeenCalledWith('pane-1')
    expect(harness.pane.status).toBe('completed')
    expect(harness.pane.runInProgress).toBe(false)
    expect(harness.pane.lastResponse).toBe('Recovered output')
    expect(harness.pane.sessionId).toBe('session-recovered')
    expect(harness.scheduleWorkspaceContentsRefresh).toHaveBeenCalledWith('pane-1')
  })

  it('background status check の completed 復元でも pending share を確定する', async () => {
    apiMocks.fetchPaneRunStatus.mockResolvedValue({
      success: true,
      status: 'completed',
      result: {
        success: true,
        response: 'Recovered output',
        statusHint: 'completed',
        sessionId: 'session-recovered'
      }
    })

    const harness = createRunHarness({
      paneOverrides: {
        status: 'running',
        statusText: '実行中',
        runInProgress: true,
        lastRunAt: 10,
        runningSince: 10,
        lastActivityAt: 10,
        pendingShareTargetIds: ['pane-2']
      }
    })

    await harness.actions.checkBackgroundRunStatuses()

    expect(harness.setPendingShareSelection).toHaveBeenCalledWith('pane-1', 'Recovered output', {
      mode: 'direct',
      targetPaneIds: ['pane-2']
    })
  })
})