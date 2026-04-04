import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { buildSshCommandArgs } from './ssh.js'
import type { ActiveShellRun, ShellExecResult, ShellRunEvent, ShellRunRequestBody, WorkspaceTarget } from './types.js'
import { shellEscapePosix } from './util.js'

const CWD_MARKER = '__TAKO_SHELL_CWD__:'

function getPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function resolveLocalWorkingDirectory(target: Extract<WorkspaceTarget, { kind: 'local' }>, cwd?: string | null): string {
  const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
  return path.resolve(cwd?.trim() || basePath)
}

function resolveRemoteWorkingDirectory(target: Extract<WorkspaceTarget, { kind: 'ssh' }>, cwd?: string | null): string {
  const basePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  return (cwd?.trim() || basePath || '~').trim()
}

type ShellEncoding = 'utf8' | 'shift_jis'

function createTextDecoder(encoding: ShellEncoding): TextDecoder {
  try {
    return new TextDecoder(encoding === 'shift_jis' ? 'shift-jis' : 'utf-8')
  } catch {
    return new TextDecoder('utf-8')
  }
}

function buildLocalWindowsSpec(target: Extract<WorkspaceTarget, { kind: 'local' }>, command: string, cwd?: string | null) {
  const workingDirectory = resolveLocalWorkingDirectory(target, cwd)
  const script = [
    "$ErrorActionPreference = 'Continue'",
    '[Console]::InputEncoding = [System.Text.Encoding]::GetEncoding(932)',
    '[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(932)',
    '$OutputEncoding = [Console]::OutputEncoding',
    `Set-Location -LiteralPath ${quoteForPowerShell(workingDirectory)}`,
    "$__takoOutput = Invoke-Expression @'",
    command,
    "'@ *>&1 | ForEach-Object { $_.ToString() }",
    'foreach ($__takoLine in $__takoOutput) { Write-Output $__takoLine }',
    '$takoExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
    `Write-Output ('${CWD_MARKER}' + (Get-Location).Path)`,
    'exit $takoExitCode'
  ].join('\n')

  return {
    command: getPowerShellExecutable(),
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    workingDirectory,
    encoding: 'shift_jis' as const
  }
}

function buildLocalPosixSpec(target: Extract<WorkspaceTarget, { kind: 'local' }>, command: string, cwd?: string | null) {
  const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
  const workingDirectory = path.resolve(cwd?.trim() || basePath)
  const script = [
    `cd ${shellEscapePosix(workingDirectory)}`,
    command,
    'tako_exit=$?',
    `printf '${CWD_MARKER}%s\\n' "$PWD"`,
    'exit $tako_exit'
  ].join('\n')

  return {
    command: 'bash',
    args: ['-lc', script],
    workingDirectory,
    encoding: 'utf8' as const
  }
}

function buildRemoteSpec(target: Extract<WorkspaceTarget, { kind: 'ssh' }>, command: string, cwd?: string | null) {
  const workingDirectory = resolveRemoteWorkingDirectory(target, cwd)
  const remoteScript = [
    `cd ${shellEscapePosix(workingDirectory)}`,
    command,
    'tako_exit=$?',
    `printf '${CWD_MARKER}%s\\n' "$PWD"`,
    'exit $tako_exit'
  ].join('\n')

  return {
    command: 'ssh',
    args: buildSshCommandArgs({ host: target.host, connection: target.connection }, ['bash', '-lc', remoteScript]),
    workingDirectory,
    encoding: 'utf8' as const
  }
}

function buildShellSpec(target: WorkspaceTarget, command: string, cwd?: string | null) {
  if (target.kind === 'local') {
    return process.platform === 'win32'
      ? buildLocalWindowsSpec(target, command, cwd)
      : buildLocalPosixSpec(target, command, cwd)
  }

  return buildRemoteSpec(target, command, cwd)
}

function emitLines(onEvent: ((event: ShellRunEvent) => void) | undefined, type: 'stdout' | 'stderr', buffer: string, final: boolean, state: { cwd: string }) {
  const normalized = buffer.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const carry = final ? '' : lines.pop() ?? ''

  for (const line of lines) {
    if (!line.trim()) {
      continue
    }

    if (line.startsWith(CWD_MARKER)) {
      const nextCwd = line.slice(CWD_MARKER.length).trim()
      if (nextCwd) {
        state.cwd = nextCwd
        onEvent?.({ type: 'cwd', cwd: nextCwd })
      }
      continue
    }

    onEvent?.({ type, text: line })
  }

  return carry
}

function killChild(child: ChildProcess): void {
  if (child.killed) {
    return
  }

  try {
    child.kill()
  } catch {
    // ignore
  }
}

export async function startShellRun(options: ShellRunRequestBody & { onEvent?: (event: ShellRunEvent) => void }): Promise<ActiveShellRun> {
  const trimmedCommand = options.command.trim()
  if (!trimmedCommand) {
    throw new Error('command required')
  }

  const spec = buildShellSpec(options.target, trimmedCommand, options.cwd)
  const child = spawn(spec.command, spec.args, {
    cwd: spec.workingDirectory,
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const promise = new Promise<ShellExecResult>((resolve, reject) => {
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let stdoutText = ''
    let stderrText = ''
    const state = { cwd: spec.workingDirectory }
    const stdoutDecoder = createTextDecoder(spec.encoding)
    const stderrDecoder = createTextDecoder(spec.encoding)

    child.stdout.on('data', (chunk) => {
      const text = stdoutDecoder.decode(chunk, { stream: true })
      stdoutText += text
      stdoutBuffer = emitLines(options.onEvent, 'stdout', stdoutBuffer + text, false, state)
    })

    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.decode(chunk, { stream: true })
      stderrText += text
      stderrBuffer = emitLines(options.onEvent, 'stderr', stderrBuffer + text, false, state)
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('close', (code) => {
      const stdoutTail = stdoutDecoder.decode()
      const stderrTail = stderrDecoder.decode()
      if (stdoutTail) {
        stdoutText += stdoutTail
        stdoutBuffer += stdoutTail
      }
      if (stderrTail) {
        stderrText += stderrTail
        stderrBuffer += stderrTail
      }

      stdoutBuffer = emitLines(options.onEvent, 'stdout', stdoutBuffer, true, state)
      stderrBuffer = emitLines(options.onEvent, 'stderr', stderrBuffer, true, state)

      if (stdoutBuffer.trim()) {
        options.onEvent?.({ type: 'stdout', text: stdoutBuffer.replace(/\r/g, '') })
      }
      if (stderrBuffer.trim()) {
        options.onEvent?.({ type: 'stderr', text: stderrBuffer.replace(/\r/g, '') })
      }

      const exitCode = typeof code === 'number' ? code : -1
      const cleanedStdout = stdoutText
        .replace(/\r/g, '')
        .split('\n')
        .filter((line) => !line.startsWith(CWD_MARKER))
        .join('\n')
        .trimEnd()
      const cleanedStderr = stderrText.replace(/\r/g, '').trimEnd()

      resolve({
        exitCode,
        cwd: state.cwd,
        stdout: cleanedStdout,
        stderr: cleanedStderr
      })
    })
  })

  return {
    promise,
    stop: () => killChild(child)
  }
}
