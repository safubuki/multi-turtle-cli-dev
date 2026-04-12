import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
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
  fetchPaneRunStatus,
  previewRunCommand,
  runPaneStream,
  stopPaneRun,
  stopShellRun
} from './lib/api'
import {
  appendLiveOutputChunk,
  appendLiveOutputLine,
  clipText,
  MAX_LIVE_OUTPUT,
  sanitizeTerminalText
} from './lib/text'
import {
  buildCommandPreviewSections,
  buildStructuredRunContextSections,
  formatStructuredRunContextForStream,
  selectPaneContextMemory
} from './lib/runContext'
import {
  buildPaneSessionScopeKey,
  createEmptyProviderSessions,
  createProviderSettingsFromCatalog,
  getProviderResumeSession,
  syncCurrentProviderSettings,
  updateProviderSessionState
} from './lib/providerState'
import { reconcileSharedContextWithPanes } from './lib/sharedContext'
import { createSessionContextActions } from './lib/sessionContextActions'
import { createShellActions } from './lib/shellActions'
import { createPromptImageActions } from './lib/promptImageActions'
import {
  getManualWorkspaces,
  mergeLocalWorkspaces
} from './lib/workspacePaths'
import { createWorkspaceActions } from './lib/workspaceActions'
import type {
  BootstrapPayload,
  LocalWorkspace,
  PaneLogEntry,
  PaneState,
  PreviewRunCommandResponse,
  PromptImageAttachment,
  ProviderId,
  RunImageAttachment,
  RunStatusResponse,
  RunStreamEvent,
  SharedContextItem,
  WorkspacePickerState
} from './types'

