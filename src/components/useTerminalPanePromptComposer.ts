import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent as ReactDragEvent } from 'react'
import type { PaneState, PromptImageAttachmentSource } from '../types'

interface UseTerminalPanePromptComposerParams {
  paneId: string
  prompt: string
  isFocusLayout: boolean
  hasWorkspaceTarget: boolean
  hasUploadingPromptImages: boolean
  hasPromptImageErrors: boolean
  isPromptImageSupported: boolean
  promptImageCount: number
  isBusy: boolean
  onUpdate: (paneId: string, updates: Partial<PaneState>) => void
  onRun: (paneId: string, promptOverride?: string) => void
  onAddPromptImages: (paneId: string, files: File[], source: PromptImageAttachmentSource) => void
}

export function useTerminalPanePromptComposer(params: UseTerminalPanePromptComposerParams) {
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const promptImageInputRef = useRef<HTMLInputElement | null>(null)
  const promptSyncFrameRef = useRef<number | null>(null)
  const promptSyncedValueRef = useRef(params.prompt)
  const promptDropDepthRef = useRef(0)
  const promptAppliedHeightRef = useRef(0)
  const [promptDraft, setPromptDraft] = useState(params.prompt)
  const [promptManualHeight, setPromptManualHeight] = useState<number | null>(null)
  const [isPromptDropActive, setIsPromptDropActive] = useState(false)

  useEffect(() => {
    return () => {
      if (promptSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(promptSyncFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (params.prompt === promptSyncedValueRef.current) {
      return
    }

    promptSyncedValueRef.current = params.prompt
    setPromptDraft(params.prompt)
  }, [params.prompt])

  useEffect(() => {
    const element = promptRef.current
    if (!element) {
      return
    }

    const minHeight = params.isFocusLayout ? 232 : 186
    const maxHeight = params.isFocusLayout ? 520 : 420
    const autoHeight = Math.min(Math.max(element.scrollHeight, minHeight), maxHeight)
    const nextHeight = promptManualHeight === null ? autoHeight : Math.max(promptManualHeight, minHeight)

    promptAppliedHeightRef.current = nextHeight
    element.style.height = `${nextHeight}px`
    element.style.overflowY = element.scrollHeight > nextHeight ? 'auto' : 'hidden'
  }, [params.isFocusLayout, promptDraft, promptManualHeight])

  useEffect(() => {
    const element = promptRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.round(entries[0]?.contentRect.height ?? element.offsetHeight)
      if (Math.abs(nextHeight - promptAppliedHeightRef.current) <= 2) {
        return
      }

      setPromptManualHeight((current) => (current === nextHeight ? current : nextHeight))
    })

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const flushPromptSync = (nextValue = promptDraft) => {
    if (promptSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(promptSyncFrameRef.current)
      promptSyncFrameRef.current = null
    }

    if (promptSyncedValueRef.current === nextValue) {
      return
    }

    promptSyncedValueRef.current = nextValue
    params.onUpdate(params.paneId, { prompt: nextValue })
  }

  const schedulePromptSync = (nextValue: string) => {
    if (promptSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(promptSyncFrameRef.current)
    }

    promptSyncFrameRef.current = window.requestAnimationFrame(() => {
      promptSyncFrameRef.current = null
      if (promptSyncedValueRef.current === nextValue) {
        return
      }

      promptSyncedValueRef.current = nextValue
      params.onUpdate(params.paneId, { prompt: nextValue })
    })
  }

  const handlePromptDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value
    setPromptDraft(nextValue)
    schedulePromptSync(nextValue)
  }

  const capturePromptManualHeight = () => {
    const element = promptRef.current
    if (!element) {
      return
    }

    const nextHeight = Math.round(element.offsetHeight)
    if (Math.abs(nextHeight - promptAppliedHeightRef.current) <= 2) {
      return
    }

    setPromptManualHeight(nextHeight)
  }

  const handleRunRequest = () => {
    const hasPromptInput = promptDraft.trim().length > 0 || params.promptImageCount > 0
    const canRun = hasPromptInput
      && params.hasWorkspaceTarget
      && !params.hasUploadingPromptImages
      && !params.hasPromptImageErrors
      && (params.isPromptImageSupported || params.promptImageCount === 0)

    if (!canRun || params.isBusy) {
      return
    }

    flushPromptSync()
    params.onRun(params.paneId, promptDraft)
    window.requestAnimationFrame(() => {
      promptRef.current?.focus()
    })
  }

  const getPromptTransferFiles = (fileList: FileList | null): File[] => Array.from(fileList ?? [])

  const resetPromptDropState = () => {
    promptDropDepthRef.current = 0
    setIsPromptDropActive(false)
  }

  const handlePromptImageButtonClick = () => {
    promptImageInputRef.current?.click()
  }

  const handlePromptImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) {
      params.onAddPromptImages(params.paneId, files, 'picker')
    }
    event.target.value = ''
  }

  const handlePromptDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    const files = getPromptTransferFiles(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    event.preventDefault()
    promptDropDepthRef.current += 1
    setIsPromptDropActive(true)
  }

  const handlePromptDragOver = (event: ReactDragEvent<HTMLElement>) => {
    const files = getPromptTransferFiles(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!isPromptDropActive) {
      setIsPromptDropActive(true)
    }
  }

  const handlePromptDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      resetPromptDropState()
      return
    }

    promptDropDepthRef.current = Math.max(0, promptDropDepthRef.current - 1)
    if (promptDropDepthRef.current === 0) {
      setIsPromptDropActive(false)
    }
  }

  const handlePromptDrop = (event: ReactDragEvent<HTMLElement>) => {
    const files = getPromptTransferFiles(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    event.preventDefault()
    resetPromptDropState()
    params.onAddPromptImages(params.paneId, files, 'drop')
  }

  const handlePromptPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length === 0) {
      return
    }

    event.preventDefault()
    params.onAddPromptImages(params.paneId, files, 'clipboard')
  }

  return {
    promptRef,
    promptImageInputRef,
    promptDraft,
    isPromptDropActive,
    flushPromptSync,
    handlePromptDraftChange,
    capturePromptManualHeight,
    handleRunRequest,
    handlePromptImageButtonClick,
    handlePromptImageInputChange,
    handlePromptDragEnter,
    handlePromptDragOver,
    handlePromptDragLeave,
    handlePromptDrop,
    handlePromptPaste
  }
}