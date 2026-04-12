import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { PaneState, PaneStatus, ProviderCatalogResponse, ProviderId } from '../types'

type MatrixVisualStatus = PaneStatus | 'stalled'

interface PaneMatrixProps {
  panes: PaneState[]
  catalogs: Record<ProviderId, ProviderCatalogResponse>
  now: number
  focusedPaneId: string | null
  selectedPaneIds: string[]
  draggedPaneId: string | null
  dropTargetId: string | null
  getVisualStatus: (pane: PaneState, now: number) => MatrixVisualStatus
  onTileRef: (paneId: string, node: HTMLButtonElement | null) => void
  onTileClick: (event: ReactMouseEvent<HTMLButtonElement>, paneId: string) => void
  onTileDragStart: (event: ReactDragEvent<HTMLButtonElement>, paneId: string) => void
  onTileDragEnter: (event: ReactDragEvent<HTMLButtonElement>, paneId: string) => void
  onTileDragOver: (event: ReactDragEvent<HTMLButtonElement>, paneId: string) => void
  onTileDrop: (event: ReactDragEvent<HTMLButtonElement>, paneId: string) => void
  onTileDragEnd: () => void
}

export function PaneMatrix({
  panes,
  catalogs,
  now,
  focusedPaneId,
  selectedPaneIds,
  draggedPaneId,
  dropTargetId,
  getVisualStatus,
  onTileRef,
  onTileClick,
  onTileDragStart,
  onTileDragEnter,
  onTileDragOver,
  onTileDrop,
  onTileDragEnd
}: PaneMatrixProps) {
  const selectedPaneIdSet = new Set(selectedPaneIds)

  return (
    <div className="pane-matrix">
      {panes.map((pane, index) => {
        const isFocused = pane.id === focusedPaneId
        const visualStatus = getVisualStatus(pane, now)
        const matrixStatus = visualStatus === 'stalled' ? 'attention' : visualStatus

        return (
          <button
            key={`matrix-${pane.id}`}
            ref={(node) => onTileRef(pane.id, node)}
            type="button"
            draggable={panes.length > 1}
            className={`matrix-tile status-${matrixStatus} ${isFocused ? 'active' : ''} ${selectedPaneIdSet.has(pane.id) ? 'selected' : ''} ${draggedPaneId === pane.id ? 'is-dragging' : ''} ${dropTargetId === pane.id && draggedPaneId !== pane.id ? 'is-drop-target' : ''}`}
            onClick={(event) => onTileClick(event, pane.id)}
            onDragStart={(event) => onTileDragStart(event, pane.id)}
            onDragEnter={(event) => onTileDragEnter(event, pane.id)}
            onDragOver={(event) => onTileDragOver(event, pane.id)}
            onDrop={(event) => onTileDrop(event, pane.id)}
            onDragEnd={onTileDragEnd}
          >
            <span className="matrix-index">{String(index + 1).padStart(2, '0')}</span>
            <strong>{pane.title}</strong>
            <span>{catalogs[pane.provider]?.label ?? pane.provider}</span>
          </button>
        )
      })}
    </div>
  )
}
