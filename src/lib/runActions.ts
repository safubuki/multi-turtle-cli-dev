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
  selectPaneContextMemory
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
  SharedContextItem
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
  sharedContextPayload: Array<{
    sourcePaneTitle: string
    provider: SharedContextItem['provider']
    workspaceLabel: string
    summary: string
    detail: string
  }>
}

type PreparedRunPayload = PreparedRunPayloadFailure | PreparedRunPayloadSuccess

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
}

export function createRunActions(params: RunActionsParams) {
  const handleStreamEvent = (paneId: string, event: RunStreamEvent) => {
    const eventAt = Date.now()
    const shouldKeepRunning = Boolean(params.controllersRef.current[paneId]) && !params.stopRequestedRef.current.has(paneId)

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
      const finalText = clipText(sanitizeTerminalText(event.response).trim(), MAX_LIVE_OUTPUT)
      const eventPane = params.panesRef.current.find((item) => item.id === paneId)
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
      params.mutatePane(paneId, (pane) => {
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
        const nextStreamEntries = appendStreamEntry(streamEntriesWithWarning, 'system', `結果: ${statusLabel(event.statusHint)}`, eventAt, pane.provider, pane.model)
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
            ? '処理がエラーで終了しました'
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
        params.setPendingShareSelection(paneId, assistantEntry.text, { mode: 'global' })
      } else if (pendingShareTargetIds.length > 0) {
        params.setPendingShareSelection(paneId, assistantEntry.text, { mode: 'direct', targetPaneIds: pendingShareTargetIds })
      } else if (shouldShareGlobal) {
        params.setPendingShareSelection(paneId, assistantEntry.text, { mode: 'global' })
      } else if (autoShareTargetIds.length > 0) {
        params.setPendingShareSelection(paneId, assistantEntry.text, { mode: 'direct', targetPaneIds: autoShareTargetIds })
      }

      params.scheduleWorkspaceContentsRefresh(paneId)
      return
    }

    if (event.type === 'error') {
      const message = sanitizeTerminalText(event.message).trim()
      params.streamErroredRef.current.add(paneId)
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
      const result = status.result
      const finalText = clipText(sanitizeTerminalText(result.response).trim(), MAX_LIVE_OUTPUT)
      params.mutatePane(paneId, (pane) => {
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
        const recoveredMessage = `バックグラウンド実行の結果を復元: ${statusLabel(result.statusHint)}`
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
            ? '処理がエラーで終了しました'
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
      params.scheduleWorkspaceContentsRefresh(paneId)
      return
    }

    if (status.status === 'error') {
      const message = status.error ?? 'バックグラウンド実行の状態確認で失敗しました。'
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

    if (!stopped && !streamErrored) {
      const failedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => {
        const issueSummary = getProviderIssueSummary(currentPane.provider, message, currentPane.autonomyMode)
        const fallbackAttentionMessage = 'ストリーム接続が途中で切れました。サーバー側で実行が残っている可能性があるため、必要なら停止再送を試してください。'
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
          statusText: issueSummary?.statusText ?? 'ストリーム接続が途切れました',
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: true,
          lastActivityAt: failedAt,
          lastFinishedAt: failedAt,
          lastError: displayMessage,
          streamEntries:
            issueSummary && !currentPane.streamEntries.some((entry) => entry.kind === 'system' && entry.text === issueSummary.displayMessage)
              ? appendStreamEntry(nextStreamEntries, 'system', issueSummary.displayMessage, failedAt, currentPane.provider, currentPane.model)
              : nextStreamEntries
        }
      })
      params.scheduleWorkspaceContentsRefresh(paneId)
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
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        status: 'attention',
        statusText: '停止しました',
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastActivityAt: stoppedAt,
        lastFinishedAt: stoppedAt,
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', '実行を停止しました', stoppedAt, currentPane.provider, currentPane.model)
      }))
    }
  }

  const preparePaneRunPayload = (paneId: string, promptOverride?: string, options: { allowEmptyPrompt?: boolean } = {}): PreparedRunPayload => {
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
    const attachedContext = params.sharedContextRef.current.filter((item) => pane.attachedContextIds.includes(item.id))
    const consumedContextIds = attachedContext.map((item) => item.id)
    const sharedContextPayload = attachedContext.map((item) => ({
      sourcePaneTitle: item.sourcePaneTitle,
      provider: item.provider,
      workspaceLabel: item.workspaceLabel,
      summary: item.summary,
      detail: item.detail
    }))

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
      sharedContextPayload
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
            readyImageAttachments
          })
        )
      : ''

    params.controllersRef.current[paneId] = controller
    params.stopRequestedRef.current.delete(paneId)
    params.streamErroredRef.current.delete(paneId)

    if (consumedContextIds.length > 0) {
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

    params.mutatePane(paneId, (currentPane) => {
      const nextLogs = appendLogEntry(currentPane.logs, userEntry)
      const startStreamEntries = appendStreamEntry(
        currentPane.streamEntries,
        'system',
        `開始: ${currentPane.provider} / ${target.label}`,
        startedAt,
        currentPane.provider,
        currentPane.model
      )
      const nextStreamEntries = runContextText
        ? appendStreamEntry(startStreamEntries, 'system', runContextText, startedAt + 1, currentPane.provider, currentPane.model)
        : startStreamEntries

      return updateProviderSessionState({
        ...currentPane,
        prompt: '',
        logs: nextLogs,
        status: 'running',
        statusText: '実行中',
        runInProgress: true,
        lastRunAt: startedAt,
        runningSince: startedAt,
        lastActivityAt: startedAt,
        lastError: null,
        lastResponse: null,
        selectedSessionKey: null,
        liveOutput: '',
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

    params.queuePromptImageCleanup(paneId, readyImageAttachments.map((attachment) => attachment.localPath))
    params.clearPanePromptImages(paneId, { cleanupFiles: false })

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