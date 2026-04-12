import type { MutableRefObject } from 'react'
import { runShellStream, stopShellRun } from './api'
import { buildShellPromptLabel, buildTargetFromPane } from './appCore'
import { appendShellOutputLine } from './text'
import type { BootstrapPayload, LocalWorkspace, PaneState, ShellRunEvent } from '../types'

type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void
type PaneMutator = (paneId: string, updater: (pane: PaneState) => PaneState) => void

interface ShellActionsParams {
  bootstrap: BootstrapPayload | null
  panesRef: MutableRefObject<PaneState[]>
  localWorkspacesRef: MutableRefObject<LocalWorkspace[]>
  shellControllersRef: MutableRefObject<Record<string, AbortController>>
  shellStopRequestedRef: MutableRefObject<Set<string>>
  updatePane: PaneUpdater
  mutatePane: PaneMutator
}

export function createShellActions(params: ShellActionsParams) {
  const handleRunShell = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const command = pane.shellCommand.trim()
    if (!command) {
      params.updatePane(paneId, {
        shellCommand: '',
        shellHistoryIndex: null,
        shellLastError: null
      })
      return
    }

    if (/^(clear|cls)$/i.test(command)) {
      params.updatePane(paneId, {
        shellCommand: '',
        shellHistoryIndex: null,
        shellOutput: '',
        shellLastExitCode: null,
        shellLastError: null,
        shellLastRunAt: Date.now()
      })
      return
    }

    const target = buildTargetFromPane(pane, params.localWorkspacesRef.current, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
    if (!target) {
      params.mutatePane(paneId, (current) => ({
        ...current,
        shellCommand: '',
        shellHistoryIndex: null,
        shellLastError: 'ワークスペースまたは SSH 接続を設定してください',
        shellOutput: appendShellOutputLine(current.shellOutput, '[error] ワークスペースまたは SSH 接続を設定してください'),
        shellLastRunAt: Date.now()
      }))
      return
    }

    if (!params.bootstrap?.features.shell) {
      params.mutatePane(paneId, (current) => ({
        ...current,
        shellCommand: '',
        shellHistoryIndex: null,
        shellLastError: '簡易内蔵ターミナル API が見つかりません。TAKO のサーバーを再起動してください。',
        shellOutput: appendShellOutputLine(current.shellOutput, '[error] 簡易内蔵ターミナル API が見つかりません。TAKO のサーバーを再起動してください。'),
        shellLastRunAt: Date.now()
      }))
      return
    }

    if (params.shellControllersRef.current[paneId]) {
      return
    }

    const cwd = pane.workspaceMode === 'local'
      ? (pane.localShellPath.trim() || pane.localWorkspacePath.trim())
      : (pane.remoteShellPath.trim() || pane.remoteWorkspacePath.trim())
    const nextShellHistory = pane.shellHistory[pane.shellHistory.length - 1] === command
      ? pane.shellHistory
      : [...pane.shellHistory, command].slice(-50)

    const startedAt = Date.now()
    const controller = new AbortController()
    params.shellControllersRef.current[paneId] = controller
    params.shellStopRequestedRef.current.delete(paneId)

    params.updatePane(paneId, {
      shellRunning: true,
      shellCommand: '',
      shellHistory: nextShellHistory,
      shellHistoryIndex: null,
      shellLastError: null,
      shellLastExitCode: null,
      shellLastRunAt: startedAt,
      shellOutput: appendShellOutputLine(pane.shellOutput, `${buildShellPromptLabel(pane, cwd)}${command}`)
    })

    try {
      await runShellStream(
        {
          paneId,
          target,
          command,
          cwd: cwd || null
        },
        (event: ShellRunEvent) => {
          const eventTime = Date.now()
          params.mutatePane(paneId, (current) => {
            if (event.type === 'stdout') {
              return {
                ...current,
                shellOutput: appendShellOutputLine(current.shellOutput, event.text),
                shellLastRunAt: eventTime
              }
            }

            if (event.type === 'stderr') {
              return {
                ...current,
                shellOutput: appendShellOutputLine(current.shellOutput, event.text),
                shellLastRunAt: eventTime
              }
            }

            if (event.type === 'cwd') {
              return current.workspaceMode === 'local'
                ? {
                    ...current,
                    localShellPath: event.cwd,
                    shellLastRunAt: eventTime
                  }
                : {
                    ...current,
                    remoteShellPath: event.cwd,
                    shellLastRunAt: eventTime
                  }
            }

            if (event.type === 'exit') {
              return current.workspaceMode === 'local'
                ? {
                    ...current,
                    shellRunning: false,
                    localShellPath: event.cwd,
                    shellLastExitCode: event.exitCode,
                    shellLastError: null,
                    shellLastRunAt: eventTime
                  }
                : {
                    ...current,
                    shellRunning: false,
                    remoteShellPath: event.cwd,
                    shellLastExitCode: event.exitCode,
                    shellLastError: null,
                    shellLastRunAt: eventTime
                  }
            }

            return current
          })
        },
        controller.signal
      )
    } catch (error) {
      if (!params.shellStopRequestedRef.current.has(paneId)) {
        const message = error instanceof Error ? error.message : String(error)
        params.mutatePane(paneId, (current) => ({
          ...current,
          shellRunning: false,
          shellLastError: message,
          shellOutput: appendShellOutputLine(current.shellOutput, `[error] ${message}`),
          shellLastRunAt: Date.now()
        }))
      }
    } finally {
      delete params.shellControllersRef.current[paneId]
      params.shellStopRequestedRef.current.delete(paneId)
      params.mutatePane(paneId, (current) => ({
        ...current,
        shellRunning: false
      }))
    }
  }

  const handleStopShell = async (paneId: string) => {
    params.shellStopRequestedRef.current.add(paneId)
    params.shellControllersRef.current[paneId]?.abort()
    delete params.shellControllersRef.current[paneId]

    try {
      await stopShellRun(paneId)
    } catch {
      // ignore best-effort stop
    }

    params.mutatePane(paneId, (pane) => ({
      ...pane,
      shellRunning: false,
      shellLastError: null,
      shellOutput: appendShellOutputLine(pane.shellOutput, '^C'),
      shellLastRunAt: Date.now()
    }))
  }

  return {
    handleRunShell,
    handleStopShell
  }
}