import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalPanePromptComposer } from '../components/useTerminalPanePromptComposer'

function createFileList(files: File[]): FileList {
  const fileList: Record<number, File> & { length: number; item: (index: number) => File | null } = {
    length: files.length,
    item: (index: number) => files[index] ?? null
  }

  files.forEach((file, index) => {
    fileList[index] = file
  })

  return fileList as unknown as FileList
}

function createDragEvent(file: File) {
  return {
    preventDefault: vi.fn(),
    currentTarget: {
      contains: vi.fn(() => false)
    },
    relatedTarget: null,
    dataTransfer: {
      files: createFileList([file]),
      dropEffect: 'none'
    }
  }
}

function createClipboardEvent(file: File) {
  return {
    preventDefault: vi.fn(),
    clipboardData: {
      items: [{
        kind: 'file',
        getAsFile: () => file
      }]
    }
  }
}

function renderPromptComposerHook(options: {
  prompt?: string
  isFocusLayout?: boolean
  hasWorkspaceTarget?: boolean
  hasUploadingPromptImages?: boolean
  hasPromptImageErrors?: boolean
  isPromptImageSupported?: boolean
  promptImageCount?: number
  isBusy?: boolean
} = {}) {
  const onUpdate = vi.fn()
  const onRun = vi.fn()
  const onAddPromptImages = vi.fn()

  const hook = renderHook(() => useTerminalPanePromptComposer({
    paneId: 'pane-1',
    prompt: options.prompt ?? 'Initial prompt',
    isFocusLayout: options.isFocusLayout ?? false,
    hasWorkspaceTarget: options.hasWorkspaceTarget ?? true,
    hasUploadingPromptImages: options.hasUploadingPromptImages ?? false,
    hasPromptImageErrors: options.hasPromptImageErrors ?? false,
    isPromptImageSupported: options.isPromptImageSupported ?? true,
    promptImageCount: options.promptImageCount ?? 0,
    isBusy: options.isBusy ?? false,
    onUpdate,
    onRun,
    onAddPromptImages
  }))

  return {
    ...hook,
    onUpdate,
    onRun,
    onAddPromptImages
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

describe('useTerminalPanePromptComposer', () => {
  it('prompt change で draft と同期更新を反映する', () => {
    const harness = renderPromptComposerHook()

    act(() => {
      harness.result.current.handlePromptDraftChange({
        target: { value: 'Updated prompt' }
      } as React.ChangeEvent<HTMLTextAreaElement>)
    })

    expect(harness.result.current.promptDraft).toBe('Updated prompt')
    expect(harness.onUpdate).toHaveBeenCalledWith('pane-1', { prompt: 'Updated prompt' })
  })

  it('drag and drop / paste で画像追加を hook 側から委譲する', () => {
    const harness = renderPromptComposerHook()
    const imageFile = new File(['image'], 'diagram.png', { type: 'image/png' })

    act(() => {
      harness.result.current.handlePromptDragEnter(createDragEvent(imageFile) as unknown as React.DragEvent<HTMLElement>)
    })

    expect(harness.result.current.isPromptDropActive).toBe(true)

    act(() => {
      harness.result.current.handlePromptDrop(createDragEvent(imageFile) as unknown as React.DragEvent<HTMLElement>)
    })

    expect(harness.result.current.isPromptDropActive).toBe(false)
    expect(harness.onAddPromptImages).toHaveBeenCalledWith('pane-1', [imageFile], 'drop')

    act(() => {
      harness.result.current.handlePromptPaste(createClipboardEvent(imageFile) as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })

    expect(harness.onAddPromptImages).toHaveBeenCalledWith('pane-1', [imageFile], 'clipboard')
  })

  it('run request で flush 後に onRun を呼び prompt に focus を戻す', () => {
    const harness = renderPromptComposerHook()
    const textarea = document.createElement('textarea')
    const focusSpy = vi.spyOn(textarea, 'focus')
    harness.result.current.promptRef.current = textarea

    act(() => {
      harness.result.current.handlePromptDraftChange({
        target: { value: 'Run prompt' }
      } as React.ChangeEvent<HTMLTextAreaElement>)
    })

    act(() => {
      harness.result.current.handleRunRequest()
    })

    expect(harness.onRun).toHaveBeenCalledWith('pane-1', 'Run prompt')
    expect(focusSpy).toHaveBeenCalled()
  })
})