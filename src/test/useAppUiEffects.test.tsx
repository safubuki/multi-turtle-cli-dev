import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppUiEffects } from '../lib/useAppUiEffects'
import type { PaneState, WorkspacePickerState } from '../types'

const browserUiMocks = vi.hoisted(() => ({
  acquireBodyScrollLock: vi.fn()
}))

vi.mock('../lib/browserUi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/browserUi')>()
  return {
    ...actual,
    acquireBodyScrollLock: browserUiMocks.acquireBodyScrollLock
  }
})

function createSelectedPane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    workspaceMode: 'local',
    localWorkspacePath: 'C:\\workspace',
    localBrowserPath: '',
    localBrowserLoading: false,
    ...overrides
  } as PaneState
}

function createWorkspacePicker(): WorkspacePickerState {
  return {
    mode: 'local',
    paneId: 'pane-1',
    path: 'C:\\workspace',
    entries: [],
    roots: [],
    loading: false,
    error: null
  }
}

function renderAppUiEffectsHook(options: {
  workspacePicker?: WorkspacePickerState | null
  selectedPane?: PaneState | null
  selectedPaneIds?: string[]
} = {}) {
  const handleBrowseLocal = vi.fn(async () => undefined)
  const handleDeleteSelectedPanes = vi.fn()

  const hook = renderHook((props: {
    workspacePicker: WorkspacePickerState | null
    selectedPane: PaneState | null
    selectedPaneIds: string[]
  }) => useAppUiEffects({
    workspacePicker: props.workspacePicker,
    selectedPane: props.selectedPane,
    selectedPaneIds: props.selectedPaneIds,
    handleBrowseLocal,
    handleDeleteSelectedPanes
  }), {
    initialProps: {
      workspacePicker: options.workspacePicker ?? null,
      selectedPane: options.selectedPane ?? null,
      selectedPaneIds: options.selectedPaneIds ?? []
    }
  })

  return {
    ...hook,
    handleBrowseLocal,
    handleDeleteSelectedPanes
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAppUiEffects', () => {
  it('workspace picker 表示中は body scroll lock を取得する', () => {
    const releaseLock = vi.fn()
    browserUiMocks.acquireBodyScrollLock.mockReturnValue(releaseLock)

    const harness = renderAppUiEffectsHook({
      workspacePicker: createWorkspacePicker()
    })

    expect(browserUiMocks.acquireBodyScrollLock).toHaveBeenCalledTimes(1)

    harness.unmount()

    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('Delete キーで一括削除を呼ぶが、入力中は無視する', () => {
    const harness = renderAppUiEffectsHook({
      selectedPaneIds: ['pane-1']
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    })

    expect(harness.handleDeleteSelectedPanes).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    })

    expect(harness.handleDeleteSelectedPanes).toHaveBeenCalledTimes(1)
    document.body.removeChild(input)
  })

  it('選択中の local pane で browser が未ロードなら自動 browse する', () => {
    const harness = renderAppUiEffectsHook({
      selectedPane: createSelectedPane()
    })

    expect(harness.handleBrowseLocal).toHaveBeenCalledWith('pane-1', 'C:\\workspace')
  })
})