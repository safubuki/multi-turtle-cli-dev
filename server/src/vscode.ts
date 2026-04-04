import { existsSync } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { buildSshCommandArgs } from './ssh.js'
import type { WorkspaceTarget } from './types.js'
import { shellEscapePosix } from './util.js'

type LaunchOptions = {
  cwd?: string
  windowsHide?: boolean
}

type TerminalLaunchSpec = {
  command: string
  args: string[]
  cwd?: string
}

function getWindowsTerminalCandidates(): string[] {
  if (process.platform !== 'win32') {
    return []
  }

  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe') : null,
    'wt.exe'
  ]

  const seen = new Set<string>()
  return candidates
    .filter((value): value is string => Boolean(value))
    .filter((candidate) => {
      const key = candidate.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return !candidate.includes(path.sep) || existsSync(candidate)
    })
}

function getCodeCommandCandidates(): string[] {
  const candidates =
    process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
          process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
          process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe') : null,
          process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe') : null,
          process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : null,
          process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : null,
          'code.cmd',
          'code'
        ]
      : process.platform === 'linux'
        ? [
            process.env.HOME ? path.join(process.env.HOME, '.local', 'bin', 'code') : null,
            '/snap/bin/code',
            '/usr/bin/code',
            '/usr/local/bin/code',
            'code',
            'code-insiders',
            'codium',
            'code-oss'
          ]
        : [
            '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
            '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
            'code'
          ]

  const seen = new Set<string>()
  return candidates
    .filter((value): value is string => Boolean(value))
    .filter((candidate) => {
      const key = candidate.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return !candidate.includes(path.sep) || existsSync(candidate)
    })
}

function isCmdScript(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command)
}

function getCmdExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'cmd.exe')
}

function getPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function getLocalBasePath(target: Extract<WorkspaceTarget, { kind: 'local' }>): string {
  return path.resolve(target.resourceType === 'file' ? path.dirname(target.path) : target.path)
}

function buildRemoteFolderUri(host: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/')
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `vscode-remote://ssh-remote+${encodeURIComponent(host)}${encodeURI(pathname)}`
}

function buildRemoteFileUri(host: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/')
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `vscode-remote://ssh-remote+${encodeURIComponent(host)}${encodeURI(pathname)}`
}

function buildCmdCommandText(command: string, args: string[]): string {
  return [quoteForCmd(command), ...args.map((value) => quoteForCmd(value))].join(' ')
}

function getSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === 'win32' && isCmdScript(command)) {
    return {
      command: getCmdExecutable(),
      args: ['/d', '/s', '/c', buildCmdCommandText(command, args)]
    }
  }

  return { command, args }
}

function tryLaunch(command: string, args: string[], options: LaunchOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnSpec = getSpawnCommand(command, args)
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: options.windowsHide ?? true,
      cwd: options.cwd
    })

    let settled = false
    child.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    })

    child.once('spawn', () => {
      if (settled) {
        return
      }
      settled = true
      child.unref()
      resolve()
    })
  })
}

