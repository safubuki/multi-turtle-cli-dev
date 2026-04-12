import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { useAppLifecycle } from '../lib/useAppLifecycle'
import type { BootstrapPayload, LocalWorkspace, PaneState, SharedContextItem, WorkspacePickerState } from '../types'
import type { LayoutMode } from '../lib/appCore'
import { loadPersistedState } from '../lib/storage'

const appCoreMocks = vi.hoisted(() => ({
  fetchBootstrapWithRetry: vi.fn()
}))

const storageMocks = vi.hoisted(() => ({
  persistState: vi.fn()
}))

vi.mock('../lib/appCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/appCore')>()
  return {
    ...actual,
    fetchBootstrapWithRetry: appCoreMocks.fetchBootstrapWithRetry
  }
})

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>()
  return {
    ...actual,
    persistState: storageMocks.persistState
  }
})

function createBootstrap(): BootstrapPayload {
  return {
    success: true,
    providers: {
      codex: {
        provider: 'codex',
        label: 'Codex',
        source: 'test',
        fetchedAt: null,
        available: true,
        models: [{ id: 'codex-model', name: 'Codex Model', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' }],
        versionInfo: { packageName: 'codex-cli', installedVersion: '1.0.0', latestVersion: '1.0.0', updateAvailable: false, updateCommand: 'npm i -g codex-cli', latestCheckError: null },
        error: null
      },
      copilot: {
        provider: 'copilot',
        label: 'Copilot',
        source: 'test',
        fetchedAt: null,
        available: true,
        models: [{ id: 'copilot-model', name: 'Copilot Model', supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' }],
        versionInfo: { packageName: 'copilot-cli', installedVersion: '1.0.0', latestVersion: '1.0.0', updateAvailable: false, updateCommand: 'npm i -g copilot-cli', latestCheckError: null },
        error: null
      },
      gemini: {
        provider: 'gemini',
        label: 'Gemini',
        source: 'test',
        fetchedAt: null,
        available: true,
        models: [{ id: 'gemini-model', name: 'Gemini Model', supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }],
        versionInfo: { packageName: 'gemini-cli', installedVersion: '1.0.0', latestVersion: '1.0.0', updateAvailable: false, updateCommand: 'npm i -g gemini-cli', latestCheckError: null },
        error: null
      }
    },
    localWorkspaces: [{ id: 'ws-1', label: 'Workspace', path: 'C:\\workspace', indicators: [], source: 'manual' }],
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

function useHarness() {
  const persistedRef = useRef(loadPersistedState())
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [panes, setPanes] = useState<PaneState[]>([])
  const [sharedContext, setSharedContext] = useState<SharedContextItem[]>([])
  const [layout] = useState<LayoutMode>('triple')
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalWorkspace[]>([])
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [selectedPaneIds, setSelectedPaneIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [workspacePicker, setWorkspacePicker] = useState<WorkspacePickerState | null>(null)

  const panesRef = useRef<PaneState[]>(panes)
  const localWorkspacesRef = useRef<LocalWorkspace[]>(localWorkspaces)
  const sharedContextRef = useRef<SharedContextItem[]>(sharedContext)
  const controllersRef = useRef<Record<string, AbortController>>({})
  const shellControllersRef = useRef<Record<string, AbortController>>({})
  const workspaceRefreshTimersRef = useRef<Record<string, number>>({})

  panesRef.current = panes
  localWorkspacesRef.current = localWorkspaces
  sharedContextRef.current = sharedContext

  const cleanupAllPromptImageResourcesRef = useRef(vi.fn())
  const checkBackgroundRunStatusesRef = useRef(vi.fn(async () => undefined))

  useAppLifecycle({
    persistedRef,
    bootstrap,
    panes,
    sharedContext,
    layout,
    localWorkspaces,
    focusedPaneId,
    panesRef,
    localWorkspacesRef,
    sharedContextRef,
    controllersRef,
    shellControllersRef,
    workspaceRefreshTimersRef,
    cleanupAllPromptImageResources: cleanupAllPromptImageResourcesRef.current,
    setBootstrap,
    setLocalWorkspaces,
    setPanes,
    setSharedContext,
    setFocusedPaneId,
    setSelectedPaneIds,
    setLoading,
    setGlobalError,
    setNow,
    checkBackgroundRunStatuses: checkBackgroundRunStatusesRef.current
  })

  return {
    bootstrap,
    panes,
    localWorkspaces,
    focusedPaneId,
    selectedPaneIds,
    loading,
    globalError,
    now,
    setWorkspacePicker,
    workspacePicker,
    checkBackgroundRunStatuses: checkBackgroundRunStatusesRef.current,
    cleanupAllPromptImageResources: cleanupAllPromptImageResourcesRef.current,
    setPanes,
    setBootstrap,
    setFocusedPaneId
  }
}

function useCleanupRegressionHarness(cleanupAllPromptImageResources: () => void) {
  const persistedRef = useRef(loadPersistedState())
  const [bootstrap] = useState<BootstrapPayload | null>(null)
  const [panes] = useState<PaneState[]>([])
  const [sharedContext] = useState<SharedContextItem[]>([])
  const [layout] = useState<LayoutMode>('triple')
  const [localWorkspaces] = useState<LocalWorkspace[]>([])
  const [focusedPaneId] = useState<string | null>(null)
  const [, setSelectedPaneIds] = useState<string[]>([])
  const [, setLoading] = useState(true)
  const [, setGlobalError] = useState<string | null>(null)
  const [, setNow] = useState(Date.now())

  const panesRef = useRef<PaneState[]>(panes)
  const localWorkspacesRef = useRef<LocalWorkspace[]>(localWorkspaces)
  const sharedContextRef = useRef<SharedContextItem[]>(sharedContext)
  const controllersRef = useRef<Record<string, AbortController>>({
    'pane-1': { abort: vi.fn() } as unknown as AbortController
  })
  const shellControllersRef = useRef<Record<string, AbortController>>({
    'pane-1': { abort: vi.fn() } as unknown as AbortController
  })
  const workspaceRefreshTimersRef = useRef<Record<string, number>>({})
  const checkBackgroundRunStatuses = useRef(vi.fn(async () => undefined))

  useAppLifecycle({
    persistedRef,
    bootstrap,
    panes,
    sharedContext,
    layout,
    localWorkspaces,
    focusedPaneId,
    panesRef,
    localWorkspacesRef,
    sharedContextRef,
    controllersRef,
    shellControllersRef,
    workspaceRefreshTimersRef,
    cleanupAllPromptImageResources,
    setBootstrap: vi.fn(),
    setLocalWorkspaces: vi.fn(),
    setPanes: vi.fn(),
    setSharedContext: vi.fn(),
    setFocusedPaneId: vi.fn(),
    setSelectedPaneIds,
    setLoading,
    setGlobalError,
    setNow,
    checkBackgroundRunStatuses: checkBackgroundRunStatuses.current
  })

  return {
    controllerAbort: controllersRef.current['pane-1']?.abort as unknown as ReturnType<typeof vi.fn>,
    shellControllerAbort: shellControllersRef.current['pane-1']?.abort as unknown as ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible'
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAppLifecycle', () => {
  it('初期 mount で bootstrap を取得して panes を復元する', async () => {
    appCoreMocks.fetchBootstrapWithRetry.mockResolvedValue(createBootstrap())

    const harness = renderHook(() => useHarness())

    await waitFor(() => {
      expect(harness.result.current.bootstrap).not.toBeNull()
    })

    expect(appCoreMocks.fetchBootstrapWithRetry).toHaveBeenCalled()
    expect(harness.result.current.localWorkspaces).toHaveLength(1)
    expect(harness.result.current.panes.length).toBeGreaterThan(0)
    expect(harness.result.current.loading).toBe(false)
  })

  it('persist と focus/visibility 更新を lifecycle hook が引き受ける', async () => {
    appCoreMocks.fetchBootstrapWithRetry.mockResolvedValue(createBootstrap())

    const harness = renderHook(() => useHarness())

    await waitFor(() => {
      expect(harness.result.current.bootstrap).not.toBeNull()
    })

    await waitFor(() => {
      expect(storageMocks.persistState).toHaveBeenCalled()
    })

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(appCoreMocks.fetchBootstrapWithRetry).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => {
      expect(appCoreMocks.fetchBootstrapWithRetry).toHaveBeenCalledTimes(3)
    })

    expect(harness.result.current.checkBackgroundRunStatuses).toHaveBeenCalled()
  })

  it('cleanup callback の identity が変わっても rerender で controller を abort しない', () => {
    appCoreMocks.fetchBootstrapWithRetry.mockReturnValue(new Promise(() => undefined))
    const firstCleanup = vi.fn()
    const secondCleanup = vi.fn()

    const harness = renderHook(({ cleanupFn }) => useCleanupRegressionHarness(cleanupFn), {
      initialProps: {
        cleanupFn: firstCleanup
      }
    })

    harness.rerender({ cleanupFn: secondCleanup })

    expect(harness.result.current.controllerAbort).not.toHaveBeenCalled()
    expect(harness.result.current.shellControllerAbort).not.toHaveBeenCalled()
    expect(firstCleanup).not.toHaveBeenCalled()
    expect(secondCleanup).not.toHaveBeenCalled()

    harness.unmount()

    expect(harness.result.current.controllerAbort).toHaveBeenCalledTimes(1)
    expect(harness.result.current.shellControllerAbort).toHaveBeenCalledTimes(1)
    expect(firstCleanup).not.toHaveBeenCalled()
    expect(secondCleanup).toHaveBeenCalledTimes(1)
  })
})