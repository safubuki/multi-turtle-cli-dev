import { useEffect, useRef, useState } from 'react'
import { acquireBodyScrollLock } from '../lib/browserUi'
import type { PreviewRunCommandResponse } from '../types'

type RunLogsMode = 'logs' | 'conversation'
type RunLogsTab = 'conversation' | 'stream'

interface CommandPreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: PreviewRunCommandResponse | null
  error: string | null
}

interface UseTerminalPanePresentationStateParams {
  paneId: string
  promptDraft: string
  flushPromptSync: (nextValue?: string) => void
  onCopyText: (paneId: string, text: string, successMessage: string) => Promise<boolean>
  onPreviewRunCommand: (paneId: string, promptOverride?: string) => Promise<PreviewRunCommandResponse>
  onSelectSession: (paneId: string, sessionKey: string | null) => void
}

export function useTerminalPanePresentationState(params: UseTerminalPanePresentationStateParams) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const [isRunLogsExpanded, setIsRunLogsExpanded] = useState(false)
  const [runLogsMode, setRunLogsMode] = useState<RunLogsMode>('logs')
  const [runLogsTab, setRunLogsTab] = useState<RunLogsTab>('conversation')
  const [expandedPromptImageId, setExpandedPromptImageId] = useState<string | null>(null)
  const [copiedControlKey, setCopiedControlKey] = useState<string | null>(null)
  const [isCommandPreviewOpen, setIsCommandPreviewOpen] = useState(false)
  const [commandPreviewState, setCommandPreviewState] = useState<CommandPreviewState>({
    status: 'idle',
    data: null,
    error: null
  })
  const copyFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isOutputExpanded && !isRunLogsExpanded) {
      return
    }

    return acquireBodyScrollLock()
  }, [isOutputExpanded, isRunLogsExpanded])

  const openOutput = () => setIsOutputExpanded(true)
  const closeOutput = () => setIsOutputExpanded(false)
  const openPromptImagePreview = (attachmentId: string) => setExpandedPromptImageId(attachmentId)
  const closePromptImagePreview = () => setExpandedPromptImageId(null)
  const closeCommandPreview = () => setIsCommandPreviewOpen(false)
  const closeRunLogs = () => setIsRunLogsExpanded(false)

  const openRunLogs = () => {
    setRunLogsMode('logs')
    setRunLogsTab('conversation')
    setIsRunLogsExpanded(true)
  }

  const openCurrentSessionHistory = () => {
    params.onSelectSession(params.paneId, null)
    setRunLogsMode('conversation')
    setRunLogsTab('conversation')
    setIsRunLogsExpanded(true)
  }

  const flashCopiedControl = (controlKey: string) => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    setCopiedControlKey(controlKey)
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedControlKey((current) => (current === controlKey ? null : current))
      copyFeedbackTimerRef.current = null
    }, 950)
  }

  const handleCopyWithFeedback = async (controlKey: string, text: string, successMessage: string) => {
    const copied = await params.onCopyText(params.paneId, text, successMessage)
    if (copied) {
      flashCopiedControl(controlKey)
    }
  }

  const openCommandPreview = async () => {
    params.flushPromptSync(params.promptDraft)
    setIsCommandPreviewOpen(true)
    setCommandPreviewState({ status: 'loading', data: null, error: null })

    try {
      const preview = await params.onPreviewRunCommand(params.paneId, params.promptDraft)
      setCommandPreviewState({ status: 'ready', data: preview, error: null })
    } catch (error) {
      setCommandPreviewState({
        status: 'error',
        data: null,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    isOutputExpanded,
    openOutput,
    closeOutput,
    isRunLogsExpanded,
    runLogsMode,
    runLogsTab,
    setRunLogsTab,
    openRunLogs,
    openCurrentSessionHistory,
    closeRunLogs,
    expandedPromptImageId,
    openPromptImagePreview,
    closePromptImagePreview,
    copiedControlKey,
    handleCopyWithFeedback,
    isCommandPreviewOpen,
    commandPreviewState,
    openCommandPreview,
    closeCommandPreview
  }
}