import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalPaneShellState } from '../components/useTerminalPaneShellState'
import type { PaneState } from '../types'

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

function createPane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    shellOpen: true,
    shellCommand: 'pwd',
    shellOutput: '',
    shellHistory: ['ls', 'pwd'],
    shellHistoryIndex: null,
    shellRunning: false,
    ...overrides
  } as PaneState
}

function renderShellHook(options: {
  pane?: PaneState
  canRunShell?: boolean
} = {}) {
  const onUpdate = vi.fn()
  const onRunShell = vi.fn()

  const hook = renderHook((props: { pane: PaneState; canRunShell: boolean }) => useTerminalPaneShellState({
    pane: props.pane,
    shellPromptLabel: 'C:\\workspace>',
    canRunShell: props.canRunShell,
    onUpdate,
    onRunShell
  }), {
    initialProps: {
      pane: options.pane ?? createPane(),
      canRunShell: options.canRunShell ?? true
    }
  })

  return {
    ...hook,
    onUpdate,
    onRunShell
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame)
})

describe('useTerminalPaneShellState', () => {
  it('shell command 更新で history index をクリアする', () => {
    const harness = renderShellHook({
      pane: createPane({ shellHistoryIndex: 1 })
    })

    act(() => {
      harness.result.current.updateShellCommand('git status')
    })

    expect(harness.onUpdate).toHaveBeenCalledWith('pane-1', {
      shellCommand: 'git status',
      shellHistoryIndex: null
    })
  })

  it('shell history の上下キーで command を切り替える', () => {
    const harness = renderShellHook()

    act(() => {
      harness.result.current.handleShellKeyDown({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
        ctrlKey: false
      } as unknown as React.KeyboardEvent<HTMLInputElement>)
    })

    expect(harness.onUpdate).toHaveBeenCalledWith('pane-1', {
      shellHistoryIndex: 1,
      shellCommand: 'pwd'
    })

    harness.rerender({
      pane: createPane({ shellHistoryIndex: 0 }),
      canRunShell: true
    })

    act(() => {
      harness.result.current.handleShellKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
        ctrlKey: false
      } as unknown as React.KeyboardEvent<HTMLInputElement>)
    })

    expect(harness.onUpdate).toHaveBeenLastCalledWith('pane-1', {
      shellHistoryIndex: 1,
      shellCommand: 'pwd'
    })
  })

  it('Ctrl+C と Enter を shell hook が処理する', () => {
    const harness = renderShellHook()
    const input = document.createElement('input')
    const focusSpy = vi.spyOn(input, 'focus')
    harness.result.current.shellInputRef.current = input

    act(() => {
      harness.result.current.handleShellKeyDown({
        key: 'c',
        ctrlKey: true,
        preventDefault: vi.fn()
      } as unknown as React.KeyboardEvent<HTMLInputElement>)
    })

    expect(harness.onUpdate).toHaveBeenCalledWith('pane-1', {
      shellCommand: '',
      shellHistoryIndex: null,
      shellOutput: 'C:\\workspace>'
    })
    expect(focusSpy).toHaveBeenCalled()

    act(() => {
      harness.result.current.handleShellKeyDown({
        key: 'Enter',
        ctrlKey: false,
        preventDefault: vi.fn()
      } as unknown as React.KeyboardEvent<HTMLInputElement>)
    })

    expect(harness.onRunShell).toHaveBeenCalledWith('pane-1')
  })
})