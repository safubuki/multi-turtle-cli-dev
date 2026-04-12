import type { MutableRefObject } from 'react'
import { getPaneOutputText } from './appCore'
import { writeClipboardText } from './browserUi'
import type { PaneState, PreviewRunCommandResponse } from '../types'

type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void
type PreviewRunCommandHandler = (paneId: string, promptOverride?: string) => Promise<PreviewRunCommandResponse>

interface PanePresentationActionsParams {
  panesRef: MutableRefObject<PaneState[]>
  updatePane: PaneUpdater
  previewRunCommand: PreviewRunCommandHandler
}

export function createPanePresentationActions(params: PanePresentationActionsParams) {
  const copyPaneText = async (paneId: string, text: string | null, _successMessage: string): Promise<boolean> => {
    if (!text?.trim()) {
      return false
    }

    try {
      await writeClipboardText(text)
      return true
    } catch (error) {
      params.updatePane(paneId, {
        status: 'error',
        statusText: 'コピーに失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const handleCopyOutput = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    return copyPaneText(paneId, pane ? getPaneOutputText(pane) : null, '出力をクリップボードにコピーしました')
  }

  const handleCopyProviderCommand = async (paneId: string, text: string, successMessage: string) => {
    return copyPaneText(paneId, text, successMessage)
  }

  const handleCopyText = async (paneId: string, text: string, successMessage: string) => {
    return copyPaneText(paneId, text, successMessage)
  }

  const handlePreviewRunCommand = (paneId: string, promptOverride?: string) => {
    return params.previewRunCommand(paneId, promptOverride)
  }

  return {
    handlePreviewRunCommand,
    handleCopyOutput,
    handleCopyProviderCommand,
    handleCopyText
  }
}