import type { LocalWorkspace, PaneState, SharedContextItem } from '../types'
import { type LayoutMode } from './appCore'
import {
  getManualWorkspaces,
  mergeLocalWorkspaces
} from './workspacePaths'

export const STORAGE_KEYS = {
  panes: 'multi-turtle-cli-dev/panes-v2',
  sharedContext: 'multi-turtle-cli-dev/shared-context-v2',
  layout: 'multi-turtle-cli-dev/layout-v2',
  localWorkspaces: 'multi-turtle-cli-dev/local-workspaces-v2',
  lastLocalBrowsePath: 'multi-turtle-cli-dev/last-local-browse-path-v1',
  focusedPane: 'multi-turtle-cli-dev/focused-pane-v2'
} as const

export function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function normalizeSharedContextItem(rawItem: Partial<SharedContextItem> | null | undefined): SharedContextItem | null {
  if (!rawItem?.id || !rawItem.sourcePaneId || !rawItem.sourcePaneTitle || !rawItem.provider || !rawItem.workspaceLabel) {
    return null
  }

  return {
    id: rawItem.id,
    sourcePaneId: rawItem.sourcePaneId,
    sourcePaneTitle: rawItem.sourcePaneTitle,
    provider: rawItem.provider,
    workspaceLabel: rawItem.workspaceLabel,
    scope: rawItem.scope === 'direct' ? 'direct' : 'global',
    targetPaneIds: Array.isArray(rawItem.targetPaneIds)
      ? rawItem.targetPaneIds.filter((item): item is string => typeof item === 'string')
      : [],
    targetPaneTitles: Array.isArray(rawItem.targetPaneTitles)
      ? rawItem.targetPaneTitles.filter((item): item is string => typeof item === 'string')
      : [],
    contentLabel: typeof rawItem.contentLabel === 'string' && rawItem.contentLabel.trim() ? rawItem.contentLabel : '\u6700\u65b0\u7d50\u679c',
    summary: typeof rawItem.summary === 'string' ? rawItem.summary : '',
    detail: typeof rawItem.detail === 'string' ? rawItem.detail : '',
    consumedByPaneIds: Array.isArray(rawItem.consumedByPaneIds)
      ? rawItem.consumedByPaneIds.filter((item): item is string => typeof item === 'string')
      : [],
    createdAt: typeof rawItem.createdAt === 'number' ? rawItem.createdAt : Date.now()
  }
}

export function loadPersistedState(): {
  panes: Partial<PaneState>[]
  sharedContext: SharedContextItem[]
  layout: LayoutMode
  localWorkspaces: LocalWorkspace[]
  lastLocalBrowsePath: string | null
  focusedPaneId: string | null
} {
  const layout = readJsonStorage<LayoutMode>(STORAGE_KEYS.layout, 'triple')
  const lastLocalBrowsePath = readJsonStorage<string | null>(STORAGE_KEYS.lastLocalBrowsePath, null)

  return {
    panes: readJsonStorage<Partial<PaneState>[]>(STORAGE_KEYS.panes, []),
    sharedContext: readJsonStorage<SharedContextItem[]>(STORAGE_KEYS.sharedContext, [])
      .map((item) => normalizeSharedContextItem(item))
      .filter((item): item is SharedContextItem => Boolean(item)),
    layout: layout === 'quad' || layout === 'focus' ? layout : 'triple',
    localWorkspaces: mergeLocalWorkspaces(readJsonStorage<LocalWorkspace[]>(STORAGE_KEYS.localWorkspaces, [])),
    lastLocalBrowsePath: typeof lastLocalBrowsePath === 'string' && lastLocalBrowsePath.trim() ? lastLocalBrowsePath.trim() : null,
    focusedPaneId: readJsonStorage<string | null>(STORAGE_KEYS.focusedPane, null)
  }
}

export function persistState(payload: {
  panes: PaneState[]
  sharedContext: SharedContextItem[]
  layout: LayoutMode
  localWorkspaces: LocalWorkspace[]
  focusedPaneId: string | null
}): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEYS.panes, JSON.stringify(payload.panes))
  window.localStorage.setItem(STORAGE_KEYS.sharedContext, JSON.stringify(payload.sharedContext))
  window.localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(payload.layout))
  window.localStorage.setItem(STORAGE_KEYS.localWorkspaces, JSON.stringify(getManualWorkspaces(payload.localWorkspaces)))
  window.localStorage.setItem(STORAGE_KEYS.focusedPane, JSON.stringify(payload.focusedPaneId))
}
