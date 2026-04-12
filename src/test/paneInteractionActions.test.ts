import type { SetStateAction } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reorderPanesById, type LayoutMode } from '../lib/appCore'
import { createPaneInteractionActions } from '../lib/paneInteractionActions'
import { createInitialPane } from '../lib/paneState'
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

function applyStateUpdate<T>(current: T, update: SetStateAction<T>): T {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update
}

function createPane(bootstrap: BootstrapPayload, id: string, title: string): PaneState {
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id,
    title
  }
}

function createDragEvent() {
  const payload: Record<string, string> = {}
  const preventDefault = vi.fn()
  const setData = vi.fn((format: string, value: string) => {
    payload[format] = value
  })

  return {
    preventDefault,
    dataTransfer: {
      effectAllowed: '',
      dropEffect: '',
      getData: (format: string) => payload[format] ?? '',
      setData
    }
  }
}

function createInteractionHarness(layout: LayoutMode = 'triple') {
  const bootstrap = createBootstrap()
  let panes = [
    createPane(bootstrap, 'pane-a', 'Pane A'),
    createPane(bootstrap, 'pane-b', 'Pane B'),
    createPane(bootstrap, 'pane-c', 'Pane C')
  ]
  let focusedPaneId: string | null = null
  let selectedPaneIds: string[] = ['pane-a']
  let draggedPaneId: string | null = null
  let matrixDropTargetId: string | null = null

  const panesRef = { current: panes }
  const draggedPaneIdRef: { current: string | null } = { current: draggedPaneId }
  const matrixDropTargetIdRef: { current: string | null } = { current: matrixDropTargetId }

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
  const setDraggedPaneId = vi.fn((update: SetStateAction<string | null>) => {
    draggedPaneId = applyStateUpdate(draggedPaneId, update)
    draggedPaneIdRef.current = draggedPaneId
  })
  const setMatrixDropTargetId = vi.fn((update: SetStateAction<string | null>) => {
    matrixDropTargetId = applyStateUpdate(matrixDropTargetId, update)
    matrixDropTargetIdRef.current = matrixDropTargetId
  })
  const scrollToPane = vi.fn()

  const actions = createPaneInteractionActions({
    layout,
    panesRef,
    draggedPaneIdRef,
    matrixDropTargetIdRef,
    setPanes,
    setFocusedPaneId,
    setSelectedPaneIds,
    setDraggedPaneId,
    setMatrixDropTargetId,
    scrollToPane
  })

  return {
    actions,
    scrollToPane,
    get panes() {
      return panes
    },
    get focusedPaneId() {
      return focusedPaneId
    },
    get selectedPaneIds() {
      return selectedPaneIds
    },
    get draggedPaneId() {
      return draggedPaneId
    },
    get matrixDropTargetId() {
      return matrixDropTargetId
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPaneInteractionActions', () => {
  it('matrix click は focus と selection を更新し、通常クリック時だけ scroll する', () => {
    const harness = createInteractionHarness('triple')

    harness.actions.handleMatrixClick({ ctrlKey: false, metaKey: false }, 'pane-b')

    expect(harness.focusedPaneId).toBe('pane-b')
    expect(harness.selectedPaneIds).toEqual([])
    expect(harness.scrollToPane).toHaveBeenCalledWith('pane-b')

    harness.actions.handleMatrixClick({ ctrlKey: true, metaKey: false }, 'pane-c')

    expect(harness.focusedPaneId).toBe('pane-c')
    expect(harness.selectedPaneIds).toEqual(['pane-c'])
    expect(harness.scrollToPane).toHaveBeenCalledTimes(1)
  })

  it('drag and drop で pane 順序を入れ替え、drag state を掃除する', () => {
    const harness = createInteractionHarness('triple')
    const startEvent = createDragEvent()

    harness.actions.handleMatrixDragStart(startEvent, 'pane-c')

    expect(startEvent.dataTransfer.effectAllowed).toBe('move')
    expect(startEvent.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'pane-c')
    expect(harness.focusedPaneId).toBe('pane-c')
    expect(harness.draggedPaneId).toBe('pane-c')
    expect(harness.matrixDropTargetId).toBe('pane-c')

    const overEvent = createDragEvent()
    overEvent.dataTransfer.getData = startEvent.dataTransfer.getData
    harness.actions.handleMatrixDragOver(overEvent, 'pane-a')

    expect(overEvent.preventDefault).toHaveBeenCalledOnce()
    expect(overEvent.dataTransfer.dropEffect).toBe('move')
    expect(harness.matrixDropTargetId).toBe('pane-a')

    const dropEvent = createDragEvent()
    dropEvent.dataTransfer.getData = startEvent.dataTransfer.getData
    harness.actions.handleMatrixDrop(dropEvent, 'pane-a')

    expect(dropEvent.preventDefault).toHaveBeenCalledOnce()
    expect(harness.panes.map((pane) => pane.id)).toEqual(reorderPanesById([
      { id: 'pane-a' },
      { id: 'pane-b' },
      { id: 'pane-c' }
    ] as PaneState[], 'pane-c', 'pane-a').map((pane) => pane.id))
    expect(harness.matrixDropTargetId).toBe(null)

    harness.actions.handleMatrixDragEnd()

    expect(harness.draggedPaneId).toBe(null)
    expect(harness.matrixDropTargetId).toBe(null)
  })
})