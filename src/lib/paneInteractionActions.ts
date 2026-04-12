import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { reorderPanesById, type LayoutMode } from './appCore'
import type { PaneState } from '../types'

type MatrixClickEvent = { ctrlKey: boolean; metaKey: boolean }
type DataTransferLike = {
  effectAllowed?: string
  dropEffect?: string
  getData: (format: string) => string
  setData?: (format: string, value: string) => void
}
type MatrixDragEventLike = {
  dataTransfer: DataTransferLike
  preventDefault: () => void
}

interface PaneInteractionActionsParams {
  layout: LayoutMode
  panesRef: MutableRefObject<PaneState[]>
  draggedPaneIdRef: MutableRefObject<string | null>
  matrixDropTargetIdRef: MutableRefObject<string | null>
  setPanes: Dispatch<SetStateAction<PaneState[]>>
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>
  setSelectedPaneIds: Dispatch<SetStateAction<string[]>>
  setDraggedPaneId: Dispatch<SetStateAction<string | null>>
  setMatrixDropTargetId: Dispatch<SetStateAction<string | null>>
  scrollToPane: (paneId: string) => void
}

export function createPaneInteractionActions(params: PaneInteractionActionsParams) {
  const updateDraggedPaneId = (paneId: string | null) => {
    params.draggedPaneIdRef.current = paneId
    params.setDraggedPaneId(paneId)
  }

  const updateMatrixDropTargetId = (paneId: string | null) => {
    params.matrixDropTargetIdRef.current = paneId
    params.setMatrixDropTargetId(paneId)
  }

  const handleSelectPane = (paneId: string, shouldScroll = false, toggleSelection = false) => {
    params.setFocusedPaneId(paneId)
    params.setSelectedPaneIds((current) => {
      if (!toggleSelection) {
        return current.length === 0 ? current : []
      }

      return current.includes(paneId)
        ? current.filter((item) => item !== paneId)
        : [...current, paneId]
    })

    if (shouldScroll && !toggleSelection) {
      params.scrollToPane(paneId)
    }
  }

  const handleMatrixClick = (event: MatrixClickEvent, paneId: string) => {
    handleSelectPane(paneId, params.layout !== 'focus', event.ctrlKey || event.metaKey)
  }

  const resolveDraggedPaneId = (event: MatrixDragEventLike): string | null => {
    const transferPaneId = event.dataTransfer.getData('text/plain').trim()
    return params.draggedPaneIdRef.current ?? (transferPaneId || null)
  }

  const handleMatrixDragStart = (event: MatrixDragEventLike, paneId: string) => {
    if (params.panesRef.current.length < 2) {
      return
    }

    updateDraggedPaneId(paneId)
    updateMatrixDropTargetId(paneId)
    params.setFocusedPaneId(paneId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData?.('text/plain', paneId)
  }

  const handleMatrixDragEnter = (event: MatrixDragEventLike, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId || sourcePaneId === targetPaneId) {
      return
    }

    event.preventDefault()
    updateMatrixDropTargetId(targetPaneId)
  }

  const handleMatrixDragOver = (event: MatrixDragEventLike, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId || sourcePaneId === targetPaneId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (params.matrixDropTargetIdRef.current !== targetPaneId) {
      updateMatrixDropTargetId(targetPaneId)
    }
  }

  const handleMatrixDrop = (event: MatrixDragEventLike, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId) {
      return
    }

    event.preventDefault()
    if (sourcePaneId !== targetPaneId) {
      params.setPanes((current) => reorderPanesById(current, sourcePaneId, targetPaneId))
    }
    updateMatrixDropTargetId(null)
  }

  const handleMatrixDragEnd = () => {
    updateDraggedPaneId(null)
    updateMatrixDropTargetId(null)
  }

  return {
    handleSelectPane,
    handleMatrixClick,
    handleMatrixDragStart,
    handleMatrixDragEnter,
    handleMatrixDragOver,
    handleMatrixDrop,
    handleMatrixDragEnd
  }
}