import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { startTransition } from 'react'
import { fetchPaneRunStatus, previewRunCommand, runPaneStream, stopPaneRun } from './api'
import {
  MAX_SHARED_CONTEXT,
  appendLogEntry,
  appendStreamEntry,
  buildPromptWithImageSummary,
  buildTargetFromPane,
  createId,
  getProviderIssueSummary
} from './appCore'
import {
  buildCommandPreviewSections,
  buildStructuredRunContextSections,
  formatStructuredRunContextForStream,
  selectPaneContextMemory,
  selectSharedContextPayload
} from './runContext'
import { applyBackgroundActionFailure, isPaneBusyForExecution, statusLabel } from './paneState'
import { buildPaneSessionScopeKey, getProviderResumeSession, updateProviderSessionState } from './providerState'
import {
  appendLiveOutputChunk,
  appendLiveOutputLine,
  clipText,
  MAX_LIVE_OUTPUT,
  sanitizeTerminalText
} from './text'
import type {
  BootstrapPayload,
  LocalWorkspace,
  PaneLogEntry,
  PaneState,
  PreviewRunCommandResponse,
  PromptImageAttachment,
  RunImageAttachment,
  RunStatusResponse,
  RunStreamEvent,
  SharedContextItem,
  SharedContextPayload
} from '../types'

type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void
type PaneMutator = (paneId: string, updater: (pane: PaneState) => PaneState) => void
type PendingShareSelection = { mode: 'none' | 'global' | 'direct'; targetPaneIds?: string[] }

type PreparedRunPayloadFailure = { ok: false; error: string }
type PreparedRunPayloadSuccess = {
  ok: true
  pane: PaneState
  target: NonNullable<ReturnType<typeof buildTargetFromPane>>
  promptText: string
  requestText: string
  readyImageAttachments: RunImageAttachment[]
  currentSessionScopeKey: string
  resumeSessionId: string | null
  providerContextMemory: PaneLogEntry[]
  consumedContextIds: string[]
  sharedContextPayload: SharedContextPayload[]
  sharedContextOmittedCount: number
}

type PreparedRunPayload = PreparedRunPayloadFailure | PreparedRunPayloadSuccess

type PendingRunStart = {
  userEntry: PaneLogEntry
  requestText: string
  requestedAt: number
  targetLabel: string
  currentSessionScopeKey: string
  resumeSessionId: string | null
  consumedContextIds: string[]
  runContextText: string
  readyImageAttachments: RunImageAttachment[]
}

interface RunActionsParams {
  bootstrap: BootstrapPayload | null
  panesRef: MutableRefObject<PaneState[]>
  sharedContextRef: MutableRefObject<SharedContextItem[]>
  localWorkspacesRef: MutableRefObject<LocalWorkspace[]>
  paneImageAttachmentsRef: MutableRefObject<Record<string, PromptImageAttachment[]>>
  controllersRef: MutableRefObject<Record<string, AbortController>>
  stopRequestedRef: MutableRefObject<Set<string>>
  streamErroredRef: MutableRefObject<Set<string>>
  streamStatusThrottleRef: MutableRefObject<Record<string, { text: string; at: number }>>
  runStatusCheckInFlightRef: MutableRefObject<boolean>
  setSharedContext: Dispatch<SetStateAction<SharedContextItem[]>>
  updatePane: PaneUpdater
  mutatePane: PaneMutator
  queuePromptImageCleanup: (paneId: string, localPaths: string[]) => void
  clearPanePromptImages: (paneId: string, options?: { cleanupFiles?: boolean }) => void
  flushQueuedPromptImageCleanup: (paneId: string) => void
  scheduleWorkspaceContentsRefresh: (paneId: string, delay?: number) => void
  setPendingShareSelection: (paneId: string, responseOverride: string | undefined, selection: PendingShareSelection) => boolean
  requestWorkspaceSelection?: (paneId: string) => void
}

