import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  XCircle
} from 'lucide-react'
import { TerminalPane } from './components/TerminalPane'
import { PaneMatrix } from './components/PaneMatrix'
import { SharedContextDock } from './components/SharedContextDock'
import { StageToolbar } from './components/StageToolbar'
import { SummaryMetrics } from './components/SummaryMetrics'
import { WorkspacePickerModal } from './components/WorkspacePickerModal'
import {
  syncCurrentProviderSettings,
} from './lib/providerState'
import { reconcileSharedContextWithPanes } from './lib/sharedContext'
import { createRunActions } from './lib/runActions'
import { createSessionContextActions } from './lib/sessionContextActions'
import { createShellActions } from './lib/shellActions'
import { createPaneInteractionActions } from './lib/paneInteractionActions'
import { createPromptImageActions } from './lib/promptImageActions'
import { createPaneLifecycleActions } from './lib/paneLifecycleActions'
import { createPanePresentationActions } from './lib/panePresentationActions'
import { createPaneProviderActions } from './lib/paneProviderActions'
import {
  getManualWorkspaces,
  mergeLocalWorkspaces
} from './lib/workspacePaths'
import { createWorkspaceActions } from './lib/workspaceActions'
import type {
  BootstrapPayload,
  LocalWorkspace,
  PaneState,
  PromptImageAttachment,
  SharedContextItem,
  WorkspacePickerState
} from './types'

import {
  EMPTY_CATALOGS,
  MAX_SHARED_CONTEXT,
  PROVIDER_ORDER,
  TITLE_IMAGE_URL,
  type LayoutMode,
  appendStreamEntry,
  fetchBootstrapWithRetry,
  findReusableSshPane,
  getPreferredLocalSshKey,
  mergeLocalSshKeys,
} from './lib/appCore'
import {
  acquireBodyScrollLock,
  animateReorder,
  getDocumentRect,
} from './lib/browserUi'
import {
  createInitialPane,
  getPaneVisualStatus,
  normalizePane
} from './lib/paneState'
import {
  loadPersistedState,
  persistState
} from './lib/storage'

