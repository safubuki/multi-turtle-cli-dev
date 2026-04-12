import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  MAX_LOGS,
  MAX_SHARED_CONTEXT,
  MAX_STREAM_ENTRIES,
  appendSessionRecord,
  buildTargetFromPane,
  createArchivedSessionRecord,
  createSharedContextItem,
  getShareablePayload,
  hasSessionContent
} from './appCore'
import { buildPaneSessionScopeKey, updateProviderSessionState } from './providerState'
import { resetActiveSessionFields, statusLabel } from './paneState'
import type { BootstrapPayload, LocalWorkspace, PaneState, SharedContextItem } from '../types'

type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void
type PaneMutator = (paneId: string, updater: (pane: PaneState) => PaneState) => void

interface SessionContextActionsParams {
  bootstrap: BootstrapPayload | null
  panesRef: MutableRefObject<PaneState[]>
  sharedContextRef: MutableRefObject<SharedContextItem[]>
  localWorkspacesRef: MutableRefObject<LocalWorkspace[]>
  setPanes: Dispatch<SetStateAction<PaneState[]>>
  setSharedContext: Dispatch<SetStateAction<SharedContextItem[]>>
  updatePane: PaneUpdater
  mutatePane: PaneMutator
  appendPaneSystemMessage: (paneId: string, text: string) => void
}

type PendingShareSelection = { mode: 'none' | 'global' | 'direct'; targetPaneIds?: string[] }