export function createRunActions(params: RunActionsParams) {
  const pendingRunStarts = new Map<string, PendingRunStart>()

  const clearPendingRunStart = (paneId: string) => {
    pendingRunStarts.delete(paneId)
  }

  const consumeSharedContext = (paneId: string, consumedContextIds: string[]) => {
    if (consumedContextIds.length === 0) {
      return
    }

    params.setSharedContext((current) =>
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

          if (item.scope === 'direct' || nextTargetPaneIds.length === 0) {
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

  const acknowledgePendingRunStart = (paneId: string) => {
    const pendingStart = pendingRunStarts.get(paneId)
    if (!pendingStart) {
      return
    }

    consumeSharedContext(paneId, pendingStart.consumedContextIds)

    params.mutatePane(paneId, (currentPane) => {
      const nextLogs = appendLogEntry(currentPane.logs, pendingStart.userEntry)
      const startStreamEntries = appendStreamEntry(
        currentPane.streamEntries,
        'system',
        `開始: ${currentPane.provider} / ${pendingStart.targetLabel}`,
        pendingStart.requestedAt,
        currentPane.provider,
        currentPane.model
      )
      const nextStreamEntries = pendingStart.runContextText
        ? appendStreamEntry(startStreamEntries, 'system', pendingStart.runContextText, pendingStart.requestedAt + 1, currentPane.provider, currentPane.model)
        : startStreamEntries

      return updateProviderSessionState({
        ...currentPane,
        prompt: '',
        logs: nextLogs,
        status: 'running',
        statusText: '実行中',
        runInProgress: true,
        lastRunAt: pendingStart.requestedAt,
        runningSince: pendingStart.requestedAt,
        lastActivityAt: pendingStart.requestedAt,
        lastError: null,
        lastResponse: null,
        selectedSessionKey: null,
        liveOutput: '',
        sessionId: pendingStart.resumeSessionId,
        sessionScopeKey: pendingStart.currentSessionScopeKey,
        currentRequestText: pendingStart.requestText,
        currentRequestAt: pendingStart.requestedAt,
        stopRequested: false,
        stopRequestAvailable: true,
        attachedContextIds: currentPane.attachedContextIds.filter((item) => !pendingStart.consumedContextIds.includes(item)),
        streamEntries: nextStreamEntries
      }, currentPane.provider, {
        sessionId: pendingStart.resumeSessionId,
        sessionScopeKey: pendingStart.currentSessionScopeKey,
        lastSharedLogEntryId: pendingStart.userEntry.id,
        updatedAt: pendingStart.requestedAt
      })
    })

    if (pendingStart.readyImageAttachments.length > 0) {
      params.queuePromptImageCleanup(paneId, pendingStart.readyImageAttachments.map((attachment) => attachment.localPath))
      params.clearPanePromptImages(paneId, { cleanupFiles: false })
    }

    clearPendingRunStart(paneId)
  }

  const finalizeCompletedRun = (
    paneId: string,
    result: {
      response: string
      statusHint: 'completed' | 'attention' | 'error'
      sessionId: string | null
      warningMessage?: string | null
      warningStatusText?: string | null
    },
    options: {
      recoveryNote?: string
    } = {}
  ) => {
    const eventAt = Date.now()
    const finalText = clipText(sanitizeTerminalText(result.response).trim(), MAX_LIVE_OUTPUT)
    const warningMessage = typeof result.warningMessage === 'string' && result.warningMessage.trim() ? result.warningMessage.trim() : null
    const warningStatusText = typeof result.warningStatusText === 'string' && result.warningStatusText.trim() ? result.warningStatusText.trim() : null
    let shouldShareGlobal = false
    let autoShareTargetIds: string[] = []
    let pendingShareGlobal = false
    let pendingShareTargetIds: string[] = []
    let didFinalize = false

    params.mutatePane(paneId, (pane) => {
      if (options.recoveryNote && !pane.runInProgress && pane.lastResponse === finalText) {
        return pane
      }

      didFinalize = true
      shouldShareGlobal = pane.autoShare
      autoShareTargetIds = pane.autoShareTargetIds.filter((item) => item !== pane.id)
      pendingShareGlobal = pane.pendingShareGlobal
      pendingShareTargetIds = pane.pendingShareTargetIds.filter((item) => item !== pane.id)

      const assistantEntry: PaneLogEntry = {
        id: createId('log'),
        role: 'assistant',
        text: finalText,
        createdAt: eventAt,
        provider: pane.provider,
        model: pane.model
      }
      const nextLogs = finalText ? appendLogEntry(pane.logs, assistantEntry) : pane.logs
      let nextStreamEntries = pane.streamEntries
      if (options.recoveryNote) {
        nextStreamEntries = appendStreamEntry(nextStreamEntries, 'system', options.recoveryNote, eventAt, pane.provider, pane.model)
      }
      if (warningMessage && !nextStreamEntries.some((entry) => entry.kind === 'system' && entry.text === warningMessage)) {
        nextStreamEntries = appendStreamEntry(nextStreamEntries, 'system', warningMessage, eventAt, pane.provider, pane.model)
      }
      nextStreamEntries = appendStreamEntry(nextStreamEntries, 'system', `結果: ${statusLabel(result.statusHint)}`, eventAt, pane.provider, pane.model)
      const shouldPreserveSpecificAttention = result.statusHint === 'attention'
        && warningMessage === '標準エラー出力がありました。Run Log を確認してください。'
        && Boolean(pane.lastError)

      const finalPreview = finalText.slice(0, 120)
      const liveOutputHasFinal = Boolean(finalPreview) && pane.liveOutput.includes(finalPreview)
      const nextLiveOutput = finalText
        ? liveOutputHasFinal
          ? clipText(pane.liveOutput, MAX_LIVE_OUTPUT)
          : appendLiveOutputLine(pane.liveOutput, finalText)
        : pane.liveOutput
      const nextSessionId = result.sessionId ?? pane.sessionId
      const nextSessionScopeKey = buildPaneSessionScopeKey(pane)

      return updateProviderSessionState({
        ...pane,
        logs: nextLogs,
        status: result.statusHint,
        statusText: result.statusHint === 'attention'
          ? shouldPreserveSpecificAttention
            ? pane.statusText
            : warningStatusText ?? (pane.lastError ? pane.statusText : statusLabel('attention'))
          : statusLabel(result.statusHint),
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastActivityAt: eventAt,
        lastFinishedAt: eventAt,
        lastError: result.statusHint === 'error'
          ? '処理がエラーで終了しました'
          : shouldPreserveSpecificAttention
            ? pane.lastError
            : warningMessage ?? (result.statusHint === 'attention' ? pane.lastError : null),
        lastResponse: finalText,
        liveOutput: nextLiveOutput,
        sessionId: nextSessionId,
        sessionScopeKey: nextSessionScopeKey,
        streamEntries: nextStreamEntries
      }, pane.provider, {
        sessionId: nextSessionId,
        sessionScopeKey: nextSessionScopeKey,
        lastSharedLogEntryId: finalText ? assistantEntry.id : pane.providerSessions[pane.provider].lastSharedLogEntryId,
        lastSharedStreamEntryId: nextStreamEntries.at(-1)?.id ?? pane.providerSessions[pane.provider].lastSharedStreamEntryId,
        updatedAt: eventAt
      })
    })

    clearPendingRunStart(paneId)

    if (!didFinalize) {
      return
    }

    if (pendingShareGlobal) {
      params.setPendingShareSelection(paneId, finalText, { mode: 'global' })
    } else if (pendingShareTargetIds.length > 0) {
      params.setPendingShareSelection(paneId, finalText, { mode: 'direct', targetPaneIds: pendingShareTargetIds })
    } else if (shouldShareGlobal) {
      params.setPendingShareSelection(paneId, finalText, { mode: 'global' })
    } else if (autoShareTargetIds.length > 0) {
      params.setPendingShareSelection(paneId, finalText, { mode: 'direct', targetPaneIds: autoShareTargetIds })
    }

    params.scheduleWorkspaceContentsRefresh(paneId)
  }

  const handleStreamEvent = (paneId: string, event: RunStreamEvent) => {
    const eventAt = Date.now()
    const shouldKeepRunning = Boolean(params.controllersRef.current[paneId]) && !params.stopRequestedRef.current.has(paneId)

    if (event.type === 'started') {
      acknowledgePendingRunStart(paneId)
      return
    }

    if (event.type === 'assistant-delta') {
      startTransition(() => {
        params.mutatePane(paneId, (pane) => ({
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          liveOutput: appendLiveOutputChunk(pane.liveOutput, event.text),
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          lastActivityAt: eventAt,
          statusText: '応答を生成中'
        }))
      })
      return
    }

    if (event.type === 'session') {
      params.mutatePane(paneId, (pane) => {
        const sessionScopeKey = buildPaneSessionScopeKey(pane)
        return updateProviderSessionState({
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          sessionId: event.sessionId,
          sessionScopeKey,
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          lastActivityAt: eventAt,
          statusText: shouldKeepRunning ? '実行中' : pane.statusText,
          streamEntries: appendStreamEntry(pane.streamEntries, 'system', `セッション開始: ${event.sessionId}`, eventAt, pane.provider, pane.model)
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
        const throttleState = params.streamStatusThrottleRef.current[paneId]
        if (throttleState?.text === normalizedText && eventAt - throttleState.at < 5_000) {
          return
        }
        params.streamStatusThrottleRef.current[paneId] = { text: normalizedText, at: eventAt }
      }

      params.mutatePane(paneId, (pane) => {
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
      finalizeCompletedRun(paneId, {
        response: event.response,
        statusHint: event.statusHint,
        sessionId: event.sessionId,
        warningMessage: event.warningMessage,
        warningStatusText: event.warningStatusText
      })
      return
    }

    if (event.type === 'error') {
      const message = sanitizeTerminalText(event.message).trim()
      params.streamErroredRef.current.add(paneId)
      clearPendingRunStart(paneId)
      params.mutatePane(paneId, (pane) => {
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
      params.scheduleWorkspaceContentsRefresh(paneId)
    }
  }

  const applyRecoveredRunStatus = (paneId: string, status: RunStatusResponse) => {
    const eventAt = Date.now()
    if (status.status === 'running') {
      params.mutatePane(paneId, (pane) => ({
        ...pane,
        status: 'running',
        statusText: '実行中',
        runInProgress: true,
        runningSince: pane.runningSince ?? pane.lastRunAt ?? eventAt,
        lastActivityAt: eventAt
      }))
      return
    }

    if (status.status === 'completed' && status.result) {
      finalizeCompletedRun(paneId, status.result, {
        recoveryNote: `バックグラウンド実行の結果を復元: ${statusLabel(status.result.statusHint)}`
      })
      return
    }

    if (status.status === 'error') {
      const message = status.error ?? 'バックグラウンド実行の状態確認で失敗しました。'
      clearPendingRunStart(paneId)
      params.mutatePane(paneId, (pane) => ({
        ...pane,
        status: 'attention',
        statusText: '実行状態を確認してください',
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
      clearPendingRunStart(paneId)
      params.mutatePane(paneId, (pane) => {
        if (!pane.runInProgress) {
          return pane
        }

        return {
          ...pane,
          status: 'attention',
          statusText: '実行状態を確認できません',
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: 'サーバー側で実行中または完了済みの状態が見つかりませんでした。',
          streamEntries: appendStreamEntry(pane.streamEntries, 'system', 'サーバー側の実行状態は idle でした', eventAt, pane.provider, pane.model)
        }
      })
    }
  }

  const checkBackgroundRunStatuses = async () => {
    if (params.runStatusCheckInFlightRef.current) {
      return
    }

    const runningPaneIds = params.panesRef.current.filter((pane) => pane.runInProgress).map((pane) => pane.id)
    if (runningPaneIds.length === 0) {
      return
    }

    params.runStatusCheckInFlightRef.current = true
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
      params.runStatusCheckInFlightRef.current = false
    }
  }

  const handleRunStreamFailure = (paneId: string, error: unknown, controllerSignal: AbortSignal) => {
    const message = sanitizeTerminalText(error instanceof Error ? error.message : String(error)).trim()
    const stopped = controllerSignal.aborted || params.stopRequestedRef.current.has(paneId)
    const streamErrored = params.streamErroredRef.current.delete(paneId)
    const startPending = pendingRunStarts.has(paneId)

    if (!stopped && !streamErrored) {
      const failedAt = Date.now()
      clearPendingRunStart(paneId)
      params.mutatePane(paneId, (currentPane) => {
        const issueSummary = getProviderIssueSummary(currentPane.provider, message, currentPane.autonomyMode)
        const fallbackAttentionMessage = startPending
          ? '実行開始前に失敗しました。入力と添付内容はそのまま残してあるため、内容を確認して再実行できます。'
          : 'ストリーム接続が途中で切れました。サーバー側で実行が残っている可能性があるため、必要なら停止再送を試してください。'
        const displayMessage = issueSummary?.displayMessage ?? fallbackAttentionMessage
        const systemEntry: PaneLogEntry = {
          id: createId('log'),
          role: 'system',
          text: displayMessage,
          createdAt: failedAt,
          provider: currentPane.provider,
          model: currentPane.model
        }

        const nextStreamEntries = appendStreamEntry(currentPane.streamEntries, 'stderr', message, failedAt, currentPane.provider, currentPane.model)

        return {
          ...currentPane,
          logs: appendLogEntry(currentPane.logs, systemEntry),
          status: issueSummary?.status ?? 'attention',
          statusText: issueSummary?.statusText ?? (startPending ? '実行開始に失敗しました' : 'ストリーム接続が途切れました'),
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: startPending ? false : true,
          lastActivityAt: failedAt,
          lastFinishedAt: failedAt,
          lastError: displayMessage,
          currentRequestText: startPending ? null : currentPane.currentRequestText,
          currentRequestAt: startPending ? null : currentPane.currentRequestAt,
          streamEntries:
            issueSummary && !currentPane.streamEntries.some((entry) => entry.kind === 'system' && entry.text === issueSummary.displayMessage)
              ? appendStreamEntry(nextStreamEntries, 'system', issueSummary.displayMessage, failedAt, currentPane.provider, currentPane.model)
              : nextStreamEntries
        }
      })
      params.scheduleWorkspaceContentsRefresh(paneId)
      if (!startPending) {
        void fetchPaneRunStatus(paneId)
          .then((status) => {
            if (status.status !== 'idle') {
              applyRecoveredRunStatus(paneId, status)
            }
          })
          .catch(() => undefined)
      }
    }

    if (stopped) {
      const stoppedAt = Date.now()
      clearPendingRunStart(paneId)
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        status: 'attention',
        statusText: '停止しました',
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: false,
        currentRequestText: startPending ? null : currentPane.currentRequestText,
        currentRequestAt: startPending ? null : currentPane.currentRequestAt,
        lastActivityAt: stoppedAt,
        lastFinishedAt: stoppedAt,
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', '実行を停止しました', stoppedAt, currentPane.provider, currentPane.model)
      }))
    }
  }

  const preparePaneRunPayload = (
    paneId: string,
    promptOverride?: string,
    options: { allowEmptyPrompt?: boolean; requestWorkspaceSelection?: boolean } = {}
  ): PreparedRunPayload => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return { ok: false, error: 'ペインが見つかりません。' }
    }

    const target = buildTargetFromPane(pane, params.localWorkspacesRef.current, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
    if (!target) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'ワークスペースを選択してください',
        lastError: 'ワークスペースが未設定です。'
      })
      if (options.requestWorkspaceSelection && pane.workspaceMode === 'local') {
        params.requestWorkspaceSelection?.(paneId)
      }
      return { ok: false, error: 'ワークスペースが未設定です。' }
    }

    const promptImages = params.paneImageAttachmentsRef.current[paneId] ?? []
    const promptText = (promptOverride ?? pane.prompt).trim() || (promptImages.length > 0 ? '添付画像を確認してください。' : '')
    if (!promptText && !options.allowEmptyPrompt) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '指示または画像を追加してください',
        lastError: 'プロンプトが空です。画像のみで実行する場合は画像を添付してください。'
      })
      return { ok: false, error: 'プロンプトが空です。' }
    }

    if (pane.provider === 'copilot' && promptImages.length > 0) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'Copilot では画像添付を使えません',
        lastError: 'GitHub Copilot CLI は画像入力未対応です。Codex CLI または Gemini CLI を選択してください。'
      })
      return { ok: false, error: 'GitHub Copilot CLI は画像入力未対応です。' }
    }

    if (promptImages.some((attachment) => attachment.status === 'uploading')) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '画像の準備中です',
        lastError: '画像のアップロードが完了してから実行してください。'
      })
      return { ok: false, error: '画像のアップロードが完了してから実行してください。' }
    }

    const failedImage = promptImages.find((attachment) => attachment.status === 'error')
    if (failedImage) {
      const errorMessage = failedImage.error || `画像を準備できませんでした: ${failedImage.fileName}`
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '画像添付を確認してください',
        lastError: errorMessage
      })
      return { ok: false, error: errorMessage }
    }

    const readyImageAttachments: RunImageAttachment[] = promptImages.flatMap((attachment) =>
      attachment.status === 'ready' && attachment.localPath
        ? [{
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            localPath: attachment.localPath
          }]
        : []
    )

    if (promptImages.length > 0 && readyImageAttachments.length !== promptImages.length) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '画像の準備中です',
        lastError: '画像の準備が完了していないため、もう一度確認してください。'
      })
      return { ok: false, error: '画像の準備が完了していないため、もう一度確認してください。' }
    }

    const requestText = buildPromptWithImageSummary(promptText, readyImageAttachments)
    const currentSessionScopeKey = buildPaneSessionScopeKey(pane)
    const providerContextMemory = selectPaneContextMemory(pane, pane.provider)
    const resumeSessionId = getProviderResumeSession(pane, pane.provider, currentSessionScopeKey)
    const sharedContextById = new Map(params.sharedContextRef.current.map((item) => [item.id, item]))
    const attachedContext = pane.attachedContextIds
      .map((contextId) => sharedContextById.get(contextId) ?? null)
      .filter((item): item is SharedContextItem => item !== null)
    const {
      sharedContextPayload,
      consumedContextIds,
      omittedCount: sharedContextOmittedCount
    } = selectSharedContextPayload(attachedContext)

    return {
      ok: true,
      pane,
      target,
      promptText,
      requestText,
      readyImageAttachments,
      currentSessionScopeKey,
      resumeSessionId,
      providerContextMemory,
      consumedContextIds,
      sharedContextPayload,
      sharedContextOmittedCount
    }
  }

  const handlePreviewRunCommand = async (paneId: string, promptOverride?: string): Promise<PreviewRunCommandResponse> => {
    if (!params.bootstrap) {
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
        catalogs: params.bootstrap.providers,
        pane: prepared.pane,
        target: prepared.target,
        promptText: prepared.promptText,
        currentSessionScopeKey: prepared.currentSessionScopeKey,
        resumeSessionId: prepared.resumeSessionId,
        providerContextMemory: prepared.providerContextMemory,
        sharedContextPayload: prepared.sharedContextPayload,
        sharedContextOmittedCount: prepared.sharedContextOmittedCount,
        readyImageAttachments: prepared.readyImageAttachments,
        preview
      })
    }
  }

  const handleRun = async (paneId: string, promptOverride?: string) => {
    const prepared = preparePaneRunPayload(paneId, promptOverride, { requestWorkspaceSelection: true })
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
      sharedContextPayload,
      sharedContextOmittedCount
    } = prepared

    if (isPaneBusyForExecution(pane) || params.controllersRef.current[paneId]) {
      return
    }

    const startedAt = Date.now()
    const userEntry: PaneLogEntry = {
      id: createId('log'),
      role: 'user',
      text: requestText,
      createdAt: startedAt,
      provider: pane.provider,
      model: pane.model
    }

    const memory = providerContextMemory
    const controller = new AbortController()
    const runContextText = params.bootstrap
      ? formatStructuredRunContextForStream(
          buildStructuredRunContextSections({
            catalogs: params.bootstrap.providers,
            pane,
            target,
            promptText: prompt,
            currentSessionScopeKey,
            resumeSessionId,
            providerContextMemory,
            sharedContextPayload,
            sharedContextOmittedCount,
            readyImageAttachments
          })
        )
      : ''

    pendingRunStarts.set(paneId, {
      userEntry,
      requestText,
      requestedAt: startedAt,
      targetLabel: target.label,
      currentSessionScopeKey,
      resumeSessionId,
      consumedContextIds,
      runContextText,
      readyImageAttachments
    })

    params.controllersRef.current[paneId] = controller
    params.stopRequestedRef.current.delete(paneId)
    params.streamErroredRef.current.delete(paneId)

    params.mutatePane(paneId, (currentPane) => {
      return {
        ...currentPane,
        status: 'updating',
        statusText: '実行を開始中',
        runInProgress: false,
        runningSince: startedAt,
        lastActivityAt: startedAt,
        lastError: null,
        currentRequestText: null,
        currentRequestAt: null,
        stopRequested: false,
        stopRequestAvailable: true,
      }
    })

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
      handleRunStreamFailure(paneId, error, controller.signal)
    } finally {
      delete params.controllersRef.current[paneId]
      params.stopRequestedRef.current.delete(paneId)
      params.flushQueuedPromptImageCleanup(paneId)
    }
  }

  const handleStop = async (paneId: string) => {
    const hasLocalController = Boolean(params.controllersRef.current[paneId])

    if (hasLocalController) {
      params.stopRequestedRef.current.add(paneId)
    }

    params.mutatePane(paneId, (pane) => ({
      ...pane,
      stopRequested: true,
      stopRequestAvailable: true,
      statusText: '停止要求を送信中'
    }))

    try {
      const result = await stopPaneRun(paneId)

      if (hasLocalController) {
        params.controllersRef.current[paneId]?.abort()
        return
      }

      const completedAt = Date.now()
      params.mutatePane(paneId, (pane) => ({
        ...pane,
        status: 'attention',
        statusText: result.stopped ? '停止しました' : '停止対象が見つかりませんでした',
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastActivityAt: completedAt,
        lastFinishedAt: result.stopped ? completedAt : pane.lastFinishedAt,
        lastError: result.stopped ? null : 'サーバー側で停止できる実行は見つかりませんでした。',
        streamEntries: appendStreamEntry(
          pane.streamEntries,
          'system',
          result.stopped
            ? 'サーバー側の実行に停止要求を送信し、停止しました'
            : 'サーバー側で停止できる実行は見つかりませんでした',
          completedAt,
          pane.provider,
          pane.model
        )
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      params.mutatePane(paneId, (pane) =>
        applyBackgroundActionFailure(
          {
            ...pane,
            stopRequested: false,
            stopRequestAvailable: pane.runInProgress || pane.stopRequestAvailable
          },
          '停止要求の送信に失敗しました',
          message,
          failedAt
        )
      )
    }
  }

  return {
    preparePaneRunPayload,
    handlePreviewRunCommand,
    handleRun,
    handleStop,
    checkBackgroundRunStatuses
  }
}