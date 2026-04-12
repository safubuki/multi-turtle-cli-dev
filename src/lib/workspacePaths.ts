import type { HostPlatform, LocalBrowseRoot, LocalWorkspace } from '../types'

export interface WorkspacePickerPathState {
  mode: 'local' | 'ssh'
  path: string
}

export function getAbsoluteLocalParentPath(currentPath: string): string | null {
  const normalizedPath = currentPath.replace(/[\/]+$/, '').replace(/\//g, '\\')
  if (!normalizedPath) {
    return null
  }

  if (/^[A-Za-z]:\\?$/.test(normalizedPath) || normalizedPath === '\\') {
    return null
  }

  const segments = normalizedPath.split('\\')
  if (segments.length <= 1) {
    return null
  }

  segments.pop()
  let parent = segments.join('\\')
  if (/^[A-Za-z]:$/.test(parent)) {
    parent += '\\'
  }

  return parent || null
}

export function getAbsoluteRemoteParentPath(currentPath: string): string | null {
  const normalizedPath = currentPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedPath || normalizedPath === '/') {
    return null
  }

  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) {
    return '/'
  }

  segments.pop()
  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

export function getPathLabel(path: string): string {
  const trimmed = path.trim().replace(/[\/]+$/, '')
  const parts = trimmed.split(/[\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function resolveRemoteRootPath(rootPath: string, homeDirectory: string | null): string {
  const trimmed = rootPath.trim()
  if (!trimmed || trimmed === '.') {
    return homeDirectory || '~'
  }

  if (trimmed === '~') {
    return homeDirectory || '~'
  }

  if (trimmed.startsWith('~/') && homeDirectory) {
    return `${homeDirectory.replace(/\/+$/, '')}/${trimmed.slice(2)}`
  }

  return trimmed
}

export function buildRemoteWorkspacePickerRoots(remoteRoots: string[], homeDirectory: string | null): LocalBrowseRoot[] {
  const seen = new Set<string>()
  const roots = [homeDirectory || '~', ...remoteRoots]

  return roots
    .map((rootPath) => resolveRemoteRootPath(rootPath, homeDirectory))
    .filter((rootPath) => {
      if (!rootPath || seen.has(rootPath)) {
        return false
      }
      seen.add(rootPath)
      return true
    })
    .map((rootPath) => ({
      label: rootPath === homeDirectory || rootPath === '~' ? 'Home' : getPathLabel(rootPath),
      path: rootPath
    }))
}

export function isLocalWorkspacePickerRootVisible(root: LocalBrowseRoot): boolean {
  const hiddenNames = new Set(['desktop', 'documents', 'downloads', '\u30c7\u30b9\u30af\u30c8\u30c3\u30d7', '\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8', '\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9'])
  const label = root.label.trim().toLowerCase()
  const pathParts = normalizeComparablePath(root.path).toLowerCase().split('/').filter(Boolean)
  const lastPathPart = pathParts[pathParts.length - 1] ?? ''
  return !hiddenNames.has(label) && !hiddenNames.has(lastPathPart)
}

export function isWorkspacePickerRootActive(workspacePicker: WorkspacePickerPathState, rootPath: string): boolean {
  const normalizedCurrentPath = normalizeComparablePath(workspacePicker.path)
  const normalizedRootPath = normalizeComparablePath(rootPath)
  if (!normalizedCurrentPath || !normalizedRootPath) {
    return false
  }

  if (workspacePicker.mode === 'local') {
    return normalizedCurrentPath.toLowerCase().startsWith(normalizedRootPath.toLowerCase())
  }

  return normalizedCurrentPath === normalizedRootPath || normalizedCurrentPath.startsWith(`${normalizedRootPath}/`)
}

export function normalizeComparablePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}/`
  }

  return normalized
}

export function normalizeLinkedPathTarget(value: string): string {
  const trimmed = value.trim().replace(/^file:\/\/\/?/i, '')

  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

export function stripLinkedPathFragment(value: string): string {
  return value.replace(/#L\d+(?::\d+)?(?:-L?\d+(?::\d+)?)?$/i, '').replace(/#\d+(?::\d+)?$/i, '').replace(/(\.[A-Za-z0-9]{1,12}):\d+(?::\d+)?$/i, '$1')
}

export function isAbsoluteLocalPath(value: string): boolean {
  const normalized = value.replace(/\//g, '\\')
  return /^[A-Za-z]:\\/.test(normalized) || normalized.startsWith('\\\\')
}

export function resolvePathSegments(baseSegments: string[], targetSegments: string[], minDepth = 0): string[] {
  const resolved = [...baseSegments]

  for (const segment of targetSegments) {
    if (!segment || segment === '.') {
      continue
    }

    if (segment === '..') {
      if (resolved.length > minDepth) {
        resolved.pop()
      }
      continue
    }

    resolved.push(segment)
  }

  return resolved
}

export function resolveLinkedLocalPath(targetPath: string, workspaceRoot: string): string {
  const normalizedTarget = stripLinkedPathFragment(normalizeLinkedPathTarget(targetPath)).replace(/\//g, '\\')
  if (!normalizedTarget) {
    return ''
  }

  if (isAbsoluteLocalPath(normalizedTarget)) {
    return normalizedTarget
  }

  const normalizedWorkspaceRoot = workspaceRoot.trim().replace(/\//g, '\\')
  if (!normalizedWorkspaceRoot) {
    return normalizedTarget
  }

  const driveMatch = normalizedWorkspaceRoot.match(/^[A-Za-z]:/)
  if (normalizedTarget.startsWith('\\') && driveMatch) {
    return `${driveMatch[0]}${normalizedTarget}`
  }

  const baseSegments = normalizedWorkspaceRoot.split('\\').filter(Boolean)
  const targetSegments = normalizedTarget.split('\\').filter(Boolean)
  const resolvedSegments = resolvePathSegments(baseSegments, targetSegments, /^[A-Za-z]:$/.test(baseSegments[0] ?? '') ? 1 : 0)

  if (/^[A-Za-z]:$/.test(resolvedSegments[0] ?? '')) {
    return `${resolvedSegments[0]}\\${resolvedSegments.slice(1).join('\\')}`
  }

  return resolvedSegments.join('\\')
}

export function resolveLinkedRemotePath(targetPath: string, workspaceRoot: string): string {
  const normalizedTarget = stripLinkedPathFragment(normalizeLinkedPathTarget(targetPath)).replace(/\\/g, '/')
  if (!normalizedTarget) {
    return ''
  }

  if (normalizedTarget.startsWith('/')) {
    return normalizedTarget
  }

  const normalizedWorkspaceRoot = workspaceRoot.trim().replace(/\\/g, '/')
  if (!normalizedWorkspaceRoot) {
    return normalizedTarget
  }

  const baseSegments = normalizedWorkspaceRoot.split('/').filter(Boolean)
  const targetSegments = normalizedTarget.split('/').filter(Boolean)
  const resolvedSegments = resolvePathSegments(baseSegments, targetSegments)
  return `/${resolvedSegments.join('/')}`
}

export function clampLocalPathToWorkspace(targetPath: string, workspaceRoot: string): string {
  const normalizedTarget = normalizeComparablePath(targetPath)
  const normalizedRoot = normalizeComparablePath(workspaceRoot)

  if (!normalizedRoot) {
    return targetPath.trim()
  }

  if (!normalizedTarget) {
    return workspaceRoot.trim()
  }

  const targetLower = normalizedTarget.toLowerCase()
  const rootLower = normalizedRoot.toLowerCase()
  if (targetLower === rootLower || targetLower.startsWith(`${rootLower}/`)) {
    return targetPath.trim()
  }

  return workspaceRoot.trim()
}

export function isAppLocalWorkspacePath(targetPath: string, workspaces: LocalWorkspace[]): boolean {
  const normalizedTargetPath = normalizeComparablePath(targetPath).toLowerCase()
  if (!normalizedTargetPath) {
    return false
  }

  return workspaces.some((workspace) =>
    workspace.source === 'app' &&
    normalizeComparablePath(workspace.path).toLowerCase() === normalizedTargetPath
  )
}

export function getPreferredManualLocalWorkspace(workspaces: LocalWorkspace[]): LocalWorkspace | null {
  return workspaces.find((workspace) => workspace.source !== 'app') ?? null
}

export function isWindowsDriveRootPath(targetPath: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(targetPath.trim())
}

export function getDefaultLocalBrowsePath(roots: LocalBrowseRoot[], hostPlatform: HostPlatform | undefined): string {
  const visibleRoots = roots.filter(isLocalWorkspacePickerRootVisible)
  const driveRoot = visibleRoots.find((root) => isWindowsDriveRootPath(root.path))

  if (hostPlatform === 'windows' || (hostPlatform === undefined && driveRoot)) {
    return driveRoot?.path ?? visibleRoots[0]?.path ?? ''
  }

  return visibleRoots.find((root) => {
    const label = root.label.trim().toLowerCase()
    return label === 'home' || label === '\u30db\u30fc\u30e0'
  })?.path ?? visibleRoots[0]?.path ?? ''
}

export function chooseInitialLocalWorkspacePath(workspaces: LocalWorkspace[]): string {
  return getPreferredManualLocalWorkspace(workspaces)?.path ?? ''
}

export function chooseLocalWorkspacePickerStartPath(params: {
  pane: { localWorkspacePath: string } | undefined
  workspaces: LocalWorkspace[]
  roots: LocalBrowseRoot[]
  lastLocalBrowsePath: string | null
  hostPlatform: HostPlatform | undefined
}): string {
  const lastLocalBrowsePath = params.lastLocalBrowsePath?.trim()
  if (lastLocalBrowsePath) {
    return lastLocalBrowsePath
  }

  const paneWorkspacePath = params.pane?.localWorkspacePath.trim()
  if (paneWorkspacePath && !isAppLocalWorkspacePath(paneWorkspacePath, params.workspaces)) {
    return paneWorkspacePath
  }

  return getDefaultLocalBrowsePath(params.roots, params.hostPlatform)
}
