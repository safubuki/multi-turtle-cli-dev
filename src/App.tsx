import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  XCircle
} from 'lucide-react'
import { TerminalPane } from './components/TerminalPane'
import { PaneMatrix } from './components/PaneMatrix'
import { SharedContextDock } from './components/SharedContextDock'
import { StageToolbar } from './components/StageToolbar'
import { SummaryMetrics } from './components/SummaryMetrics'
import { WorkspacePickerModal } from './components/WorkspacePickerModal'
import { createRunActions } from './lib/runActions'
import { createSessionContextActions } from './lib/sessionContextActions'
import { createShellActions } from './lib/shellActions'
import { createPaneInteractionActions } from './lib/paneInteractionActions'
import { createPromptImageActions } from './lib/promptImageActions'
import { createPaneLifecycleActions } from './lib/paneLifecycleActions'
import { createPanePresentationActions } from './lib/panePresentationActions'
import { createPaneProviderActions } from './lib/paneProviderActions'
import { createPaneStateActions } from './lib/paneStateActions'
import { mergeLocalWorkspaces } from './lib/workspacePaths'
import { useAppLifecycle } from './lib/useAppLifecycle'
import { useAppUiEffects } from './lib/useAppUiEffects'
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
  TITLE_IMAGE_URL,
  type LayoutMode
} from './lib/appCore'
import {
  animateReorder,
  getDocumentRect,
} from './lib/browserUi'
import { getPaneVisualStatus } from './lib/paneState'
import { loadPersistedState } from './lib/storage'

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
  const lastLocalBrowsePathRef = useRef<string | null>(persistedRef.current.lastLocalBrowsePath)
  const runStatusCheckInFlightRef = useRef(false)

  panesRef.current = panes
  localWorkspacesRef.current = localWorkspaces
  sharedContextRef.current = sharedContext
  paneImageAttachmentsRef.current = paneImageAttachments
  draggedPaneIdRef.current = draggedPaneId
  matrixDropTargetIdRef.current = matrixDropTargetId

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

  const {
    updatePane,
    mutatePane,
    appendPaneSystemMessage
  } = createPaneStateActions({
    setPanes
  })

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
    checkBackgroundRunStatuses
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
    setBootstrap,
    setLocalWorkspaces,
    setPanes,
    setSharedContext,
    setFocusedPaneId,
    setSelectedPaneIds,
    setLoading,
    setGlobalError,
    setNow,
    checkBackgroundRunStatuses
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

  useAppUiEffects({
    workspacePicker,
    selectedPane,
    selectedPaneIds,
    handleBrowseLocal,
    handleDeleteSelectedPanes
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


















