import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { LocalBrowseRoot, LocalDirectoryEntry, LocalWorkspace } from './types.js'
import { APP_ROOT, dedupeStrings, getPathName, toWorkspaceId } from './util.js'

const WORKSPACE_MARKERS = ['package.json', 'pnpm-workspace.yaml', 'turbo.json', '.git']

function getConfiguredWorkspacePaths(): string[] {
  return dedupeStrings([
    APP_ROOT,
    process.env.MULTI_TURTLE_WORKSPACES,
    process.env.MULTI_TURTLE_WORKSPACE_ROOTS
  ]).flatMap((entry) =>
    entry
      .split(/[;\n]/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function detectIndicators(targetPath: string): string[] {
  return WORKSPACE_MARKERS.filter((marker) => existsSync(path.join(targetPath, marker)))
}

function pushBrowseRoot(results: LocalBrowseRoot[], seen: Set<string>, label: string, targetPath: string): void {
  if (!targetPath || !existsSync(targetPath)) {
    return
  }

  const normalizedPath = path.resolve(targetPath)
  const key = normalizedPath.toLowerCase()
  if (seen.has(key)) {
    return
  }

  seen.add(key)
  results.push({
    label,
    path: normalizedPath
  })
}

export function listLocalBrowseRoots(): LocalBrowseRoot[] {
  const results: LocalBrowseRoot[] = []
  const seen = new Set<string>()
  const home = os.homedir()

  pushBrowseRoot(results, seen, '\u30db\u30fc\u30e0', home)

  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      pushBrowseRoot(results, seen, drive.slice(0, 2), drive)
    }
  } else {
    pushBrowseRoot(results, seen, '/', '/')
  }

  return results
}

export async function discoverLocalWorkspaces(): Promise<LocalWorkspace[]> {
  const seen = new Set<string>()
  const results: LocalWorkspace[] = []

  for (const targetPath of getConfiguredWorkspacePaths()) {
    if (!targetPath || seen.has(targetPath) || !existsSync(targetPath)) {
      continue
    }

    seen.add(targetPath)
    results.push({
      id: `workspace-${toWorkspaceId(targetPath)}`,
      label: getPathName(targetPath),
      path: targetPath,
      indicators: detectIndicators(targetPath),
      source: targetPath === APP_ROOT ? 'app' : 'manual'
    })
  }

  return results.sort((left, right) => {
    if (left.source === 'app' && right.source !== 'app') {
      return -1
    }
    if (left.source !== 'app' && right.source === 'app') {
      return 1
    }
    return left.label.localeCompare(right.label, 'ja')
  })
}

export async function browseLocalDirectory(targetPath: string): Promise<LocalDirectoryEntry[]> {
  const normalizedPath = path.resolve(targetPath)
  if (!existsSync(normalizedPath)) {
    throw new Error(`Local directory not found: ${normalizedPath}`)
  }

  const stats = await fs.stat(normalizedPath)
  if (!stats.isDirectory()) {
    throw new Error(`Local path is not a directory: ${normalizedPath}`)
  }

  const entries = await fs.readdir(normalizedPath, { withFileTypes: true })
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({
      label: entry.name,
      path: path.join(normalizedPath, entry.name),
      isDirectory: entry.isDirectory()
    }))
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1
      }
      return left.label.localeCompare(right.label, 'ja')
    })
    .slice(0, 80)
}

export async function createLocalDirectory(parentPath: string, directoryName: string): Promise<string> {
  const normalizedParentPath = path.resolve(parentPath)
  const normalizedDirectoryName = directoryName.trim()

  if (!normalizedDirectoryName) {
    throw new Error('Directory name is required')
  }

  if (normalizedDirectoryName === '.' || normalizedDirectoryName === '..' || /[\\/\r\n]/.test(normalizedDirectoryName)) {
    throw new Error('Directory name contains invalid characters')
  }

  if (!existsSync(normalizedParentPath)) {
    throw new Error(`Local directory not found: ${normalizedParentPath}`)
  }

  const parentStats = await fs.stat(normalizedParentPath)
  if (!parentStats.isDirectory()) {
    throw new Error(`Local path is not a directory: ${normalizedParentPath}`)
  }

  const createdPath = path.join(normalizedParentPath, normalizedDirectoryName)
  if (existsSync(createdPath)) {
    throw new Error(`Directory already exists: ${createdPath}`)
  }

  await fs.mkdir(createdPath)
  return createdPath
}
