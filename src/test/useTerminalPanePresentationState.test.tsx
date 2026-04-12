import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalPanePresentationState } from '../components/useTerminalPanePresentationState'
import type { PreviewRunCommandResponse } from '../types'

function createPreviewResponse(): PreviewRunCommandResponse {
  return {
    success: true,
    commandLine: 'codex --model codex-model',
    stdinPrompt: null,
    effectivePrompt: 'Prompt body',
    workingDirectory: 'C:\\workspace',
    notes: []
  }
}

function renderPresentationHook(options: {
  onCopyText?: (paneId: string, text: string, successMessage: string) => Promise<boolean>
  onPreviewRunCommand?: (paneId: string, promptOverride?: string) => Promise<PreviewRunCommandResponse>
  onSelectSession?: (paneId: string, sessionKey: string | null) => void
  flushPromptSync?: (nextValue?: string) => void
} = {}) {
  const onCopyText = vi.fn(options.onCopyText ?? (async () => true))
  const onPreviewRunCommand = vi.fn(options.onPreviewRunCommand ?? (async () => createPreviewResponse()))
  const onSelectSession = vi.fn(options.onSelectSession ?? (() => undefined))
  const flushPromptSync = vi.fn(options.flushPromptSync ?? (() => undefined))

  const hook = renderHook(() => useTerminalPanePresentationState({
    paneId: 'pane-1',
    promptDraft: 'Prompt body',
    flushPromptSync,
    onCopyText,
    onPreviewRunCommand,
    onSelectSession
  }))

  return {
    ...hook,
    onCopyText,
    onPreviewRunCommand,
    onSelectSession,
    flushPromptSync
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useTerminalPanePresentationState', () => {
  it('run logs modal を logs / current session history の両方で開ける', () => {
    const harness = renderPresentationHook()

    act(() => {
      harness.result.current.openRunLogs()
    })

    expect(harness.result.current.isRunLogsExpanded).toBe(true)
    expect(harness.result.current.runLogsMode).toBe('logs')
    expect(harness.result.current.runLogsTab).toBe('conversation')

    act(() => {
      harness.result.current.openCurrentSessionHistory()
    })

    expect(harness.onSelectSession).toHaveBeenCalledWith('pane-1', null)
    expect(harness.result.current.runLogsMode).toBe('conversation')
    expect(harness.result.current.runLogsTab).toBe('conversation')
  })

  it('preview open は prompt sync 後に preview state を ready にする', async () => {
    const previewResponse = createPreviewResponse()
    const harness = renderPresentationHook({
      onPreviewRunCommand: async () => previewResponse
    })

    await act(async () => {
      await harness.result.current.openCommandPreview()
    })

    expect(harness.flushPromptSync).toHaveBeenCalledWith('Prompt body')
    expect(harness.onPreviewRunCommand).toHaveBeenCalledWith('pane-1', 'Prompt body')
    expect(harness.result.current.isCommandPreviewOpen).toBe(true)
    expect(harness.result.current.commandPreviewState).toEqual({
      status: 'ready',
      data: previewResponse,
      error: null
    })
  })

  it('copy feedback は一時表示してタイマーで消える', async () => {
    vi.useFakeTimers()
    const harness = renderPresentationHook({
      onCopyText: async () => true
    })

    await act(async () => {
      await harness.result.current.handleCopyWithFeedback('output-pane-1', 'Copied text', 'copied')
    })

    expect(harness.onCopyText).toHaveBeenCalledWith('pane-1', 'Copied text', 'copied')
    expect(harness.result.current.copiedControlKey).toBe('output-pane-1')

    act(() => {
      vi.advanceTimersByTime(950)
    })

    expect(harness.result.current.copiedControlKey).toBeNull()
  })
})