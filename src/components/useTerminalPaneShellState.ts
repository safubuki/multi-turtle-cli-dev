import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { acquireBodyScrollLock } from '../lib/browserUi'
import type { PaneState } from '../types'

interface UseTerminalPaneShellStateParams {
  pane: PaneState
  shellPromptLabel: string
  canRunShell: boolean
  onUpdate: (paneId: string, updates: Partial<PaneState>) => void
  onRunShell: (paneId: string) => void
}

function appendInlineShellOutput(existing: string, prompt: string): string {
  const nextLine = prompt.replace(/\r/g, '').replace(/\n$/, '')
  if (!existing) {
    return nextLine
  }

  const nextOutput = `${existing}\n${nextLine}`
  return nextOutput.length <= 48_000 ? nextOutput : `${nextOutput.slice(0, 48_000).trimEnd()}\n\n[truncated]`
}

export function useTerminalPaneShellState(params: UseTerminalPaneShellStateParams) {
  const [isShellExpanded, setIsShellExpanded] = useState(false)
  const shellInputRef = useRef<HTMLInputElement | null>(null)
  const shellModalInputRef = useRef<HTMLInputElement | null>(null)
  const shellConsoleRef = useRef<HTMLDivElement | null>(null)
  const shellModalConsoleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isShellExpanded) {
      return
    }

    return acquireBodyScrollLock()
  }, [isShellExpanded])

  useEffect(() => {
    const elements = [shellConsoleRef.current, shellModalConsoleRef.current].filter(Boolean) as HTMLDivElement[]
    for (const element of elements) {
      element.scrollTop = element.scrollHeight
    }
  }, [isShellExpanded, params.pane.shellCommand, params.pane.shellOutput])

  useEffect(() => {
    if (params.pane.shellRunning) {
      return
    }

    const target = isShellExpanded ? shellModalInputRef.current : shellInputRef.current
    target?.focus()
  }, [isShellExpanded, params.pane.shellOpen, params.pane.shellRunning])

  const openShell = () => setIsShellExpanded(true)
  const closeShell = () => setIsShellExpanded(false)
  const focusInlineShellInput = () => shellInputRef.current?.focus()
  const focusModalShellInput = () => shellModalInputRef.current?.focus()

  const updateShellCommand = (value: string) => {
    params.onUpdate(params.pane.id, { shellCommand: value, shellHistoryIndex: null })
  }

  const handleShellKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && !params.pane.shellRunning) {
      event.preventDefault()
      params.onUpdate(params.pane.id, {
        shellCommand: '',
        shellHistoryIndex: null,
        shellOutput: appendInlineShellOutput(params.pane.shellOutput, params.shellPromptLabel)
      })
      window.requestAnimationFrame(() => {
        if (isShellExpanded) {
          focusModalShellInput()
          return
        }

        focusInlineShellInput()
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (params.pane.shellHistory.length === 0) {
        return
      }

      const nextIndex = params.pane.shellHistoryIndex === null
        ? params.pane.shellHistory.length - 1
        : Math.max(0, params.pane.shellHistoryIndex - 1)
      params.onUpdate(params.pane.id, {
        shellHistoryIndex: nextIndex,
        shellCommand: params.pane.shellHistory[nextIndex] ?? ''
      })
      return
    }

    if (event.key === 'ArrowDown') {
      if (params.pane.shellHistory.length === 0) {
        return
      }

      event.preventDefault()
      if (params.pane.shellHistoryIndex === null) {
        return
      }

      const nextIndex = params.pane.shellHistoryIndex + 1
      if (nextIndex >= params.pane.shellHistory.length) {
        params.onUpdate(params.pane.id, { shellHistoryIndex: null, shellCommand: '' })
        return
      }

      params.onUpdate(params.pane.id, {
        shellHistoryIndex: nextIndex,
        shellCommand: params.pane.shellHistory[nextIndex] ?? ''
      })
      return
    }

    if (event.key === 'Enter' && params.canRunShell && !params.pane.shellRunning) {
      event.preventDefault()
      params.onRunShell(params.pane.id)
    }
  }

  return {
    isShellExpanded,
    openShell,
    closeShell,
    shellInputRef,
    shellModalInputRef,
    shellConsoleRef,
    shellModalConsoleRef,
    focusInlineShellInput,
    focusModalShellInput,
    updateShellCommand,
    handleShellKeyDown
  }
}