export function createSessionContextActions(params: SessionContextActionsParams) {
  const replaceSourceSharedContext = (sourcePaneId: string, nextSourceContexts: SharedContextItem[]) => {
    const previousSourceContextIds = params.sharedContextRef.current
      .filter((item) => item.sourcePaneId === sourcePaneId)
      .map((item) => item.id)

    const nextSharedContext = [...nextSourceContexts, ...params.sharedContextRef.current.filter((item) => item.sourcePaneId !== sourcePaneId)]
      .slice(0, MAX_SHARED_CONTEXT)
    const storedSourceContexts = nextSharedContext.filter((item) => item.sourcePaneId === sourcePaneId)

    params.setSharedContext(nextSharedContext)
    params.setPanes((current) =>
      current.map((pane) => {
        const baseAttached = pane.attachedContextIds.filter((item) => !previousSourceContextIds.includes(item))
        const nextAttached = storedSourceContexts
          .filter((item) => item.targetPaneIds.includes(pane.id) && !item.consumedByPaneIds.includes(pane.id))
          .map((item) => item.id)

        return {
          ...pane,
          attachedContextIds: [...baseAttached, ...nextAttached.filter((item) => !baseAttached.includes(item))]
        }
      })
    )
  }

  const setPendingShareSelection = (
    paneId: string,
    responseOverride: string | undefined,
    selection: PendingShareSelection
  ): boolean => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return false
    }

    const targetPanes = params.panesRef.current.filter((item) => item.id !== paneId)
    const allowedTargetIds = new Set(targetPanes.map((item) => item.id))
    const normalizedTargetIds = selection.mode === 'global'
      ? targetPanes.map((item) => item.id)
      : (selection.targetPaneIds ?? []).filter((item): item is string => typeof item === 'string' && allowedTargetIds.has(item))

    if (selection.mode === 'none' || normalizedTargetIds.length === 0) {
      replaceSourceSharedContext(paneId, [])
      params.updatePane(paneId, {
        pendingShareGlobal: false,
        pendingShareTargetIds: []
      })
      return true
    }

    const payload = getShareablePayload(pane)
    const response = responseOverride ?? payload.text
    if (!response) {
      replaceSourceSharedContext(paneId, [])
      params.updatePane(paneId, {
        pendingShareGlobal: selection.mode === 'global',
        pendingShareTargetIds: selection.mode === 'direct' ? normalizedTargetIds : []
      })
      return true
    }

    params.updatePane(paneId, {
      pendingShareGlobal: false,
      pendingShareTargetIds: []
    })

    const target = buildTargetFromPane(pane, params.localWorkspacesRef.current, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
    const selectedTargetPanes = targetPanes.filter((item) => normalizedTargetIds.includes(item.id))

    const nextSourceContexts = selection.mode === 'global'
      ? [
          createSharedContextItem(pane, target, response, {
            scope: 'global',
            targetPaneIds: selectedTargetPanes.map((item) => item.id),
            targetPaneTitles: selectedTargetPanes.map((item) => item.title),
            contentLabel: payload.contentLabel
          })
        ]
      : selectedTargetPanes.map((targetPane) =>
          createSharedContextItem(pane, target, response, {
            scope: 'direct',
            targetPaneIds: [targetPane.id],
            targetPaneTitles: [targetPane.title],
            contentLabel: payload.contentLabel
          })
        )

    replaceSourceSharedContext(paneId, nextSourceContexts)
    return true
  }

  const shareFromPane = (
    paneId: string,
    responseOverride?: string,
    options?: {
      scope?: SharedContextItem['scope']
      targetPaneId?: string
    }
  ) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const allTargetIds = params.panesRef.current.filter((item) => item.id !== paneId).map((item) => item.id)
    const existingContexts = params.sharedContextRef.current.filter((item) => item.sourcePaneId === paneId)
    const globalContext = existingContexts.find((item) => item.scope === 'global') ?? null
    const isGlobalShareArmed = pane.pendingShareGlobal
    const directTargetIds = existingContexts
      .filter((item) => item.scope === 'direct')
      .flatMap((item) => item.targetPaneIds)
    const effectiveDirectTargetIds = Array.from(new Set([...directTargetIds, ...pane.pendingShareTargetIds]))
    const hasShareablePayload = Boolean((responseOverride ?? getShareablePayload(pane).text)?.trim())

    if ((options?.scope ?? 'global') === 'global') {
      const enabled = setPendingShareSelection(
        paneId,
        responseOverride,
        globalContext || isGlobalShareArmed ? { mode: 'none' } : { mode: 'global' }
      )
      if (!enabled) {
        params.appendPaneSystemMessage(paneId, '共有できる最新結果がまだありません')
        return
      }

      params.appendPaneSystemMessage(
        paneId,
        globalContext || isGlobalShareArmed
          ? '全体共有を解除しました'
          : hasShareablePayload
            ? '最新結果を全体共有に追加しました'
            : '次回の応答を全体共有するように設定しました'
      )
      return
    }

    const targetPaneId = options?.targetPaneId?.trim()
    if (!targetPaneId) {
      return
    }

    const targetPane = params.panesRef.current.find((item) => item.id === targetPaneId)
    if (!targetPane) {
      return
    }

    if (globalContext || isGlobalShareArmed) {
      const remainingTargetIds = allTargetIds.filter((id) => id !== targetPaneId)
      setPendingShareSelection(
        paneId,
        responseOverride,
        remainingTargetIds.length > 0 ? { mode: 'direct', targetPaneIds: remainingTargetIds } : { mode: 'none' }
      )
      params.appendPaneSystemMessage(paneId, `${targetPane.title} を共有先から外しました`)
      return
    }

    const nextTargetIds = effectiveDirectTargetIds.includes(targetPaneId)
      ? effectiveDirectTargetIds.filter((id) => id !== targetPaneId)
      : [...effectiveDirectTargetIds, targetPaneId]

    const enabled = setPendingShareSelection(
      paneId,
      responseOverride,
      nextTargetIds.length > 0 ? { mode: 'direct', targetPaneIds: nextTargetIds } : { mode: 'none' }
    )
    if (!enabled) {
      params.appendPaneSystemMessage(paneId, '共有できる最新結果がまだありません')
      return
    }

    params.appendPaneSystemMessage(
      paneId,
      effectiveDirectTargetIds.includes(targetPaneId)
        ? `${targetPane.title} への個別共有を解除しました`
        : hasShareablePayload
          ? `${targetPane.title} へ個別共有しました`
          : `${targetPane.title} への1回共有を予約しました`
    )
  }

  const handleDeleteSharedContext = (contextId: string) => {
    params.setSharedContext((current) => current.filter((item) => item.id !== contextId))
    params.setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        attachedContextIds: pane.attachedContextIds.filter((item) => item !== contextId)
      }))
    )
  }

  const pruneSharedContextForDeletedPanes = (paneIds: string[]) => {
    const removedContextIds = params.sharedContextRef.current
      .filter((item) => paneIds.includes(item.sourcePaneId))
      .map((item) => item.id)

    params.setSharedContext((current) =>
      current
        .filter((item) => !paneIds.includes(item.sourcePaneId))
        .map((item) =>
          item.targetPaneIds.some((targetPaneId) => paneIds.includes(targetPaneId))
            ? {
                ...item,
                targetPaneIds: item.targetPaneIds.filter((id) => !paneIds.includes(id)),
                targetPaneTitles: item.targetPaneTitles.filter((_, index) => !paneIds.includes(item.targetPaneIds[index]))
              }
            : item
        )
        .filter((item) => item.scope !== 'direct' || item.targetPaneIds.length > 0)
    )

    return removedContextIds
  }

  const handleStartNewSession = (paneId: string) => {
    params.mutatePane(paneId, (pane) => {
      const nextHistory = hasSessionContent(pane)
        ? appendSessionRecord(pane.sessionHistory, createArchivedSessionRecord(pane))
        : pane.sessionHistory

      return {
        ...resetActiveSessionFields(pane),
        sessionHistory: nextHistory
      }
    })
  }

  const handleResetSession = (paneId: string) => {
    params.mutatePane(paneId, (pane) => resetActiveSessionFields(pane))
  }

  const handleSelectSession = (paneId: string, sessionKey: string | null) => {
    params.mutatePane(paneId, (pane) => ({
      ...pane,
      selectedSessionKey: sessionKey
    }))
  }

  const handleResumeSession = (paneId: string, sessionKey: string | null) => {
    if (!sessionKey) {
      return
    }

    params.mutatePane(paneId, (pane) => {
      const selectedSession = pane.sessionHistory.find((session) => session.key === sessionKey)
      if (!selectedSession?.sessionId) {
        return pane
      }

      const latestUser = [...selectedSession.logs].reverse().find((entry) => entry.role === 'user') ?? null
      const latestAssistant = [...selectedSession.logs].reverse().find((entry) => entry.role === 'assistant') ?? null

      const sessionScopeKey = buildPaneSessionScopeKey(pane)
      return updateProviderSessionState({
        ...pane,
        prompt: '',
        status: 'idle',
        statusText: statusLabel('idle'),
        runInProgress: false,
        logs: selectedSession.logs.slice(-MAX_LOGS),
        streamEntries: selectedSession.streamEntries.slice(-MAX_STREAM_ENTRIES),
        selectedSessionKey: null,
        liveOutput: '',
        sessionId: selectedSession.sessionId,
        sessionScopeKey,
        currentRequestText: latestUser?.text ?? null,
        currentRequestAt: latestUser?.createdAt ?? null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastRunAt: selectedSession.updatedAt,
        runningSince: null,
        lastActivityAt: selectedSession.updatedAt,
        lastFinishedAt: selectedSession.updatedAt,
        lastError: null,
        lastResponse: latestAssistant?.text ?? null
      }, pane.provider, {
        sessionId: selectedSession.sessionId,
        sessionScopeKey,
        lastSharedLogEntryId: selectedSession.logs.at(-1)?.id ?? null,
        lastSharedStreamEntryId: selectedSession.streamEntries.at(-1)?.id ?? null,
        updatedAt: selectedSession.updatedAt
      })
    })
  }

  const handleClearSelectedSessionHistory = (paneId: string, sessionKey: string | null) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const confirmMessage = sessionKey ? '選択中のセッション履歴をクリアしますか？' : '現在のセッション履歴をクリアしますか？'
    if (!window.confirm(confirmMessage)) {
      return
    }

    params.mutatePane(paneId, (currentPane) => {
      if (sessionKey) {
        return {
          ...currentPane,
          sessionHistory: currentPane.sessionHistory.filter((session) => session.key !== sessionKey),
          selectedSessionKey: currentPane.selectedSessionKey === sessionKey ? null : currentPane.selectedSessionKey
        }
      }

      return resetActiveSessionFields(currentPane)
    })
  }

  const handleClearAllSessionHistory = (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    if (!hasSessionContent(pane) && pane.sessionHistory.length === 0) {
      return
    }

    if (!window.confirm('このペインの会話履歴とストリーム履歴をすべてクリアしますか？')) {
      return
    }

    params.mutatePane(paneId, (currentPane) => ({
      ...resetActiveSessionFields(currentPane),
      sessionHistory: []
    }))
  }

  return {
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
  }
}