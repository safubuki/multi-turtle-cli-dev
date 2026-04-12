import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { fetchBootstrapWithRetry, MAX_SHARED_CONTEXT, PROVIDER_ORDER, type LayoutMode } from './appCore'
import { reconcileSharedContextWithPanes } from './sharedContext'
import { loadPersistedState, persistState } from './storage'
import { createInitialPane, normalizePane } from './paneState'
import { getManualWorkspaces, mergeLocalWorkspaces } from './workspacePaths'
import type { BootstrapPayload, LocalWorkspace, PaneState, SharedContextItem } from '../types'

interface UseAppLifecycleParams {
  persistedRef: MutableRefObject<ReturnType<typeof loadPersistedState>>
  bootstrap: BootstrapPayload | null
  panes: PaneState[]
  sharedContext: SharedContextItem[]
  layout: LayoutMode
  localWorkspaces: LocalWorkspace[]
  focusedPaneId: string | null
  panesRef: MutableRefObject<PaneState[]>
  localWorkspacesRef: MutableRefObject<LocalWorkspace[]>
  sharedContextRef: MutableRefObject<SharedContextItem[]>
  controllersRef: MutableRefObject<Record<string, AbortController>>
  shellControllersRef: MutableRefObject<Record<string, AbortController>>
  workspaceRefreshTimersRef: MutableRefObject<Record<string, number>>
  cleanupAllPromptImageResources: () => void
  setBootstrap: Dispatch<SetStateAction<BootstrapPayload | null>>
  setLocalWorkspaces: Dispatch<SetStateAction<LocalWorkspace[]>>
  setPanes: Dispatch<SetStateAction<PaneState[]>>
  setSharedContext: Dispatch<SetStateAction<SharedContextItem[]>>
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>
  setSelectedPaneIds: Dispatch<SetStateAction<string[]>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setGlobalError: Dispatch<SetStateAction<string | null>>
  setNow: Dispatch<SetStateAction<number>>
  checkBackgroundRunStatuses: () => Promise<void>
}

export function useAppLifecycle(params: UseAppLifecycleParams) {
  const {
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
  } = params
  const refreshBootstrapInFlightRef = useRef(false)
  const refreshBootstrapRef = useRef<(() => Promise<void>) | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const cleanupAllPromptImageResourcesRef = useRef(cleanupAllPromptImageResources)

  cleanupAllPromptImageResourcesRef.current = cleanupAllPromptImageResources

  const refreshBootstrap = useCallback(async () => {
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
  }, [localWorkspacesRef, panesRef, persistedRef, setBootstrap, setGlobalError, setLoading, setLocalWorkspaces, setPanes, setSharedContext, sharedContextRef])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [setNow])

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
      cleanupAllPromptImageResourcesRef.current()
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
  }, [focusedPaneId, panes, setFocusedPaneId])

  useEffect(() => {
    setSelectedPaneIds((current) => current.filter((paneId) => panes.some((pane) => pane.id === paneId)))
  }, [panes, setSelectedPaneIds])

  useEffect(() => {
    refreshBootstrapRef.current = refreshBootstrap
  }, [refreshBootstrap])

  useEffect(() => {
    void refreshBootstrap()
  }, [refreshBootstrap])

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
  }, [checkBackgroundRunStatuses])
}