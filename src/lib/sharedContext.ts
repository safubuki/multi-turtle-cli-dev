import type { PaneState, SharedContextItem } from '../types'

export function reconcileSharedContextWithPanes(
  items: SharedContextItem[],
  panes: PaneState[],
  maxItems: number
): { sharedContext: SharedContextItem[]; panes: PaneState[] } {
  const paneMap = new Map(panes.map((pane) => [pane.id, pane]))
  const sharedContext = items.flatMap((item): SharedContextItem[] => {
    const sourcePane = paneMap.get(item.sourcePaneId)
    if (!sourcePane) {
      return []
    }

    const targetPaneIds = item.targetPaneIds.filter((paneId) => paneMap.has(paneId) && paneId !== item.sourcePaneId)
    if (item.scope === 'direct' && targetPaneIds.length === 0) {
      return []
    }

    return [{
      ...item,
      sourcePaneTitle: sourcePane.title,
      targetPaneIds,
      targetPaneTitles: targetPaneIds.map((paneId) => paneMap.get(paneId)?.title ?? paneId),
      consumedByPaneIds: item.consumedByPaneIds.filter((paneId) => paneMap.has(paneId))
    }]
  }).slice(0, maxItems)

  const sharedContextIds = new Set(sharedContext.map((item) => item.id))
  const nextPanes = panes.map((pane) => {
    const attachedContextIds = pane.attachedContextIds.filter((contextId) => sharedContextIds.has(contextId))
    const autoShareTargetIds = pane.autoShareTargetIds.filter((paneId) => paneMap.has(paneId) && paneId !== pane.id)
    const pendingShareTargetIds = pane.pendingShareTargetIds.filter((paneId) => paneMap.has(paneId) && paneId !== pane.id)

    if (
      attachedContextIds.length === pane.attachedContextIds.length &&
      autoShareTargetIds.length === pane.autoShareTargetIds.length &&
      pendingShareTargetIds.length === pane.pendingShareTargetIds.length
    ) {
      return pane
    }

    return {
      ...pane,
      attachedContextIds,
      autoShareTargetIds,
      pendingShareTargetIds
    }
  })

  return { sharedContext, panes: nextPanes }
}
