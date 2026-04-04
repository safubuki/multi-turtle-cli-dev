import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import iconv from 'iconv-lite'
import { buildSshCommandArgs } from './ssh.js'
import type { ActiveShellRun, ShellExecResult, ShellRunEvent, ShellRunRequestBody, WorkspaceTarget } from './types.js'
import { shellEscapePosix } from './util.js'

const CWD_MARKER = '__TAKO_SHELL_CWD__:'

type ShellEncoding = 'utf8' | 'cp932'

interface BufferedDecoder {
  write: (chunk: Buffer) => string
  end: () => string
}

function getCmdExecutable(): string {
  return process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function resolveLocalWorkingDirectory(target: Extract<WorkspaceTarget, { kind: 'local' }>, cwd?: string | null): string {
  const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
  return path.resolve(cwd?.trim() || basePath)
}

function resolveRemoteWorkingDirectory(target: Extract<WorkspaceTarget, { kind: 'ssh' }>, cwd?: string | null): string {
  const basePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  return (cwd?.trim() || basePath || '~').trim()
}

function createBufferDecoder(encoding: ShellEncoding): BufferedDecoder {
  if (encoding === 'cp932') {
    const decoder = iconv.getDecoder('cp932')
    return {
      write: (chunk) => decoder.write(chunk),
      end: () => decoder.end() ?? ''
    }
  }

  const decoder = new TextDecoder('utf-8')
  return {
    write: (chunk) => decoder.decode(chunk, { stream: true }),
    end: () => decoder.decode()
  }
}

function buildLocalWindowsSpec(target: Extract<WorkspaceTarget, { kind: 'local' }>, command: string, cwd?: string | null) {
  const workingDirectory = resolveLocalWorkingDirectory(target, cwd)
  const script = [
    `cd /d ${quoteForCmd(workingDirectory)}`,
    command,
    'set "__TAKO_EXIT__=!ERRORLEVEL!"',
    `echo ${CWD_MARKER}%CD%`,
    'exit /b !__TAKO_EXIT__!'
  ].join(' & ')

  return {
    command: getCmdExecutable(),
    args: ['/d', '/v:on', '/s', '/c', script],
    workingDirectory,
    encoding: 'cp932' as const
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

function emitLines(
  onEvent: ((event: ShellRunEvent) => void) | undefined,
  type: 'stdout' | 'stderr',
  buffer: string,
  final: boolean,
  state: { cwd: string }
) {
  const normalized = buffer.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const carry = final ? '' : lines.pop() ?? ''

  for (const line of lines) {
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
    const stdoutDecoder = createBufferDecoder(spec.encoding)
    const stderrDecoder = createBufferDecoder(spec.encoding)

    child.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk)
      stdoutText += text
      stdoutBuffer = emitLines(options.onEvent, 'stdout', stdoutBuffer + text, false, state)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk)
      stderrText += text
      stderrBuffer = emitLines(options.onEvent, 'stderr', stderrBuffer + text, false, state)
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('close', (code) => {
      const stdoutTail = stdoutDecoder.end()
      const stderrTail = stderrDecoder.end()
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

      if (stdoutBuffer.length > 0) {
        options.onEvent?.({ type: 'stdout', text: stdoutBuffer.replace(/\r/g, '') })
      }
      if (stderrBuffer.length > 0) {
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
