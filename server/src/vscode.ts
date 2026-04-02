import { existsSync } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import { buildSshCommandArgs } from './ssh.js'
import type { WorkspaceTarget } from './types.js'
import { shellEscapePosix } from './util.js'

function getCodeCommandCandidates(): string[] {
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : null,
    'code.cmd',
    'code'
  ].filter((value): value is string => Boolean(value))

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return candidate === 'code' || candidate === 'code.cmd' || existsSync(candidate)
  })
}

function isCmdScript(command: string): boolean {
  return /\.cmd$/i.test(command)
}

function getCmdExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'cmd.exe')
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

function getSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === 'win32' && isCmdScript(command)) {
    const cmdPath = getCmdExecutable()
    return {
      command: cmdPath,
      args: ['/d', '/s', '/c', `"${command}"`, ...args]
    }
  }

  return { command, args }
}

function tryLaunch(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnSpec = getSpawnCommand(command, args)
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
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

  const missingBinary =
    lastError &&
    typeof lastError === 'object' &&
    'code' in lastError &&
    String((lastError as { code?: unknown }).code ?? '').toUpperCase() === 'ENOENT'

  if (missingBinary) {
    throw new Error('VSCode をインストールしてください。')
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(`VSCode を起動できませんでした: ${detail}`)
}

export async function openInCommandPrompt(target: WorkspaceTarget): Promise<void> {
  const cmdPath = getCmdExecutable()

  if (target.kind === 'local') {
    const basePath = target.resourceType === 'file' ? path.dirname(target.path) : target.path
    await tryLaunch(cmdPath, ['/k', `cd /d ${quoteForCmd(path.resolve(basePath))}`])
    return
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

  await tryLaunch(cmdPath, ['/k', `ssh ${sshArgs.map(quoteForCmd).join(' ')}`])
}