function App() {
  const persistedRef = useRef(loadPersistedState())
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalWorkspace[]>(mergeLocalWorkspaces(persistedRef.current.localWorkspaces))
  const [panes, setPanes] = useState<PaneState[]>([])
  const [sharedContext, setSharedContext] = useState<SharedContextItem[]>(persistedRef.current.sharedContext)
  const [layout, setLayout] = useState<LayoutMode>(persistedRef.current.layout)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(persistedRef.current.focusedPaneId)
  const [selectedPaneIds, setSelectedPaneIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [workspacePicker, setWorkspacePicker] = useState<WorkspacePickerState | null>(null)
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null)
  const [matrixDropTargetId, setMatrixDropTargetId] = useState<string | null>(null)
  const [paneImageAttachments, setPaneImageAttachments] = useState<Record<string, PromptImageAttachment[]>>({})

  const panesRef = useRef<PaneState[]>([])
  const localWorkspacesRef = useRef<LocalWorkspace[]>([])
  const sharedContextRef = useRef<SharedContextItem[]>([])
  const controllersRef = useRef<Record<string, AbortController>>({})
  const stopRequestedRef = useRef<Set<string>>(new Set())
  const streamErroredRef = useRef<Set<string>>(new Set())
  const streamStatusThrottleRef = useRef<Record<string, { text: string; at: number }>>({})
  const shellControllersRef = useRef<Record<string, AbortController>>({})
  const shellStopRequestedRef = useRef<Set<string>>(new Set())
  const workspaceRefreshTimersRef = useRef<Record<string, number>>({})
  const draggedPaneIdRef = useRef<string | null>(null)
  const matrixDropTargetIdRef = useRef<string | null>(null)
  const matrixTileRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const paneCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const paneImageAttachmentsRef = useRef<Record<string, PromptImageAttachment[]>>({})
  const promptImageCleanupPathsRef = useRef<Record<string, string[]>>({})
  const matrixTileRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const paneCardRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const refreshBootstrapInFlightRef = useRef(false)
  const refreshBootstrapRef = useRef<(() => Promise<void>) | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const lastLocalBrowsePathRef = useRef<string | null>(persistedRef.current.lastLocalBrowsePath)
  const runStatusCheckInFlightRef = useRef(false)

  panesRef.current = panes
  localWorkspacesRef.current = localWorkspaces
  sharedContextRef.current = sharedContext
  paneImageAttachmentsRef.current = paneImageAttachments
  draggedPaneIdRef.current = draggedPaneId
  matrixDropTargetIdRef.current = matrixDropTargetId

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of Object.values(workspaceRefreshTimersRef.current)) {
        window.clearTimeout(timer)
      }
      for (const controller of Object.values(controllersRef.current)) {
        controller.abort()
      }
      for (const controller of Object.values(shellControllersRef.current)) {
        controller.abort()
      }
      cleanupAllPromptImageResources()
    }
  }, [])

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }

    const persistDelay = panes.some((pane) => pane.runInProgress) ? 1_200 : 300
    persistTimerRef.current = window.setTimeout(() => {
      persistState({
        panes,
        sharedContext,
        layout,
        localWorkspaces,
        focusedPaneId
      })
      persistTimerRef.current = null
    }, persistDelay)

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [bootstrap, focusedPaneId, layout, localWorkspaces, panes, sharedContext])

  useEffect(() => {
    if (panes.length === 0) {
      return
    }

    if (!focusedPaneId || !panes.some((pane) => pane.id === focusedPaneId)) {
      setFocusedPaneId(panes[0].id)
    }
  }, [focusedPaneId, panes])

  useEffect(() => {
    setSelectedPaneIds((current) => current.filter((paneId) => panes.some((pane) => pane.id === paneId)))
  }, [panes])

  const refreshBootstrap = async () => {
    if (refreshBootstrapInFlightRef.current) {
      return
    }

    refreshBootstrapInFlightRef.current = true
    setLoading(true)
    setGlobalError(null)

    try {
      const payload = await fetchBootstrapWithRetry()
      const nextLocalWorkspaces = mergeLocalWorkspaces(
        payload.localWorkspaces,
        getManualWorkspaces(localWorkspacesRef.current),
        getManualWorkspaces(persistedRef.current.localWorkspaces)
      )

      setBootstrap(payload)
      setLocalWorkspaces(nextLocalWorkspaces)
      const source =
        panesRef.current.length > 0
          ? panesRef.current
          : persistedRef.current.panes.length > 0
            ? persistedRef.current.panes
            : PROVIDER_ORDER.map((_, index) => createInitialPane(index, payload, nextLocalWorkspaces))
      const normalizedPanes = source.map((pane) => normalizePane(pane, payload, nextLocalWorkspaces))
      const reconciled = reconcileSharedContextWithPanes(sharedContextRef.current, normalizedPanes, MAX_SHARED_CONTEXT)
      setSharedContext(reconciled.sharedContext)
      setPanes(reconciled.panes)
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : String(error))
    } finally {
      refreshBootstrapInFlightRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshBootstrapRef.current = refreshBootstrap
  }, [refreshBootstrap])

  useEffect(() => {
    void refreshBootstrap()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const handleWindowFocus = () => {
      void refreshBootstrapRef.current?.()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshBootstrapRef.current?.()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!workspacePicker) {
      return
    }

    return acquireBodyScrollLock()
  }, [workspacePicker])

  const catalogs = bootstrap?.providers ?? EMPTY_CATALOGS
  const isBootstrapping = loading && !bootstrap
  const paneOrderKey = useMemo(() => panes.map((pane) => pane.id).join('|'), [panes])
  const selectedPane = useMemo(
    () => panes.find((pane) => pane.id === focusedPaneId) ?? panes[0] ?? null,
    [focusedPaneId, panes]
  )
  const visiblePanes = useMemo(
    () => (layout === 'focus' ? (selectedPane ? [selectedPane] : []) : panes),
    [layout, panes, selectedPane]
  )
  const visiblePaneOrderKey = useMemo(() => visiblePanes.map((pane) => pane.id).join('|'), [visiblePanes])

  const metrics = useMemo(() => {
    const result = {
      running: 0,
      completed: 0,
      attention: 0,
      error: 0,
      stalled: 0
    }

    for (const pane of panes) {
      const visualStatus = getPaneVisualStatus(pane, now)
      if (visualStatus === 'running' || visualStatus === 'updating') {
        result.running += 1
      } else if (visualStatus === 'completed') {
        result.completed += 1
      } else if (visualStatus === 'attention') {
        result.attention += 1
      } else if (visualStatus === 'error') {
        result.error += 1
      } else if (visualStatus === 'stalled') {
        result.stalled += 1
      }
    }

    return result
  }, [now, panes])

  useLayoutEffect(() => {
    const nextMatrixRects = new Map<string, DOMRect>()
    for (const pane of panes) {
      const element = matrixTileRefs.current[pane.id]
      if (!element) {
        continue
      }

      const nextRect = getDocumentRect(element)
      const previousRect = matrixTileRectsRef.current.get(pane.id)
      if (previousRect) {
        animateReorder(element, previousRect, nextRect)
      }
      nextMatrixRects.set(pane.id, nextRect)
    }
    matrixTileRectsRef.current = nextMatrixRects

    const nextPaneRects = new Map<string, DOMRect>()
    for (const pane of visiblePanes) {
      const element = paneCardRefs.current[pane.id]
      if (!element) {
        continue
      }

      const nextRect = getDocumentRect(element)
      const previousRect = paneCardRectsRef.current.get(pane.id)
      if (previousRect) {
        animateReorder(element, previousRect, nextRect)
      }
      nextPaneRects.set(pane.id, nextRect)
    }
    paneCardRectsRef.current = nextPaneRects
  }, [layout, paneOrderKey, visiblePaneOrderKey])

  const updatePane = (paneId: string, updates: Partial<PaneState>) => {
    setPanes((current) => current.map((pane) => {
      if (pane.id !== paneId) {
        return pane
      }

      const nextPane = { ...pane, ...updates }
      if (typeof updates.sshHost !== 'string') {
        return syncCurrentProviderSettings(nextPane)
      }

      const reusablePane = findReusableSshPane(paneId, nextPane.sshHost, current)
      if (!reusablePane) {
        return nextPane
      }

      const mergedLocalKeys = mergeLocalSshKeys(nextPane.sshLocalKeys, reusablePane.sshLocalKeys)
      const hasExplicitKeySelection = Boolean(nextPane.sshSelectedKeyPath.trim() || nextPane.sshIdentityFile.trim())
      const preferredKey = getPreferredLocalSshKey({ ...nextPane, sshLocalKeys: mergedLocalKeys }, mergedLocalKeys, current)

      if (mergedLocalKeys.length !== nextPane.sshLocalKeys.length) {
        nextPane.sshLocalKeys = mergedLocalKeys
      }

      if (!hasExplicitKeySelection) {
        if (preferredKey) {
          nextPane.sshSelectedKeyPath = preferredKey.privateKeyPath
          nextPane.sshIdentityFile = preferredKey.privateKeyPath
          nextPane.sshPublicKeyText = preferredKey.publicKey
          nextPane.sshKeyName = preferredKey.name
          nextPane.sshKeyComment = preferredKey.comment
        } else if (reusablePane.sshIdentityFile.trim()) {
          nextPane.sshIdentityFile = reusablePane.sshIdentityFile.trim()
        }
      }

      return syncCurrentProviderSettings(nextPane)
    }))
  }

  const mutatePane = (paneId: string, updater: (pane: PaneState) => PaneState) => {
    setPanes((current) => current.map((pane) => (pane.id === paneId ? updater(pane) : pane)))
  }

  const appendPaneSystemMessage = (paneId: string, text: string) => {
    const eventAt = Date.now()
    mutatePane(paneId, (pane) => ({
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'system', text, eventAt),
      lastActivityAt: eventAt
    }))
  }

  const {
    cleanupAllPromptImageResources,
    clearPanePromptImages,
    clearMultiplePanePromptImages,
    queuePromptImageCleanup,
    flushQueuedPromptImageCleanup,
    handleAddPromptImages,
    handleRemovePromptImage
  } = createPromptImageActions({
    panesRef,
    paneImageAttachmentsRef,
    promptImageCleanupPathsRef,
    setPaneImageAttachments,
    updatePane
  })

  const {
    handleAddLocalWorkspace,
    handleBrowseLocal,
    handleBrowseRemote,
    handleBrowseWorkspacePicker,
    handleConfirmWorkspacePicker,
    handleCreateRemoteDirectory,
    handleCreateWorkspacePickerDirectory,
    handleDeleteSshKey,
    handleGenerateSshKey,
    handleInstallSshPublicKey,
    handleLoadRemote,
    handleOpenCommandPrompt,
    handleOpenFileManager,
    handleOpenPathInVsCode,
    handleOpenRemoteWorkspacePicker,
    handleOpenWorkspace,
    handleRefreshWorkspaceContents,
    handleRemoveKnownHost,
    handleTransferSshPath,
    scheduleWorkspaceContentsRefresh
  } = createWorkspaceActions({
    bootstrap,
    panesRef,
    localWorkspacesRef,
    lastLocalBrowsePathRef,
    workspaceRefreshTimersRef,
    workspacePicker,
    setPanes,
    setLocalWorkspaces,
    setWorkspacePicker,
    updatePane,
    mutatePane,
    appendPaneSystemMessage
  })

  const {
    setPendingShareSelection,
    shareFromPane,
    handleDeleteSharedContext,
    pruneSharedContextForDeletedPanes,
    handleStartNewSession,
    handleResetSession,
    handleSelectSession,
    handleResumeSession,
    handleClearSelectedSessionHistory,
    handleClearAllSessionHistory
  } = createSessionContextActions({
    bootstrap,
    panesRef,
    sharedContextRef,
    localWorkspacesRef,
    setPanes,
    setSharedContext,
    updatePane,
    mutatePane,
    appendPaneSystemMessage
  })

  const {
    handleRunShell,
    handleStopShell
  } = createShellActions({
    bootstrap,
    panesRef,
    localWorkspacesRef,
    shellControllersRef,
    shellStopRequestedRef,
    updatePane,
    mutatePane
  })

  const {
    handlePreviewRunCommand: previewRunCommand,
    handleRun,
    handleStop,
    checkBackgroundRunStatuses,
  } = createRunActions({
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
    setPendingShareSelection
  })

  const {
    handleProviderChange,
    handleModelChange,
    handleReasoningEffortChange,
    handleAutonomyModeChange,
    handleCodexFastModeChange
  } = createPaneProviderActions({
    bootstrap,
    panesRef,
    paneImageAttachmentsRef,
    clearPanePromptImages,
    mutatePane
  })

  const {
    handlePreviewRunCommand,
    handleCopyOutput,
    handleCopyProviderCommand,
    handleCopyText
  } = createPanePresentationActions({
    panesRef,
    updatePane,
    previewRunCommand
  })

  const scrollToPane = (paneId: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`pane-${paneId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })
  }

  const {
    handleAddPane,
    closeAllPaneAccordions,
    handleDeletePane,
    handleDeleteSelectedPanes,
    handleDuplicatePane
  } = createPaneLifecycleActions({
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

  const {
    handleMatrixClick,
    handleMatrixDragStart,
    handleMatrixDragEnter,
    handleMatrixDragOver,
    handleMatrixDrop,
    handleMatrixDragEnd,
    handleSelectPane
  } = createPaneInteractionActions({
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

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkBackgroundRunStatuses()
      }
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkBackgroundRunStatuses()
      }
    }, 5_000)

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || selectedPaneIds.length === 0) {
        return
      }

      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      handleDeleteSelectedPanes()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleDeleteSelectedPanes, panes, selectedPaneIds])

  useEffect(() => {
    if (!selectedPane || selectedPane.workspaceMode !== 'local' || !selectedPane.localWorkspacePath) {
      return
    }

    if (selectedPane.localBrowserLoading || selectedPane.localBrowserPath) {
      return
    }

    void handleBrowseLocal(selectedPane.id, selectedPane.localWorkspacePath)
  }, [
    selectedPane,
    selectedPane?.id,
    selectedPane?.workspaceMode,
    selectedPane?.localWorkspacePath,
    selectedPane?.localBrowserPath,
    selectedPane?.localBrowserLoading,
    handleBrowseLocal
  ])

  return (
    <div className="app-shell">
      <div className="background-layer" />

      <header className="topbar">
        <div className="topbar-brand">
          <img src={TITLE_IMAGE_URL} alt="T.A.K.O" className="topbar-title-mark" />
          <div className="topbar-copy-block">
            <p className="eyebrow">MULTI CLI DEVELOPMENT TOOL</p>
            <h1>Turtle AI Kantan Operator (T.A.K.O)</h1>
            <p className="topbar-copy">Raw CLI, multiple lanes, one calm deck. Remote-ready over SSH.</p>
          </div>
        </div>
      </header>

      {isBootstrapping && (
        <div className="global-loading">
          <span className="loading-spinner" aria-hidden="true" />
          <span>{'CLI デッキを読み込み中です。'}</span>
        </div>
      )}

      {globalError && (
        <div className="global-error">
          <XCircle size={18} />
          <span>{globalError}</span>
        </div>
      )}

      <SummaryMetrics metrics={metrics} />

      <SharedContextDock sharedContext={sharedContext} panes={panes} onDelete={handleDeleteSharedContext} />

      <div className="main-grid single-column">
        <main className="workspace-stage full-stage">
          <StageToolbar
            layout={layout}
            metrics={metrics}
            onAddPane={handleAddPane}
            onCloseAllPaneAccordions={closeAllPaneAccordions}
            onLayoutChange={setLayout}
          />

          <PaneMatrix
            panes={panes}
            catalogs={catalogs}
            now={now}
            focusedPaneId={focusedPaneId}
            selectedPaneIds={selectedPaneIds}
            draggedPaneId={draggedPaneId}
            dropTargetId={matrixDropTargetId}
            getVisualStatus={getPaneVisualStatus}
            onTileRef={(paneId, node) => {
              if (node) {
                matrixTileRefs.current[paneId] = node
              } else {
                delete matrixTileRefs.current[paneId]
              }
            }}
            onTileClick={handleMatrixClick}
            onTileDragStart={handleMatrixDragStart}
            onTileDragEnter={handleMatrixDragEnter}
            onTileDragOver={handleMatrixDragOver}
            onTileDrop={handleMatrixDrop}
            onTileDragEnd={handleMatrixDragEnd}
          />

          <div className={`pane-grid layout-${layout}`}>
            {visiblePanes.map((pane) => (
              <div
                key={pane.id}
                className="pane-grid-item"
                ref={(node) => {
                  if (node) {
                    paneCardRefs.current[pane.id] = node
                  } else {
                    delete paneCardRefs.current[pane.id]
                  }
                }}
              >
                <TerminalPane
                  pane={pane}
                  catalogs={catalogs}
                  localWorkspaces={localWorkspaces}
                  sshHosts={bootstrap?.sshHosts ?? []}
                  sharedContext={sharedContext}
                  now={now}
                  isFocused={pane.id === focusedPaneId}
                  onFocus={(paneId) => handleSelectPane(paneId)}
                  onUpdate={updatePane}
                  onProviderChange={handleProviderChange}
                  onModelChange={handleModelChange}
                  onReasoningEffortChange={handleReasoningEffortChange}
                  onAutonomyModeChange={handleAutonomyModeChange}
                  onCodexFastModeChange={handleCodexFastModeChange}
                  promptImageAttachments={paneImageAttachments[pane.id] ?? []}
                  onAddPromptImages={(paneId, files, source) => void handleAddPromptImages(paneId, files, source)}
                  onRemovePromptImage={handleRemovePromptImage}
                  onRun={(paneId, promptOverride) => void handleRun(paneId, promptOverride)}
                  onStop={(paneId) => void handleStop(paneId)}
                  onShare={shareFromPane}
                  onShareToPane={(sourcePaneId, targetPaneId) =>
                    shareFromPane(sourcePaneId, undefined, { scope: 'direct', targetPaneId })
                  }
                  onCopyOutput={(paneId) => void handleCopyOutput(paneId)}
                  onCopyProviderCommand={handleCopyProviderCommand}
                  onCopyText={handleCopyText}
                  isFocusLayout={layout === 'focus'}
                  onPreviewRunCommand={handlePreviewRunCommand}
                  onDuplicate={handleDuplicatePane}
                  onStartNewSession={handleStartNewSession}
                  onResetSession={handleResetSession}
                  onSelectSession={handleSelectSession}
                  onResumeSession={handleResumeSession}
                  onClearSelectedSessionHistory={handleClearSelectedSessionHistory}
                  onClearAllSessionHistory={handleClearAllSessionHistory}
                  onDelete={handleDeletePane}
                  onLoadRemote={(paneId) => void handleLoadRemote(paneId)}
                  onBrowseRemote={(paneId, path) => void handleBrowseRemote(paneId, path)}
                  onRefreshWorkspaceContents={handleRefreshWorkspaceContents}
                  onCreateRemoteDirectory={(paneId) => void handleCreateRemoteDirectory(paneId)}
                  onOpenFileManager={(paneId) => void handleOpenFileManager(paneId)}
                  onOpenWorkspace={(paneId) => void handleOpenWorkspace(paneId)}
                  onOpenCommandPrompt={(paneId) => void handleOpenCommandPrompt(paneId)}
                  onRunShell={(paneId) => void handleRunShell(paneId)}
                  onStopShell={(paneId) => void handleStopShell(paneId)}
                  onOpenPath={(paneId, path, resourceType) => void handleOpenPathInVsCode(paneId, path, resourceType)}
                  onAddLocalWorkspace={(paneId) => void handleAddLocalWorkspace(paneId)}
                  onOpenRemoteWorkspacePicker={(paneId) => void handleOpenRemoteWorkspacePicker(paneId)}
                  onBrowseLocal={(paneId, path) => void handleBrowseLocal(paneId, path)}
                  onGenerateSshKey={(paneId) => void handleGenerateSshKey(paneId)}
                  onDeleteSshKey={(paneId) => void handleDeleteSshKey(paneId)}
                  onInstallSshPublicKey={(paneId) => void handleInstallSshPublicKey(paneId)}
                  onRemoveKnownHost={(paneId) => void handleRemoveKnownHost(paneId)}
                  onTransferSshPath={(paneId, direction, options) => void handleTransferSshPath(paneId, direction, options)}
                  shareTargets={panes.filter((item) => item.id !== pane.id).map((item) => ({ id: item.id, title: item.title }))}
                />
              </div>
            ))}
          </div>
        </main>
      </div>

      {workspacePicker && (
        <WorkspacePickerModal
          workspacePicker={workspacePicker}
          onBrowse={(path) => void handleBrowseWorkspacePicker(path)}
          onClose={() => setWorkspacePicker(null)}
          onCreateDirectory={() => void handleCreateWorkspacePickerDirectory()}
          onConfirm={() => void handleConfirmWorkspacePicker()}
        />
      )}
    </div>
  )
}

export default App


