import {
  MAX_SHARED_CONTEXT,
  EMPTY_CATALOGS,
  PROVIDER_ORDER,
  TITLE_IMAGE_URL,
  type LayoutMode,
  appendLogEntry,
  appendStreamEntry,
  buildPromptWithImageSummary,
  buildTargetFromPane,
  createId,
  fetchBootstrapWithRetry,
  findReusableSshPane,
  getPaneOutputText,
  getPreferredLocalSshKey,
  getProviderIssueSummary,
  mergeLocalSshKeys,
  reorderPanesById,
} from './lib/appCore'
import {
  acquireBodyScrollLock,
  animateReorder,
  getDocumentRect,
  writeClipboardText
} from './lib/browserUi'
import {
  applyBackgroundActionFailure,
  createInitialPane,
  getPaneVisualStatus,
  isPaneBusyForExecution,
  normalizePane,
  statusLabel
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

  const scrollToPane = (paneId: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`pane-${paneId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })
  }

  const handleSelectPane = (paneId: string, shouldScroll = false, toggleSelection = false) => {
    setFocusedPaneId(paneId)
    setSelectedPaneIds((current) => {
      if (!toggleSelection) {
        return current.length === 0 ? current : []
      }

      return current.includes(paneId)
        ? current.filter((item) => item !== paneId)
        : [...current, paneId]
    })

    if (shouldScroll && !toggleSelection) {
      scrollToPane(paneId)
    }
  }

  const handleMatrixClick = (event: { ctrlKey: boolean; metaKey: boolean }, paneId: string) => {
    handleSelectPane(paneId, layout !== 'focus', event.ctrlKey || event.metaKey)
  }

  const resolveDraggedPaneId = (event: ReactDragEvent<HTMLElement>): string | null => {
    const transferPaneId = event.dataTransfer.getData('text/plain').trim()
    return draggedPaneId ?? (transferPaneId || null)
  }

  const handleMatrixDragStart = (event: ReactDragEvent<HTMLButtonElement>, paneId: string) => {
    if (panes.length < 2) {
      return
    }

    setDraggedPaneId(paneId)
    setMatrixDropTargetId(paneId)
    setFocusedPaneId(paneId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', paneId)
  }

  const handleMatrixDragEnter = (event: ReactDragEvent<HTMLButtonElement>, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId || sourcePaneId === targetPaneId) {
      return
    }

    event.preventDefault()
    setMatrixDropTargetId(targetPaneId)
  }

  const handleMatrixDragOver = (event: ReactDragEvent<HTMLButtonElement>, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId || sourcePaneId === targetPaneId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (matrixDropTargetId !== targetPaneId) {
      setMatrixDropTargetId(targetPaneId)
    }
  }

  const handleMatrixDrop = (event: ReactDragEvent<HTMLButtonElement>, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId) {
      return
    }

    event.preventDefault()
    if (sourcePaneId !== targetPaneId) {
      setPanes((current) => reorderPanesById(current, sourcePaneId, targetPaneId))
    }
    setMatrixDropTargetId(null)
  }

  const handleMatrixDragEnd = () => {
    setDraggedPaneId(null)
    setMatrixDropTargetId(null)
  }

  const handleProviderChange = (paneId: string, provider: ProviderId) => {
    if (!bootstrap) {
      return
    }

    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || pane.provider === provider) {
      return
    }

    const nextSettings = pane.providerSettings[provider] ?? createProviderSettingsFromCatalog(bootstrap.providers, provider)
    const hasPromptImages = (paneImageAttachmentsRef.current[paneId] ?? []).length > 0
    if (provider === 'copilot' && hasPromptImages) {
      clearPanePromptImages(paneId)
    }

    const changedAt = Date.now()
    mutatePane(paneId, (currentPane) => {
      const previousProvider = currentPane.provider
      const savedPane = syncCurrentProviderSettings(
        updateProviderSessionState(currentPane, previousProvider, {
          sessionId: currentPane.sessionId,
          sessionScopeKey: currentPane.sessionScopeKey,
          updatedAt: changedAt
        })
      )
      const candidatePane = {
        ...savedPane,
        provider,
        model: nextSettings.model,
        reasoningEffort: nextSettings.reasoningEffort,
        autonomyMode: nextSettings.autonomyMode,
        codexFastMode: provider === 'codex' ? nextSettings.codexFastMode : 'off'
      }
      const nextSessionScopeKey = buildPaneSessionScopeKey(candidatePane)
      const providerContextMemory = selectPaneContextMemory(savedPane, provider)
      const nextSessionId = getProviderResumeSession(savedPane, provider, nextSessionScopeKey)
      const previousProviderLabel = bootstrap.providers[previousProvider]?.label ?? previousProvider
      const nextProviderLabel = bootstrap.providers[provider]?.label ?? provider
      const switchLog = [
        `CLI切り替え: ${previousProviderLabel} -> ${nextProviderLabel}`,
        `モデル: ${nextSettings.model}`,
        nextSessionId
          ? `native session: 再利用 (${nextSessionId})`
          : providerContextMemory.length > 0
            ? `native session: 新規（同一ペイン補助コンテキスト ${providerContextMemory.length}件を付与）`
            : 'native session: 新規'
      ].join('\n')

      return syncCurrentProviderSettings({
        ...candidatePane,
        sessionId: nextSessionId,
        sessionScopeKey: nextSessionId ? nextSessionScopeKey : null,
        selectedSessionKey: null,
        streamEntries: appendStreamEntry(candidatePane.streamEntries, 'system', switchLog, changedAt, provider, nextSettings.model),
        ...(provider === 'copilot' && hasPromptImages
          ? {
              status: 'attention' as const,
              statusText: 'Copilot では画像添付を使えません',
              lastError: 'GitHub Copilot CLI は画像入力未対応のため、添付画像を解除しました。'
            }
          : {})
      })
    })
  }

  const handleModelChange = (paneId: string, model: string) => {
    if (!bootstrap) {
      return
    }

    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const normalizedModel = model.trim()
    if (!normalizedModel) {
      return
    }

    const modelInfo = bootstrap.providers[pane.provider].models.find((item) => item.id === normalizedModel)

    const reasoningEffort =
      !modelInfo ||
      modelInfo.supportedReasoningEfforts.length === 0 ||
      modelInfo.supportedReasoningEfforts.includes(pane.reasoningEffort)
        ? pane.reasoningEffort
        : modelInfo.defaultReasoningEffort ?? 'medium'

    mutatePane(paneId, (currentPane) => syncCurrentProviderSettings({
      ...currentPane,
      model: normalizedModel,
      reasoningEffort,
      sessionId: null,
      sessionScopeKey: null,
      selectedSessionKey: null
    }))
  }

  const handleStreamEvent = (paneId: string, event: RunStreamEvent) => {
    const eventAt = Date.now()
    const shouldKeepRunning = Boolean(controllersRef.current[paneId]) && !stopRequestedRef.current.has(paneId)

    if (event.type === 'assistant-delta') {
      startTransition(() => {
        mutatePane(paneId, (pane) => ({
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          liveOutput: appendLiveOutputChunk(pane.liveOutput, event.text),
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          lastActivityAt: eventAt,
          statusText: '\u5fdc\u7b54\u3092\u751f\u6210\u4e2d'
        }))
      })
      return
    }

    if (event.type === 'session') {
      mutatePane(paneId, (pane) => {
        const sessionScopeKey = buildPaneSessionScopeKey(pane)
        return updateProviderSessionState({
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          sessionId: event.sessionId,
          sessionScopeKey,
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          lastActivityAt: eventAt,
          statusText: shouldKeepRunning ? '\u5b9f\u884c\u4e2d' : pane.statusText,
          streamEntries: appendStreamEntry(pane.streamEntries, 'system', `\u30bb\u30c3\u30b7\u30e7\u30f3\u958b\u59cb: ${event.sessionId}`, eventAt, pane.provider, pane.model)
        }, pane.provider, {
          sessionId: event.sessionId,
          sessionScopeKey,
          updatedAt: eventAt
        })
      })
      return
    }

    if (event.type === 'status' || event.type === 'tool' || event.type === 'stderr') {
      const kind = event.type === 'status' ? 'status' : event.type === 'tool' ? 'tool' : 'stderr'
      const normalizedText = sanitizeTerminalText(event.text).trim()
      if (event.type === 'status' && /^(assistant\.)?reasoning_delta$/u.test(normalizedText)) {
        const throttleState = streamStatusThrottleRef.current[paneId]
        if (throttleState?.text === normalizedText && eventAt - throttleState.at < 5_000) {
          return
        }
        streamStatusThrottleRef.current[paneId] = { text: normalizedText, at: eventAt }
      }
      mutatePane(paneId, (pane) => {
        const issueSummary = event.type === 'stderr' ? getProviderIssueSummary(pane.provider, normalizedText, pane.autonomyMode) : null
        const nextStreamEntries = issueSummary && !pane.streamEntries.some((entry) => entry.kind === 'system' && entry.text === issueSummary.displayMessage)
          ? appendStreamEntry(appendStreamEntry(pane.streamEntries, kind, normalizedText, eventAt, pane.provider, pane.model), 'system', issueSummary.displayMessage, eventAt, pane.provider, pane.model)
          : appendStreamEntry(pane.streamEntries, kind, normalizedText, eventAt, pane.provider, pane.model)

        return {
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          lastActivityAt: eventAt,
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          statusText: issueSummary?.statusText ?? pane.statusText,
          lastError: issueSummary?.displayMessage ?? pane.lastError,
          streamEntries: nextStreamEntries
        }
      })
      return
    }

    if (event.type === 'final') {
      const finalText = clipText(sanitizeTerminalText(event.response).trim(), MAX_LIVE_OUTPUT)
      const eventPane = panesRef.current.find((item) => item.id === paneId)
      const assistantEntry: PaneLogEntry = {
        id: createId('log'),
        role: 'assistant',
        text: finalText,
        createdAt: eventAt,
        provider: eventPane?.provider,
        model: eventPane?.model
      }

      let shouldShareGlobal = false
      let autoShareTargetIds: string[] = []
      let pendingShareGlobal = false
      let pendingShareTargetIds: string[] = []
      mutatePane(paneId, (pane) => {
        const finalPreview = finalText.slice(0, 120)
        const liveOutputHasFinal = Boolean(finalPreview) && pane.liveOutput.includes(finalPreview)
        const nextLiveOutput = finalText
          ? liveOutputHasFinal
            ? clipText(pane.liveOutput, MAX_LIVE_OUTPUT)
            : appendLiveOutputLine(pane.liveOutput, finalText)
          : pane.liveOutput

        shouldShareGlobal = pane.autoShare
        autoShareTargetIds = pane.autoShareTargetIds.filter((item) => item !== pane.id)
        pendingShareGlobal = pane.pendingShareGlobal
        pendingShareTargetIds = pane.pendingShareTargetIds.filter((item) => item !== pane.id)
        const nextLogs = appendLogEntry(pane.logs, assistantEntry)
        const warningMessage = typeof event.warningMessage === 'string' && event.warningMessage.trim() ? event.warningMessage.trim() : null
        const warningStatusText = typeof event.warningStatusText === 'string' && event.warningStatusText.trim() ? event.warningStatusText.trim() : null
        const streamEntriesWithWarning = warningMessage && !pane.streamEntries.some((entry) => entry.kind === 'system' && entry.text === warningMessage)
          ? appendStreamEntry(pane.streamEntries, 'system', warningMessage, eventAt, pane.provider, pane.model)
          : pane.streamEntries
        const nextStreamEntries = appendStreamEntry(streamEntriesWithWarning, 'system', `\u7d50\u679c: ${statusLabel(event.statusHint)}`, eventAt, pane.provider, pane.model)
        const nextSessionId = event.sessionId ?? pane.sessionId
        const nextSessionScopeKey = buildPaneSessionScopeKey(pane)
        return updateProviderSessionState({
          ...pane,
          logs: nextLogs,
          status: event.statusHint,
          statusText: event.statusHint === 'attention'
            ? warningStatusText ?? (pane.lastError ? pane.statusText : statusLabel('attention'))
            : statusLabel(event.statusHint),
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: event.statusHint === 'error'
            ? '\u51e6\u7406\u304c\u30a8\u30e9\u30fc\u3067\u7d42\u4e86\u3057\u307e\u3057\u305f'
            : warningMessage ?? (event.statusHint === 'attention' ? pane.lastError : null),
          lastResponse: assistantEntry.text,
          liveOutput: nextLiveOutput,
          sessionId: nextSessionId,
          sessionScopeKey: nextSessionScopeKey,
          streamEntries: nextStreamEntries
        }, pane.provider, {
          sessionId: nextSessionId,
          sessionScopeKey: nextSessionScopeKey,
          lastSharedLogEntryId: assistantEntry.id,
          lastSharedStreamEntryId: nextStreamEntries.at(-1)?.id ?? pane.providerSessions[pane.provider].lastSharedStreamEntryId,
          updatedAt: eventAt
        })
      })

      if (pendingShareGlobal) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'global' })
      } else if (pendingShareTargetIds.length > 0) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'direct', targetPaneIds: pendingShareTargetIds })
      } else if (shouldShareGlobal) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'global' })
      } else if (autoShareTargetIds.length > 0) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'direct', targetPaneIds: autoShareTargetIds })
      }
      scheduleWorkspaceContentsRefresh(paneId)
      return
    }

    if (event.type === 'error') {
      const message = sanitizeTerminalText(event.message).trim()
      streamErroredRef.current.add(paneId)
      mutatePane(paneId, (pane) => {
        const issueSummary = getProviderIssueSummary(pane.provider, message, pane.autonomyMode)
        const systemEntry: PaneLogEntry = {
          id: createId('log'),
          role: 'system',
          text: issueSummary?.displayMessage ?? message,
          createdAt: eventAt,
          provider: pane.provider,
          model: pane.model
        }

        return {
          ...pane,
          logs: appendLogEntry(pane.logs, systemEntry),
          status: issueSummary?.status ?? 'error',
          statusText: issueSummary?.statusText ?? statusLabel('error'),
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: issueSummary?.displayMessage ?? message,
          streamEntries: appendStreamEntry(pane.streamEntries, 'stderr', message, eventAt, pane.provider, pane.model)
        }
      })
      scheduleWorkspaceContentsRefresh(paneId)
    }
  }

  const applyRecoveredRunStatus = (paneId: string, status: RunStatusResponse) => {
    const eventAt = Date.now()
    if (status.status === 'running') {
      mutatePane(paneId, (pane) => ({
        ...pane,
        status: 'running',
        statusText: '\u5b9f\u884c\u4e2d',
        runInProgress: true,
        runningSince: pane.runningSince ?? pane.lastRunAt ?? eventAt,
        lastActivityAt: eventAt
      }))
      return
    }

    if (status.status === 'completed' && status.result) {
      const result = status.result
      const finalText = clipText(sanitizeTerminalText(result.response).trim(), MAX_LIVE_OUTPUT)
      mutatePane(paneId, (pane) => {
        if (!pane.runInProgress && pane.lastResponse === finalText) {
          return pane
        }

        const assistantEntry: PaneLogEntry = {
          id: createId('log'),
          role: 'assistant',
          text: finalText,
          createdAt: eventAt,
          provider: pane.provider,
          model: pane.model
        }
        const nextLogs = finalText ? appendLogEntry(pane.logs, assistantEntry) : pane.logs
        const nextSessionId = result.sessionId ?? pane.sessionId
        const nextSessionScopeKey = buildPaneSessionScopeKey(pane)
        const warningMessage = typeof result.warningMessage === 'string' && result.warningMessage.trim() ? result.warningMessage.trim() : null
        const warningStatusText = typeof result.warningStatusText === 'string' && result.warningStatusText.trim() ? result.warningStatusText.trim() : null
        const recoveredMessage = `\u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u5b9f\u884c\u306e\u7d50\u679c\u3092\u5fa9\u5143: ${statusLabel(result.statusHint)}`
        const streamEntriesWithRecovery = appendStreamEntry(pane.streamEntries, 'system', recoveredMessage, eventAt, pane.provider, pane.model)
        const streamEntriesWithWarning = warningMessage && !streamEntriesWithRecovery.some((entry) => entry.kind === 'system' && entry.text === warningMessage)
          ? appendStreamEntry(streamEntriesWithRecovery, 'system', warningMessage, eventAt, pane.provider, pane.model)
          : streamEntriesWithRecovery

        return updateProviderSessionState({
          ...pane,
          logs: nextLogs,
          status: result.statusHint,
          statusText: result.statusHint === 'attention'
            ? warningStatusText ?? (pane.lastError ? pane.statusText : statusLabel('attention'))
            : statusLabel(result.statusHint),
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: result.statusHint === 'error'
            ? '\u51e6\u7406\u304c\u30a8\u30e9\u30fc\u3067\u7d42\u4e86\u3057\u307e\u3057\u305f'
            : warningMessage ?? (result.statusHint === 'attention' ? pane.lastError : null),
          lastResponse: finalText,
          liveOutput: finalText ? appendLiveOutputLine(pane.liveOutput, finalText) : pane.liveOutput,
          sessionId: nextSessionId,
          sessionScopeKey: nextSessionScopeKey,
          streamEntries: streamEntriesWithWarning
        }, pane.provider, {
          sessionId: nextSessionId,
          sessionScopeKey: nextSessionScopeKey,
          lastSharedLogEntryId: finalText ? assistantEntry.id : pane.providerSessions[pane.provider].lastSharedLogEntryId,
          lastSharedStreamEntryId: streamEntriesWithWarning.at(-1)?.id ?? pane.providerSessions[pane.provider].lastSharedStreamEntryId,
          updatedAt: eventAt
        })
      })
      scheduleWorkspaceContentsRefresh(paneId)
      return
    }

    if (status.status === 'error') {
      const message = status.error ?? '\u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u5b9f\u884c\u306e\u72b6\u614b\u78ba\u8a8d\u3067\u5931\u6557\u3057\u307e\u3057\u305f\u3002'
      mutatePane(paneId, (pane) => ({
        ...pane,
        status: 'attention',
        statusText: '\u5b9f\u884c\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044',
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: true,
        lastActivityAt: eventAt,
        lastFinishedAt: eventAt,
        lastError: message,
        streamEntries: appendStreamEntry(pane.streamEntries, 'stderr', message, eventAt, pane.provider, pane.model)
      }))
      return
    }

    if (status.status === 'idle') {
      mutatePane(paneId, (pane) => {
        if (!pane.runInProgress) {
          return pane
        }

        return {
          ...pane,
          status: 'attention',
          statusText: '\u5b9f\u884c\u72b6\u614b\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093',
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: '\u30b5\u30fc\u30d0\u30fc\u5074\u3067\u5b9f\u884c\u4e2d\u307e\u305f\u306f\u5b8c\u4e86\u6e08\u307f\u306e\u72b6\u614b\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
          streamEntries: appendStreamEntry(pane.streamEntries, 'system', '\u30b5\u30fc\u30d0\u30fc\u5074\u306e\u5b9f\u884c\u72b6\u614b\u306f idle \u3067\u3057\u305f', eventAt, pane.provider, pane.model)
        }
      })
    }
  }

  const checkBackgroundRunStatuses = async () => {
    if (runStatusCheckInFlightRef.current) {
      return
    }

    const runningPaneIds = panesRef.current.filter((pane) => pane.runInProgress).map((pane) => pane.id)
    if (runningPaneIds.length === 0) {
      return
    }

    runStatusCheckInFlightRef.current = true
    try {
      await Promise.all(runningPaneIds.map(async (paneId) => {
        try {
          const status = await fetchPaneRunStatus(paneId)
          if (status.status !== 'running') {
            applyRecoveredRunStatus(paneId, status)
          }
        } catch {
          // Keep the local running state. A transient status check failure should not stop the pane.
        }
      }))
    } finally {
      runStatusCheckInFlightRef.current = false
    }
  }

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

  const preparePaneRunPayload = (paneId: string, promptOverride?: string, options: { allowEmptyPrompt?: boolean } = {}) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return { ok: false as const, error: "\u30da\u30a4\u30f3\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002" }
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current, bootstrap?.sshHosts ?? [], panesRef.current)
    if (!target) {
      updatePane(paneId, {
        status: 'attention',
        statusText: "\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044",
        lastError: "\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u304c\u672a\u8a2d\u5b9a\u3067\u3059\u3002"
      })
      return { ok: false as const, error: "\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u304c\u672a\u8a2d\u5b9a\u3067\u3059\u3002" }
    }

    const promptImages = paneImageAttachmentsRef.current[paneId] ?? []
    const promptText = (promptOverride ?? pane.prompt).trim() || (promptImages.length > 0 ? "\u6dfb\u4ed8\u753b\u50cf\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002" : "")
    if (!promptText && !options.allowEmptyPrompt) {
      updatePane(paneId, {
        status: 'attention',
        statusText: "\u6307\u793a\u307e\u305f\u306f\u753b\u50cf\u3092\u8ffd\u52a0\u3057\u3066\u304f\u3060\u3055\u3044",
        lastError: "\u30d7\u30ed\u30f3\u30d7\u30c8\u304c\u7a7a\u3067\u3059\u3002\u753b\u50cf\u306e\u307f\u3067\u5b9f\u884c\u3059\u308b\u5834\u5408\u306f\u753b\u50cf\u3092\u6dfb\u4ed8\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
      })
      return { ok: false as const, error: "\u30d7\u30ed\u30f3\u30d7\u30c8\u304c\u7a7a\u3067\u3059\u3002" }
    }

    if (pane.provider === "copilot" && promptImages.length > 0) {
      updatePane(paneId, {
        status: 'attention',
        statusText: "Copilot \u3067\u306f\u753b\u50cf\u6dfb\u4ed8\u3092\u4f7f\u3048\u307e\u305b\u3093",
        lastError: "GitHub Copilot CLI \u306f\u753b\u50cf\u5165\u529b\u672a\u5bfe\u5fdc\u3067\u3059\u3002Codex CLI \u307e\u305f\u306f Gemini CLI \u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
      })
      return { ok: false as const, error: "GitHub Copilot CLI \u306f\u753b\u50cf\u5165\u529b\u672a\u5bfe\u5fdc\u3067\u3059\u3002" }
    }

    if (promptImages.some((attachment) => attachment.status === "uploading")) {
      updatePane(paneId, {
        status: 'attention',
        statusText: "\u753b\u50cf\u306e\u6e96\u5099\u4e2d\u3067\u3059",
        lastError: "\u753b\u50cf\u306e\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u304c\u5b8c\u4e86\u3057\u3066\u304b\u3089\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
      })
      return { ok: false as const, error: "\u753b\u50cf\u306e\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u304c\u5b8c\u4e86\u3057\u3066\u304b\u3089\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002" }
    }

    const failedImage = promptImages.find((attachment) => attachment.status === "error")
    if (failedImage) {
      const errorMessage = failedImage.error || `\u753b\u50cf\u3092\u6e96\u5099\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ${failedImage.fileName}`
      updatePane(paneId, {
        status: 'attention',
        statusText: "\u753b\u50cf\u6dfb\u4ed8\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044",
        lastError: errorMessage
      })
      return { ok: false as const, error: errorMessage }
    }

    const readyImageAttachments: RunImageAttachment[] = promptImages.flatMap((attachment) =>
      attachment.status === "ready" && attachment.localPath
        ? [{
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            localPath: attachment.localPath
          }]
        : []
    )

    if (promptImages.length > 0 && readyImageAttachments.length !== promptImages.length) {
      updatePane(paneId, {
        status: 'attention',
        statusText: "\u753b\u50cf\u306e\u6e96\u5099\u4e2d\u3067\u3059",
        lastError: "\u753b\u50cf\u306e\u6e96\u5099\u304c\u5b8c\u4e86\u3057\u3066\u3044\u306a\u3044\u305f\u3081\u3001\u3082\u3046\u4e00\u5ea6\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
      })
      return { ok: false as const, error: "\u753b\u50cf\u306e\u6e96\u5099\u304c\u5b8c\u4e86\u3057\u3066\u3044\u306a\u3044\u305f\u3081\u3001\u3082\u3046\u4e00\u5ea6\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002" }
    }

    const requestText = buildPromptWithImageSummary(promptText, readyImageAttachments)
    const currentSessionScopeKey = buildPaneSessionScopeKey(pane)
    const providerContextMemory = selectPaneContextMemory(pane, pane.provider)
    const resumeSessionId = getProviderResumeSession(pane, pane.provider, currentSessionScopeKey)
    const attachedContext = sharedContextRef.current.filter((item) => pane.attachedContextIds.includes(item.id))
    const consumedContextIds = attachedContext.map((item) => item.id)
    const sharedContextPayload = attachedContext.map((item) => ({
      sourcePaneTitle: item.sourcePaneTitle,
      provider: item.provider,
      workspaceLabel: item.workspaceLabel,
      summary: item.summary,
      detail: item.detail
    }))

    return {
      ok: true as const,
      pane,
      target,
      promptText,
      requestText,
      readyImageAttachments,
      currentSessionScopeKey,
      resumeSessionId,
      providerContextMemory,
      consumedContextIds,
      sharedContextPayload
    }
  }

  const handlePreviewRunCommand = async (paneId: string, promptOverride?: string): Promise<PreviewRunCommandResponse> => {
    if (!bootstrap) {
      throw new Error('アプリの初期化が完了していません。')
    }

    const prepared = preparePaneRunPayload(paneId, promptOverride, { allowEmptyPrompt: true })
    if (!prepared.ok) {
      throw new Error(prepared.error)
    }

    const preview = await previewRunCommand({
      paneId,
      provider: prepared.pane.provider,
      model: prepared.pane.model,
      reasoningEffort: prepared.pane.reasoningEffort,
      autonomyMode: prepared.pane.autonomyMode,
      codexFastMode: prepared.pane.codexFastMode,
      target: prepared.target,
      prompt: prepared.promptText,
      sessionId: prepared.resumeSessionId,
      memory: prepared.providerContextMemory,
      sharedContext: prepared.sharedContextPayload,
      imageAttachments: prepared.readyImageAttachments
    })

    return {
      ...preview,
      structuredInput: buildCommandPreviewSections({
        catalogs: bootstrap.providers,
        pane: prepared.pane,
        target: prepared.target,
        promptText: prepared.promptText,
        currentSessionScopeKey: prepared.currentSessionScopeKey,
        resumeSessionId: prepared.resumeSessionId,
        providerContextMemory: prepared.providerContextMemory,
        sharedContextPayload: prepared.sharedContextPayload,
        readyImageAttachments: prepared.readyImageAttachments,
        preview
      })
    }
  }

  const handleRun = async (paneId: string, promptOverride?: string) => {
    const prepared = preparePaneRunPayload(paneId, promptOverride)
    if (!prepared.ok) {
      return
    }

    const {
      pane,
      target,
      promptText: prompt,
      requestText,
      readyImageAttachments,
      currentSessionScopeKey,
      resumeSessionId,
      providerContextMemory,
      consumedContextIds,
      sharedContextPayload
    } = prepared

    if (isPaneBusyForExecution(pane) || controllersRef.current[paneId]) {
      return
    }

    const startedAt = Date.now()
    const userEntry: PaneLogEntry = {
      id: createId("log"),
      role: "user",
      text: requestText,
      createdAt: startedAt,
      provider: pane.provider,
      model: pane.model
    }

    const memory = providerContextMemory
    const controller = new AbortController()
    const runContextText = bootstrap
      ? formatStructuredRunContextForStream(
          buildStructuredRunContextSections({
            catalogs: bootstrap.providers,
            pane,
            target,
            promptText: prompt,
            currentSessionScopeKey,
            resumeSessionId,
            providerContextMemory,
            sharedContextPayload,
            readyImageAttachments
          })
        )
      : ''

    controllersRef.current[paneId] = controller
    stopRequestedRef.current.delete(paneId)
    streamErroredRef.current.delete(paneId)

    if (consumedContextIds.length > 0) {
      setSharedContext((current) =>
        current
          .flatMap((item) => {
            if (!consumedContextIds.includes(item.id)) {
              return [item]
            }

            const nextConsumedByPaneIds = item.consumedByPaneIds.includes(paneId)
              ? item.consumedByPaneIds
              : [...item.consumedByPaneIds, paneId]
            const nextTargetPaneIds = item.targetPaneIds.filter((id) => id !== paneId)
            const nextTargetPaneTitles = item.targetPaneTitles.filter((_, index) => item.targetPaneIds[index] !== paneId)

            if (item.scope === "direct" || nextTargetPaneIds.length === 0) {
              return []
            }

            return [{
              ...item,
              targetPaneIds: nextTargetPaneIds,
              targetPaneTitles: nextTargetPaneTitles,
              consumedByPaneIds: nextConsumedByPaneIds
            }]
          })
          .slice(0, MAX_SHARED_CONTEXT)
      )
    }

    mutatePane(paneId, (currentPane) => {
      const nextLogs = appendLogEntry(currentPane.logs, userEntry)
      const startStreamEntries = appendStreamEntry(
        currentPane.streamEntries,
        "system",
        `\u958b\u59cb: ${currentPane.provider} / ${target.label}`,
        startedAt,
        currentPane.provider,
        currentPane.model
      )
      const nextStreamEntries = runContextText
        ? appendStreamEntry(startStreamEntries, "system", runContextText, startedAt + 1, currentPane.provider, currentPane.model)
        : startStreamEntries

      return updateProviderSessionState({
        ...currentPane,
        prompt: "",
        logs: nextLogs,
        status: "running",
        statusText: "\u5b9f\u884c\u4e2d",
        runInProgress: true,
        lastRunAt: startedAt,
        runningSince: startedAt,
        lastActivityAt: startedAt,
        lastError: null,
        lastResponse: null,
        selectedSessionKey: null,
        liveOutput: "",
        sessionId: resumeSessionId,
        sessionScopeKey: currentSessionScopeKey,
        currentRequestText: requestText,
        currentRequestAt: startedAt,
        stopRequested: false,
        stopRequestAvailable: true,
        attachedContextIds: currentPane.attachedContextIds.filter((item) => !consumedContextIds.includes(item)),
        streamEntries: nextStreamEntries
      }, currentPane.provider, {
        sessionId: resumeSessionId,
        sessionScopeKey: currentSessionScopeKey,
        lastSharedLogEntryId: userEntry.id,
        updatedAt: startedAt
      })
    })
    queuePromptImageCleanup(paneId, readyImageAttachments.map((attachment) => attachment.localPath))
    clearPanePromptImages(paneId, { cleanupFiles: false })

    try {
      await runPaneStream(
        {
          paneId,
          provider: pane.provider,
          model: pane.model,
          reasoningEffort: pane.reasoningEffort,
          autonomyMode: pane.autonomyMode,
          codexFastMode: pane.codexFastMode,
          target,
          prompt,
          sessionId: resumeSessionId,
          memory,
          sharedContext: sharedContextPayload,
          imageAttachments: readyImageAttachments
        },
        (event) => handleStreamEvent(paneId, event),
        controller.signal
      )
    } catch (error) {
      const message = sanitizeTerminalText(error instanceof Error ? error.message : String(error)).trim()
      const stopped = controller.signal.aborted || stopRequestedRef.current.has(paneId)
      const streamErrored = streamErroredRef.current.delete(paneId)

      if (!stopped && !streamErrored) {
        const failedAt = Date.now()
        mutatePane(paneId, (currentPane) => {
          const issueSummary = getProviderIssueSummary(currentPane.provider, message, currentPane.autonomyMode)
          const fallbackAttentionMessage = "\u30b9\u30c8\u30ea\u30fc\u30e0\u63a5\u7d9a\u304c\u9014\u4e2d\u3067\u5207\u308c\u307e\u3057\u305f\u3002\u30b5\u30fc\u30d0\u30fc\u5074\u3067\u5b9f\u884c\u304c\u6b8b\u3063\u3066\u3044\u308b\u53ef\u80fd\u6027\u304c\u3042\u308b\u305f\u3081\u3001\u5fc5\u8981\u306a\u3089\u505c\u6b62\u518d\u9001\u3092\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
          const displayMessage = issueSummary?.displayMessage ?? fallbackAttentionMessage
          const systemEntry: PaneLogEntry = {
            id: createId("log"),
            role: "system",
            text: displayMessage,
            createdAt: failedAt,
            provider: currentPane.provider,
            model: currentPane.model
          }

          const nextStreamEntries = appendStreamEntry(currentPane.streamEntries, "stderr", message, failedAt, currentPane.provider, currentPane.model)

          return {
            ...currentPane,
            logs: appendLogEntry(currentPane.logs, systemEntry),
            status: issueSummary?.status ?? "attention",
            statusText: issueSummary?.statusText ?? "\u30b9\u30c8\u30ea\u30fc\u30e0\u63a5\u7d9a\u304c\u9014\u5207\u308c\u307e\u3057\u305f",
            runInProgress: false,
            runningSince: null,
            stopRequested: false,
            stopRequestAvailable: true,
            lastActivityAt: failedAt,
            lastFinishedAt: failedAt,
            lastError: displayMessage,
            streamEntries:
              issueSummary && !currentPane.streamEntries.some((entry) => entry.kind === "system" && entry.text === issueSummary.displayMessage)
                ? appendStreamEntry(nextStreamEntries, "system", issueSummary.displayMessage, failedAt, currentPane.provider, currentPane.model)
                : nextStreamEntries
          }
        })
        scheduleWorkspaceContentsRefresh(paneId)
        void fetchPaneRunStatus(paneId)
          .then((status) => {
            if (status.status !== 'idle') {
              applyRecoveredRunStatus(paneId, status)
            }
          })
          .catch(() => undefined)
      }

      if (stopped) {
        const stoppedAt = Date.now()
        mutatePane(paneId, (currentPane) => ({
          ...currentPane,
          status: "attention",
          statusText: "\u505c\u6b62\u3057\u307e\u3057\u305f",
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: stoppedAt,
          lastFinishedAt: stoppedAt,
          lastError: null,
          streamEntries: appendStreamEntry(currentPane.streamEntries, "system", "\u5b9f\u884c\u3092\u505c\u6b62\u3057\u307e\u3057\u305f", stoppedAt, currentPane.provider, currentPane.model)
        }))
      }
    } finally {
      delete controllersRef.current[paneId]
      stopRequestedRef.current.delete(paneId)
      flushQueuedPromptImageCleanup(paneId)
    }
  }

  const handleStop = async (paneId: string) => {
    const hasLocalController = Boolean(controllersRef.current[paneId])

    if (hasLocalController) {
      stopRequestedRef.current.add(paneId)
    }

    mutatePane(paneId, (pane) => ({
      ...pane,
      stopRequested: true,
      stopRequestAvailable: true,
      statusText: '\u505c\u6b62\u8981\u6c42\u3092\u9001\u4fe1\u4e2d'
    }))

    try {
      const result = await stopPaneRun(paneId)

      if (hasLocalController) {
        controllersRef.current[paneId]?.abort()
        return
      }

      const completedAt = Date.now()
      mutatePane(paneId, (pane) => ({
        ...pane,
        status: result.stopped ? 'attention' : 'attention',
        statusText: result.stopped ? '\u505c\u6b62\u3057\u307e\u3057\u305f' : '\u505c\u6b62\u5bfe\u8c61\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f',
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastActivityAt: completedAt,
        lastFinishedAt: result.stopped ? completedAt : pane.lastFinishedAt,
        lastError: result.stopped ? null : '\u30b5\u30fc\u30d0\u30fc\u5074\u3067\u505c\u6b62\u3067\u304d\u308b\u5b9f\u884c\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
        streamEntries: appendStreamEntry(
          pane.streamEntries,
          'system',
          result.stopped
            ? '\u30b5\u30fc\u30d0\u30fc\u5074\u306e\u5b9f\u884c\u306b\u505c\u6b62\u8981\u6c42\u3092\u9001\u4fe1\u3057\u3001\u505c\u6b62\u3057\u307e\u3057\u305f'
            : '\u30b5\u30fc\u30d0\u30fc\u5074\u3067\u505c\u6b62\u3067\u304d\u308b\u5b9f\u884c\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f',
          completedAt,
          pane.provider,
          pane.model
        )
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      mutatePane(paneId, (pane) =>
        applyBackgroundActionFailure(
          {
            ...pane,
            stopRequested: false,
            stopRequestAvailable: pane.runInProgress || pane.stopRequestAvailable
          },
          '\u505c\u6b62\u8981\u6c42\u306e\u9001\u4fe1\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
          message,
          failedAt
        )
      )
    }
  }

  const handleAddPane = () => {
    if (!bootstrap) {
      return
    }

    const created = createInitialPane(panesRef.current.length, bootstrap, localWorkspacesRef.current)
    setPanes((current) => [created, ...current])
    setFocusedPaneId(created.id)
    setSelectedPaneIds([])
  }

  const closeAllPaneAccordions = () => {
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        settingsOpen: false,
        workspaceOpen: false,
        shellOpen: false
      }))
    )
  }

  const deletePanesById = (paneIds: string[]) => {
    const ids = [...new Set(paneIds)]
    if (ids.length === 0) {
      return
    }

    clearMultiplePanePromptImages(ids)

    const removedContextIds = pruneSharedContextForDeletedPanes(ids)

    for (const paneId of ids) {
      stopRequestedRef.current.add(paneId)
      controllersRef.current[paneId]?.abort()
      delete controllersRef.current[paneId]
      shellStopRequestedRef.current.add(paneId)
      shellControllersRef.current[paneId]?.abort()
      delete shellControllersRef.current[paneId]
      void stopPaneRun(paneId).catch(() => undefined)
      void stopShellRun(paneId).catch(() => undefined)
    }

    let nextFocusId: string | null = null
    setPanes((current) => {
      const removedIndex = current.findIndex((pane) => ids.includes(pane.id))
      const remaining = current
        .filter((pane) => !ids.includes(pane.id))
        .map((pane) => ({
          ...pane,
          attachedContextIds: pane.attachedContextIds.filter((item) => !removedContextIds.includes(item))
        }))

      if (remaining.length === 0 && bootstrap) {
        const replacement = createInitialPane(0, bootstrap, localWorkspacesRef.current)
        nextFocusId = replacement.id
        return [replacement]
      }

      nextFocusId = remaining[Math.max(0, removedIndex - 1)]?.id ?? remaining[0]?.id ?? null
      return remaining
    })

    setFocusedPaneId(nextFocusId)
    setSelectedPaneIds([])
  }

  const handleDeletePane = (paneId: string) => {
    deletePanesById([paneId])
  }

  const handleDeleteSelectedPanes = () => {
    if (selectedPaneIds.length === 0) {
      return
    }

    const targetIds = panes
      .filter((pane) => selectedPaneIds.includes(pane.id))
      .map((pane) => pane.id)

    if (targetIds.length === 0) {
      return
    }

    const message =
      targetIds.length === 1
        ? '\u9078\u629e\u4e2d\u306e\u30da\u30a4\u30f3\u3092\u524a\u9664\u3057\u3066\u3082\u826f\u3044\u3067\u3059\u304b\uff1f'
        : `\u9078\u629e\u4e2d\u306e ${targetIds.length} \u500b\u306e\u30da\u30a4\u30f3\u3092\u524a\u9664\u3057\u3066\u3082\u826f\u3044\u3067\u3059\u304b\uff1f`

    if (!window.confirm(message)) {
      return
    }

    deletePanesById(targetIds)
  }

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
  }, [selectedPaneIds, panes])

  const handleDuplicatePane = (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const duplicated: PaneState = {
      ...pane,
      id: createId('pane'),
      title: `${pane.title} copy`,
      status: 'idle',
      statusText: statusLabel('idle'),
      runInProgress: false,
      prompt: '',
      logs: [],
      streamEntries: [],
      sessionHistory: [],
      selectedSessionKey: null,
      liveOutput: '',
      sessionId: null,
      sessionScopeKey: null,
      providerSessions: createEmptyProviderSessions(),
      currentRequestText: null,
      currentRequestAt: null,
      stopRequested: false,
      stopRequestAvailable: false,
      sshActionState: 'idle',
      sshActionMessage: null,
      sshPasswordPulseAt: 0,
      lastRunAt: null,
      runningSince: null,
      lastActivityAt: null,
      lastFinishedAt: null,
      lastError: null,
      lastResponse: null
    }

    setPanes((current) => [...current, duplicated])
    setFocusedPaneId(duplicated.id)
  }

  const copyPaneText = async (paneId: string, text: string | null, _successMessage: string): Promise<boolean> => {
    if (!text?.trim()) {
      return false
    }

    try {
      await writeClipboardText(text)
      return true
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: '\u30b3\u30d4\u30fc\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        lastError: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const handleCopyOutput = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    await copyPaneText(paneId, pane ? getPaneOutputText(pane) : null, '\u51fa\u529b\u3092\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f')
  }

  const handleCopyProviderCommand = async (paneId: string, text: string, successMessage: string) => {
    return copyPaneText(paneId, text, successMessage)
  }

  const handleCopyText = async (paneId: string, text: string, successMessage: string) => {
    return copyPaneText(paneId, text, successMessage)
  }

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
    selectedPane?.localBrowserLoading
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
          <span>{'CLI \u30c7\u30c3\u30ad\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002'}</span>
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
                  onCopyProviderCommand={(paneId, text, successMessage) => handleCopyProviderCommand(paneId, text, successMessage)}
                  onCopyText={(paneId, text, successMessage) => handleCopyText(paneId, text, successMessage)}
                  isFocusLayout={layout === 'focus'}
                  onPreviewRunCommand={(paneId, promptOverride) => handlePreviewRunCommand(paneId, promptOverride)}
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


















