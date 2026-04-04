import { existsSync } from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import { pathToFileURL } from 'url'
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
  return /\.cmd$/i.test(command)
}

function getCmdExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'cmd.exe')
}

function getPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function buildRemoteFolderUri(host: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/')
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `vscode-remote://ssh-remote+${encodeURIComponent(host)}${encodeURI(pathname)}`
}

function buildLocalFolderUri(localPath: string): string {
  return pathToFileURL(path.resolve(localPath)).toString()
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
    const cmdPath = getCmdExecutable()
    return {
      command: cmdPath,
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

function quoteForPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildPowerShellArrayLiteral(values: string[]): string {
  return `@(${values.map((value) => quoteForPowerShellLiteral(value)).join(', ')})`
}

function isMissingBinaryError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: unknown }).code ?? '').toUpperCase() === 'ENOENT'
  )
}

function buildTerminalSpecs(commandText: string): TerminalLaunchSpec[] {
  if (process.platform === 'win32') {
    return [
      {
        command: getCmdExecutable(),
        args: ['/k', commandText]
      }
    ]
  }

  if (process.platform === 'linux') {
    return [
      { command: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', commandText] },
      { command: 'gnome-terminal', args: ['--', 'bash', '-lc', commandText] },
      { command: 'kgx', args: ['--', 'bash', '-lc', commandText] },
      { command: 'konsole', args: ['-e', 'bash', '-lc', commandText] },
      { command: 'mate-terminal', args: ['--', 'bash', '-lc', commandText] },
      { command: 'xfce4-terminal', args: ['--command', `bash -lc ${shellEscapePosix(commandText)}`] },
      { command: 'xterm', args: ['-e', 'bash', '-lc', commandText] },
      { command: 'kitty', args: ['bash', '-lc', commandText] },
      { command: 'wezterm', args: ['start', 'bash', '-lc', commandText] }
    ]
  }

  return [{ command: 'open', args: ['-a', 'Terminal.app'] }]
}

function getLocalTerminalCwd(target: WorkspaceTarget): string | undefined {
  if (target.kind !== 'local') {
    return undefined
  }

  const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
  return path.resolve(basePath)
}

function tryLaunchViaPowerShellStartProcess(filePath: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptParts = [
      `$ErrorActionPreference = 'Stop'`,
      `$params = @{ FilePath = ${quoteForPowerShellLiteral(filePath)}; ArgumentList = ${buildPowerShellArrayLiteral(args)}; WindowStyle = 'Normal' }`
    ]

    if (cwd) {
      scriptParts.push(`$params.WorkingDirectory = ${quoteForPowerShellLiteral(cwd)}`)
    }

    scriptParts.push('Start-Process @params | Out-Null')

    execFile(
      getPowerShellExecutable(),
      ['-NoProfile', '-Command', scriptParts.join('; ')],
      {
        windowsHide: true,
        cwd
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }

        resolve()
      }
    )
  })
}

export async function openInVsCode(target: WorkspaceTarget): Promise<void> {
  const resourceType = target.resourceType ?? 'folder'
  const args =
    target.kind === 'local'
      ? resourceType === 'file'
        ? [path.resolve(target.path)]
        : ['--folder-uri', buildLocalFolderUri(target.path)]
      : resourceType === 'file'
        ? ['--file-uri', buildRemoteFileUri(target.host, target.path)]
        : ['--folder-uri', buildRemoteFolderUri(target.host, target.path)]

  let lastError: unknown = null

  for (const command of getCodeCommandCandidates()) {
    try {
      await tryLaunch(command, args)
      return
    } catch (error) {
      lastError = error
    }
  }

  if (isMissingBinaryError(lastError)) {
    throw new Error('VSCode \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(`VSCode \u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ${detail}`)
}

export async function openInCommandPrompt(target: WorkspaceTarget): Promise<void> {
  if (process.platform === 'win32') {
    await openInWindowsCommandPrompt(target)
    return
  }

  const commandText = buildPosixTerminalCommand(target)
  let lastError: unknown = null

  for (const spec of buildTerminalSpecs(commandText)) {
    try {
      await tryLaunch(spec.command, spec.args, {
        cwd: spec.cwd,
        windowsHide: false
      })
      return
    } catch (error) {
      lastError = error
    }
  }

  if (isMissingBinaryError(lastError)) {
    throw new Error('\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3002 Ubuntu \u3067\u306f gnome-terminal \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(`\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ${detail}`)
}

async function openInWindowsCommandPrompt(target: WorkspaceTarget): Promise<void> {
  const commandText = buildWindowsTerminalCommand(target)
  const cwd = getLocalTerminalCwd(target)
  const cmdExecutable = getCmdExecutable()
  const startCommand = `start "" ${buildCmdCommandText(cmdExecutable, ['/k', commandText])}`
  let lastError: unknown = null

  const launchers: Array<() => Promise<void>> = [
    () => tryLaunchViaPowerShellStartProcess(cmdExecutable, ['/k', commandText], cwd),
    () =>
      tryLaunch(cmdExecutable, ['/d', '/s', '/c', startCommand], {
        cwd,
        windowsHide: false
      }),
    () =>
      tryLaunch(cmdExecutable, ['/k', commandText], {
        cwd,
        windowsHide: false
      })
  ]

  for (const launch of launchers) {
    try {
      await launch()
      return
    } catch (error) {
      lastError = error
    }
  }

  if (isMissingBinaryError(lastError)) {
    throw new Error('\u30b3\u30de\u30f3\u30c9\u30d7\u30ed\u30f3\u30d7\u30c8\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3002')
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(`\u30b3\u30de\u30f3\u30c9\u30d7\u30ed\u30f3\u30d7\u30c8\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ${detail}`)
}

function buildWindowsTerminalCommand(target: WorkspaceTarget): string {
  if (target.kind === 'local') {
    const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
    return `cd /d ${quoteForCmd(path.resolve(basePath))}`
  }

  const remotePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  const remoteCommand = remotePath
    ? `cd ${shellEscapePosix(remotePath)} && exec \${SHELL:-bash} -l`
    : 'exec \${SHELL:-bash} -l'
  const sshArgs = buildSshCommandArgs(
    {
      host: target.host,
      connection: target.connection
    },
    ['-t', 'bash', '-lc', remoteCommand]
  )

  return `ssh ${sshArgs.map(quoteForCmd).join(' ')}`
}

function buildPosixTerminalCommand(target: WorkspaceTarget): string {
  if (target.kind === 'local') {
    const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
    return `cd ${shellEscapePosix(path.resolve(basePath))} && exec \${SHELL:-bash} -l`
  }

  const remotePath = target.resourceType === 'file' ? path.posix.dirname(target.path) : target.path
  const remoteCommand = remotePath
    ? `cd ${shellEscapePosix(remotePath)} && exec \${SHELL:-bash} -l`
    : 'exec \${SHELL:-bash} -l'
  const sshArgs = buildSshCommandArgs(
    {
      host: target.host,
      connection: target.connection
    },
    ['-t', 'bash', '-lc', remoteCommand]
  )

  return `ssh ${sshArgs.map((value) => shellEscapePosix(value)).join(' ')}`
}
