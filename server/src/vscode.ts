import { existsSync } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import type { WorkspaceTarget } from './types.js'

function getCodeCommand(): string {
  const candidates = [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
      : null,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
      : null,
    'code.cmd',
    'code'
  ].filter((value): value is string => Boolean(value))

  return candidates.find((candidate) => candidate === 'code' || candidate === 'code.cmd' || existsSync(candidate)) ?? 'code'
}

function buildRemoteFolderUri(host: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/')
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `vscode-remote://ssh-remote+${encodeURIComponent(host)}${encodeURI(pathname)}`
}

export function openInVsCode(target: WorkspaceTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = getCodeCommand()
    const args =
      target.kind === 'local'
        ? [target.path]
        : ['--folder-uri', buildRemoteFolderUri(target.host, target.path)]

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.on('error', reject)
    child.unref()
    resolve()
  })
}