function quoteForCmd(value: string): string {
  if (!value) {
    return '""'
  }

  if (!/[\s"]/u.test(value)) {
    return value
  }

  return `"${value.replace(/"/g, '""')}"`
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildPowerShellArray(values: string[]): string {
  return `@(${values.map((value) => quoteForPowerShell(value)).join(', ')})`
}

function tryStartProcessWindows(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = isCmdScript(command) ? getCmdExecutable() : command
    const executableArgs = isCmdScript(command) ? ['/d', '/s', '/c', buildCmdCommandText(command, args)] : args

    let script = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${quoteForPowerShell(executable)}`
    if (executableArgs.length > 0) {
      script += ` -ArgumentList ${buildPowerShellArray(executableArgs)}`
    }
    if (cwd?.trim()) {
      script += ` -WorkingDirectory ${quoteForPowerShell(cwd)}`
    }

    const child = spawn(getPowerShellExecutable(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      const detail = stderr.trim() || stdout.trim() || `PowerShell exited with code ${code ?? 'unknown'}`
      reject(new Error(detail))
    })
  })
}

function isMissingBinaryError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '').toUpperCase()
      : ''
  const detail = error instanceof Error ? error.message : String(error ?? '')
  return code === 'ENOENT' || /cannot find the file specified|no such file or directory|not recognized/i.test(detail)
}

function buildTerminalSpecs(target: WorkspaceTarget, cwd?: string): TerminalLaunchSpec[] {
  if (process.platform === 'win32') {
    const powerShellCommand = buildWindowsPowerShellCommand(target)
    const powerShellArgs = ['-NoExit', '-NoLogo', '-Command', powerShellCommand]
    const specs: TerminalLaunchSpec[] = []

    specs.push({
      command: getPowerShellExecutable(),
      args: powerShellArgs,
      cwd
    })

    for (const candidate of getWindowsTerminalCandidates()) {
      specs.push({
        command: candidate,
        args: ['-w', 'new', ...(cwd ? ['-d', cwd] : []), getPowerShellExecutable(), ...powerShellArgs],
        cwd
      })
    }

    specs.push({
      command: getCmdExecutable(),
      args: ['/k', buildWindowsCmdCommand(target)],
      cwd
    })

    return specs
  }

  const commandText = buildPosixTerminalCommand(target)

  if (process.platform === 'linux') {
    return [
      { command: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', commandText], cwd },
      { command: 'gnome-terminal', args: ['--', 'bash', '-lc', commandText], cwd },
      { command: 'kgx', args: ['--', 'bash', '-lc', commandText], cwd },
      { command: 'konsole', args: ['-e', 'bash', '-lc', commandText], cwd },
      { command: 'mate-terminal', args: ['--', 'bash', '-lc', commandText], cwd },
      { command: 'xfce4-terminal', args: ['--command', `bash -lc ${shellEscapePosix(commandText)}`], cwd },
      { command: 'xterm', args: ['-e', 'bash', '-lc', commandText], cwd },
      { command: 'kitty', args: ['bash', '-lc', commandText], cwd },
      { command: 'wezterm', args: ['start', 'bash', '-lc', commandText], cwd }
    ]
  }

  return [{ command: 'open', args: ['-a', 'Terminal.app'], cwd }]
}

export async function openInVsCode(target: WorkspaceTarget): Promise<void> {
  const resourceType = target.resourceType ?? 'folder'
  const args =
    target.kind === 'local'
      ? ['--new-window', path.resolve(target.path)]
      : resourceType === 'file'
        ? ['--new-window', '--file-uri', buildRemoteFileUri(target.host, target.path)]
        : ['--new-window', '--folder-uri', buildRemoteFolderUri(target.host, target.path)]
  const cwd = target.kind === 'local' ? getLocalBasePath(target) : undefined

  let lastError: unknown = null

  for (const command of getCodeCommandCandidates()) {
    try {
      if (process.platform === 'win32') {
        await tryStartProcessWindows(command, args, cwd)
      } else {
        await tryLaunch(command, args, { cwd })
      }
      return
    } catch (error) {
      lastError = error
    }
  }

  if (isMissingBinaryError(lastError)) {
    throw new Error('\u0056\u0053\u0043\u006f\u0064\u0065 \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(`\u0056\u0053\u0043\u006f\u0064\u0065 \u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ${detail}`)
}

export async function openInCommandPrompt(target: WorkspaceTarget): Promise<void> {
  const cwd = target.kind === 'local' ? getLocalBasePath(target) : undefined
  let lastError: unknown = null

  for (const spec of buildTerminalSpecs(target, cwd)) {
    try {
      if (process.platform === 'win32') {
        await tryStartProcessWindows(spec.command, spec.args, spec.cwd)
      } else {
        await tryLaunch(spec.command, spec.args, {
          cwd: spec.cwd,
          windowsHide: false
        })
      }
      return
    } catch (error) {
      lastError = error
    }
  }

  if (isMissingBinaryError(lastError)) {
    throw new Error(
      process.platform === 'win32'
        ? '\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002'
        : '\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002 Ubuntu \u3067\u306f gnome-terminal \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
    )
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(`\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ${detail}`)
}

function buildWindowsCmdCommand(target: WorkspaceTarget): string {
  if (target.kind === 'local') {
    return `cd /d ${quoteForCmd(getLocalBasePath(target))}`
  }

  const remotePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  const remoteCommand = remotePath ? `cd ${shellEscapePosix(remotePath)} && exec \${SHELL:-bash} -l` : 'exec \${SHELL:-bash} -l'
  const sshArgs = buildSshCommandArgs(
    {
      host: target.host,
      connection: target.connection
    },
    ['-t', 'bash', '-lc', remoteCommand]
  )

  return `ssh ${sshArgs.map((value) => quoteForCmd(value)).join(' ')}`
}

function buildWindowsPowerShellCommand(target: WorkspaceTarget): string {
  if (target.kind === 'local') {
    return `Set-Location -LiteralPath ${quoteForPowerShell(getLocalBasePath(target))}`
  }

  const remotePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  const remoteCommand = remotePath ? `cd ${shellEscapePosix(remotePath)} && exec \${SHELL:-bash} -l` : 'exec \${SHELL:-bash} -l'
  const sshArgs = buildSshCommandArgs(
    {
      host: target.host,
      connection: target.connection
    },
    ['-t', 'bash', '-lc', remoteCommand]
  )

  return `& ssh ${sshArgs.map((value) => quoteForPowerShell(value)).join(' ')}`
}

function buildPosixTerminalCommand(target: WorkspaceTarget): string {
  if (target.kind === 'local') {
    return `cd ${shellEscapePosix(getLocalBasePath(target))} && exec \${SHELL:-bash} -l`
  }

  const remotePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  const remoteCommand = remotePath ? `cd ${shellEscapePosix(remotePath)} && exec \${SHELL:-bash} -l` : 'exec \${SHELL:-bash} -l'
  const sshArgs = buildSshCommandArgs(
    {
      host: target.host,
      connection: target.connection
    },
    ['-t', 'bash', '-lc', remoteCommand]
  )

  return `ssh ${sshArgs.map((value) => shellEscapePosix(value)).join(' ')}`
}
