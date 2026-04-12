import { useEffect } from 'react'
import { acquireBodyScrollLock } from './browserUi'
import type { PaneState, WorkspacePickerState } from '../types'

interface UseAppUiEffectsParams {
  workspacePicker: WorkspacePickerState | null
  selectedPane: PaneState | null
  selectedPaneIds: string[]
  handleBrowseLocal: (paneId: string, path: string) => void | Promise<void>
  handleDeleteSelectedPanes: () => void
}

function isEditableElement(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

export function useAppUiEffects(params: UseAppUiEffectsParams) {
  useEffect(() => {
    if (!params.workspacePicker) {
      return
    }

    return acquireBodyScrollLock()
  }, [params.workspacePicker])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || params.selectedPaneIds.length === 0) {
        return
      }

      if (isEditableElement(document.activeElement)) {
        return
      }

      event.preventDefault()
      params.handleDeleteSelectedPanes()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [params.handleDeleteSelectedPanes, params.selectedPaneIds])

  useEffect(() => {
    const selectedPane = params.selectedPane
    if (!selectedPane || selectedPane.workspaceMode !== 'local' || !selectedPane.localWorkspacePath) {
      return
    }

    if (selectedPane.localBrowserLoading || selectedPane.localBrowserPath) {
      return
    }

    void params.handleBrowseLocal(selectedPane.id, selectedPane.localWorkspacePath)
  }, [params.handleBrowseLocal, params.selectedPane])
}