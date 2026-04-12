import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { stopPaneRun, stopShellRun } from './api'
import { createId } from './appCore'
import { createInitialPane, statusLabel } from './paneState'
import { createEmptyProviderSessions } from './providerState'
import type { BootstrapPayload, LocalWorkspace, PaneState } from '../types'

interface PaneLifecycleActionsParams {
  bootstrap: BootstrapPayload | null
  panesRef: MutableRefObject<PaneState[]>
  localWorkspacesRef: MutableRefObject<LocalWorkspace[]>
  controllersRef: MutableRefObject<Record<string, AbortController>>
  stopRequestedRef: MutableRefObject<Set<string>>
  shellControllersRef: MutableRefObject<Record<string, AbortController>>
  shellStopRequestedRef: MutableRefObject<Set<string>>
  selectedPaneIds: string[]
  setPanes: Dispatch<SetStateAction<PaneState[]>>
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>
  setSelectedPaneIds: Dispatch<SetStateAction<string[]>>
  clearMultiplePanePromptImages: (paneIds: string[], options?: { cleanupFiles?: boolean }) => void
  pruneSharedContextForDeletedPanes: (paneIds: string[]) => string[]
}

export function createPaneLifecycleActions(params: PaneLifecycleActionsParams) {
  const handleAddPane = () => {
    if (!params.bootstrap) {
      return
    }

    const created = createInitialPane(params.panesRef.current.length, params.bootstrap, params.localWorkspacesRef.current)
    params.setPanes((current) => [created, ...current])
    params.setFocusedPaneId(created.id)
    params.setSelectedPaneIds([])
  }

  const closeAllPaneAccordions = () => {
    params.setPanes((current) =>
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

    params.clearMultiplePanePromptImages(ids)

    const removedContextIds = params.pruneSharedContextForDeletedPanes(ids)

    for (const paneId of ids) {
      params.stopRequestedRef.current.add(paneId)
      params.controllersRef.current[paneId]?.abort()
      delete params.controllersRef.current[paneId]
      params.shellStopRequestedRef.current.add(paneId)
      params.shellControllersRef.current[paneId]?.abort()
      delete params.shellControllersRef.current[paneId]
      void stopPaneRun(paneId).catch(() => undefined)
      void stopShellRun(paneId).catch(() => undefined)
    }

    let nextFocusId: string | null = null
    params.setPanes((current) => {
      const removedIndex = current.findIndex((pane) => ids.includes(pane.id))
      const remaining = current
        .filter((pane) => !ids.includes(pane.id))
        .map((pane) => ({
          ...pane,
          attachedContextIds: pane.attachedContextIds.filter((item) => !removedContextIds.includes(item))
        }))

      if (remaining.length === 0 && params.bootstrap) {
        const replacement = createInitialPane(0, params.bootstrap, params.localWorkspacesRef.current)
        nextFocusId = replacement.id
        return [replacement]
      }

      nextFocusId = remaining[Math.max(0, removedIndex - 1)]?.id ?? remaining[0]?.id ?? null
      return remaining
    })

    params.setFocusedPaneId(nextFocusId)
    params.setSelectedPaneIds([])
  }

  const handleDeletePane = (paneId: string) => {
    deletePanesById([paneId])
  }

  const handleDeleteSelectedPanes = () => {
    if (params.selectedPaneIds.length === 0) {
      return
    }

    const targetIds = params.panesRef.current
      .filter((pane) => params.selectedPaneIds.includes(pane.id))
      .map((pane) => pane.id)

    if (targetIds.length === 0) {
      return
    }

    const message =
      targetIds.length === 1
        ? '選択中のペインを削除しても良いですか？'
        : `選択中の ${targetIds.length} 個のペインを削除しても良いですか？`

    if (!window.confirm(message)) {
      return
    }

    deletePanesById(targetIds)
  }

  const handleDuplicatePane = (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
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

    params.setPanes((current) => [...current, duplicated])
    params.setFocusedPaneId(duplicated.id)
  }

  return {
    handleAddPane,
    closeAllPaneAccordions,
    deletePanesById,
    handleDeletePane,
    handleDeleteSelectedPanes,
    handleDuplicatePane
  }
}