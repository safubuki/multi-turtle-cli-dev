import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import {
  Activity,
  Bot,
  CheckCircle2,
  Grid2x2,
  LayoutPanelTop,
  Plus,
  SplitSquareHorizontal,
  Trash2,
  Wifi,
  XCircle
} from 'lucide-react'
import { TerminalPane } from './components/TerminalPane'
import {
  browseRemoteDirectory,
  browseLocalDirectory,
  createLocalDirectory,
  createRemoteDirectory,
  deleteSshKey,
  fetchBootstrap,
  fetchLocalBrowseRoots,
  fetchRemoteWorkspaces,
  generateSshKey,
  inspectSshHost,
  installSshKey,
  openTargetInFileManager,
  openTargetInCommandPrompt,
  openWorkspaceInVsCode,
  pickLocalWorkspace,
  pickSaveFilePath,
  removeKnownHost,
  runPaneStream,
  runShellStream,
  stagePromptImage,
  stopPaneRun,
  unstagePromptImages,
  stopShellRun,
  transferSshPath,
} from './lib/api'
import type {
  BootstrapPayload,
  LocalSshKey,
  LocalBrowseRoot,
  LocalDirectoryEntry,
  LocalWorkspace,
  PaneLogEntry,
  PaneSessionRecord,
  PaneState,
  PaneStatus,
  PromptImageAttachment,
  PromptImageAttachmentSource,
  ProviderCatalogResponse,
  ProviderId,
  ReasoningEffort,
  RemoteDirectoryEntry,
  RunImageAttachment,
  RunStreamEvent,
  ShellRunEvent,
  SharedContextItem,
  SshConnectionOptions,
  SshHost,
  WorkspaceTarget
} from './types'

type LayoutMode = 'quad' | 'triple' | 'focus'

interface WorkspacePickerState {
  mode: 'local' | 'ssh'
  paneId: string
  path: string
  entries: Array<{
    label: string
    path: string
    isWorkspace?: boolean
  }>
  roots: LocalBrowseRoot[]
  loading: boolean
  error: string | null
}

const PROVIDER_ORDER: ProviderId[] = ['codex', 'copilot', 'gemini']
const EMPTY_CATALOGS = {} as Record<ProviderId, ProviderCatalogResponse>
const STORAGE_KEYS = {
  panes: 'multi-turtle-cli-dev/panes-v2',
  sharedContext: 'multi-turtle-cli-dev/shared-context-v2',
  layout: 'multi-turtle-cli-dev/layout-v2',
  localWorkspaces: 'multi-turtle-cli-dev/local-workspaces-v2',
  focusedPane: 'multi-turtle-cli-dev/focused-pane-v2'
} as const
const MAX_LOGS = 24
const MAX_STREAM_ENTRIES = 80
const MAX_SESSION_HISTORY = 18
const MAX_SESSION_LABEL_LENGTH = 40
const MAX_LIVE_OUTPUT = 64_000
const MAX_SHELL_OUTPUT = 48_000
const MAX_SHARED_CONTEXT = 16
const STALL_MS = 120_000
const BOOTSTRAP_RETRY_DELAY_MS = 500
const BOOTSTRAP_MAX_ATTEMPTS = 12
const TITLE_IMAGE_URL = new URL('../assets/title.png', import.meta.url).href

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
      return '.bmp'
    case 'image/svg+xml':
      return '.svg'
    case 'image/avif':
      return '.avif'
    default:
      return '.img'
  }
}

function inferImageMimeType(fileName: string): string | null {
  const normalized = fileName.trim().toLowerCase()
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }
  if (normalized.endsWith('.gif')) {
    return 'image/gif'
  }
  if (normalized.endsWith('.bmp')) {
    return 'image/bmp'
  }
  if (normalized.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  if (normalized.endsWith('.avif')) {
    return 'image/avif'
  }
  return null
}

function normalizePromptImageFile(file: File, source: PromptImageAttachmentSource): { file: File; fileName: string; mimeType: string } | null {
  const detectedMimeType = file.type.trim() || inferImageMimeType(file.name)
  if (!detectedMimeType || !detectedMimeType.startsWith('image/')) {
    return null
  }

  const normalizedFileName = file.name.trim() || `${source}-image-${Date.now()}${extensionFromMimeType(detectedMimeType)}`
  return {
    file,
    fileName: normalizedFileName,
    mimeType: detectedMimeType
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('画像ファイルの読み込みに失敗しました。'))
        return
      }

      const [, contentBase64 = ''] = reader.result.split(',', 2)
      if (!contentBase64) {
        reject(new Error('画像データを base64 に変換できませんでした。'))
        return
      }

      resolve(contentBase64)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('画像ファイルの読み込みに失敗しました。'))
    }
    reader.readAsDataURL(file)
  })
}

function buildPromptWithImageSummary(prompt: string, imageAttachments: Pick<RunImageAttachment, 'fileName'>[]): string {
  if (imageAttachments.length === 0) {
    return prompt
  }

  const normalizedPrompt = prompt.trim()
  return [
    '[添付画像]',
    ...imageAttachments.map((attachment, index) => `${index + 1}. ${attachment.fileName}`),
    ...(normalizedPrompt ? ['', normalizedPrompt] : [])
  ].join('\n')
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}\n\n[truncated]`
}

function reorderPanesById(panes: PaneState[], sourcePaneId: string, targetPaneId: string): PaneState[] {
  if (sourcePaneId === targetPaneId) {
    return panes
  }

  const sourceIndex = panes.findIndex((pane) => pane.id === sourcePaneId)
  const targetIndex = panes.findIndex((pane) => pane.id === targetPaneId)
  if (sourceIndex < 0 || targetIndex < 0) {
    return panes
  }

  const next = [...panes]
  const [movedPane] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, movedPane)
  return next
}

function getDocumentRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect()
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height
  )
}

function animateReorder(element: HTMLElement, previousRect: DOMRect, nextRect: DOMRect): void {
  const deltaX = previousRect.left - nextRect.left
  const deltaY = previousRect.top - nextRect.top
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
    return
  }

  element.animate(
    [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: 'translate(0, 0)' }
    ],
    {
      duration: 220,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    }
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isLocalDevEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
}

function isRetryableBootstrapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Request failed: 502|Request failed: 503|Request failed: 504|ECONNREFUSED|fetch failed|Failed to fetch/i.test(message)
}

async function fetchBootstrapWithRetry(): Promise<BootstrapPayload> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchBootstrap()
    } catch (error) {
      lastError = error
      if (!isRetryableBootstrapError(error) || attempt === BOOTSTRAP_MAX_ATTEMPTS) {
        throw error
      }

      await delay(BOOTSTRAP_RETRY_DELAY_MS)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
}

function appendLiveOutputChunk(existing: string, incoming: string): string {
  const normalized = sanitizeTerminalText(incoming)
  if (!normalized) {
    return existing
  }

  return clipText(`${existing}${normalized}`, MAX_LIVE_OUTPUT)
}

function appendShellOutputLine(existing: string, incoming: string): string {
  const normalized = sanitizeTerminalText(incoming).replace(/\r/g, '').replace(/\n$/, '')

  if (!existing) {
    return normalized
  }

  if (!normalized.length) {
    return clipText(`${existing}\n`, MAX_SHELL_OUTPUT)
  }

  return clipText(`${existing}\n${normalized}`, MAX_SHELL_OUTPUT)
}

function buildShellPromptLabel(pane: PaneState, cwd?: string | null): string {
  const currentPath =
    pane.workspaceMode === 'local'
      ? (cwd?.trim() || pane.localShellPath.trim() || pane.localWorkspacePath.trim() || '~')
      : (cwd?.trim() || pane.remoteShellPath.trim() || pane.remoteWorkspacePath.trim() || '~')

  if (pane.workspaceMode === 'local') {
    return `${currentPath}>`
  }

  const sshLabel = pane.sshUser.trim() ? `${pane.sshUser.trim()}@${pane.sshHost.trim()}` : pane.sshHost.trim() || 'ssh'
  return `${sshLabel}:${currentPath}$`
}


function appendLiveOutputLine(existing: string, incoming: string): string {
  const normalized = sanitizeTerminalText(incoming).trim()
  if (!normalized) {
    return existing
  }

  return clipText(existing.trim() ? `${existing.trimEnd()}\n${normalized}` : normalized, MAX_LIVE_OUTPUT)
}

function summarize(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 110) {
    return normalized
  }

  return `${normalized.slice(0, 110).trim()}...`
}

function getAbsoluteLocalParentPath(currentPath: string): string | null {
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

function getAbsoluteRemoteParentPath(currentPath: string): string | null {
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

function getPathLabel(path: string): string {
  const trimmed = path.trim().replace(/[\/]+$/, '')
  const parts = trimmed.split(/[\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function resolveRemoteRootPath(rootPath: string, homeDirectory: string | null): string {
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

function buildRemoteWorkspacePickerRoots(remoteRoots: string[], homeDirectory: string | null): LocalBrowseRoot[] {
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

function isWorkspacePickerRootActive(workspacePicker: WorkspacePickerState, rootPath: string): boolean {
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

function normalizeComparablePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}/`
  }

  return normalized
}

function normalizeLinkedPathTarget(value: string): string {
  const trimmed = value.trim().replace(/^file:\/\/\/?/i, '')

  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function stripLinkedPathFragment(value: string): string {
  return value.replace(/#L\d+(?::\d+)?(?:-L?\d+(?::\d+)?)?$/i, '').replace(/#\d+(?::\d+)?$/i, '')
}

function isAbsoluteLocalPath(value: string): boolean {
  const normalized = value.replace(/\//g, '\\')
  return /^[A-Za-z]:\\/.test(normalized) || normalized.startsWith('\\\\')
}

function resolvePathSegments(baseSegments: string[], targetSegments: string[], minDepth = 0): string[] {
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

function resolveLinkedLocalPath(targetPath: string, workspaceRoot: string): string {
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

function resolveLinkedRemotePath(targetPath: string, workspaceRoot: string): string {
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

function acquireBodyScrollLock(): () => void {
  if (typeof document === 'undefined') {
    return () => undefined
  }

  const body = document.body
  const root = document.documentElement
  const countAttr = 'data-modal-lock-count'
  const prevBodyOverflowAttr = 'data-prev-body-overflow'
  const prevRootOverflowAttr = 'data-prev-root-overflow'
  const currentCount = Number(body.getAttribute(countAttr) ?? '0')

  if (currentCount === 0) {
    body.setAttribute(prevBodyOverflowAttr, body.style.overflow)
    root.setAttribute(prevRootOverflowAttr, root.style.overflow)
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
  }

  body.setAttribute(countAttr, String(currentCount + 1))

  return () => {
    const nextCount = Number(body.getAttribute(countAttr) ?? '1') - 1
    if (nextCount <= 0) {
      body.style.overflow = body.getAttribute(prevBodyOverflowAttr) ?? ''
      root.style.overflow = root.getAttribute(prevRootOverflowAttr) ?? ''
      body.removeAttribute(countAttr)
      body.removeAttribute(prevBodyOverflowAttr)
      root.removeAttribute(prevRootOverflowAttr)
      return
    }

    body.setAttribute(countAttr, String(nextCount))
  }
}

function clampLocalPathToWorkspace(targetPath: string, workspaceRoot: string): string {
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

function statusLabel(status: PaneStatus): string {
  switch (status) {
    case 'running':
      return '\u5b9f\u884c\u4e2d'
    case 'updating':
      return 'AI\u66f4\u65b0\u4e2d'
    case 'completed':
      return '\u5b8c\u4e86'
    case 'attention':
      return '\u5165\u529b / \u78ba\u8a8d\u5f85\u3061'
    case 'error':
      return '\u30a8\u30e9\u30fc'
    default:
      return '\u5f85\u6a5f\u4e2d'
  }
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'codex' || value === 'copilot' || value === 'gemini'
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

function normalizeLocalWorkspace(rawWorkspace: Partial<LocalWorkspace> | null | undefined): LocalWorkspace | null {
  if (!rawWorkspace?.path || !rawWorkspace.label) {
    return null
  }

  return {
    id: rawWorkspace.id ?? `local-${rawWorkspace.path.toLowerCase()}`,
    label: rawWorkspace.label,
    path: rawWorkspace.path,
    indicators: Array.isArray(rawWorkspace.indicators)
      ? rawWorkspace.indicators.filter((item): item is string => typeof item === 'string')
      : [],
    source: rawWorkspace.source === 'app' ? 'app' : 'manual'
  }
}

function buildLocalWorkspaceRecord(path: string): LocalWorkspace {
  const label = path.split(/[\\/]/).filter(Boolean).pop() ?? path

  return {
    id: `local-${path.toLowerCase()}`,
    label,
    path,
    indicators: [],
    source: 'manual'
  }
}

function getManualWorkspaces(workspaces: LocalWorkspace[]): LocalWorkspace[] {
  return workspaces.filter((workspace) => workspace.source === 'manual')
}

function mergeLocalWorkspaces(...groups: Array<Array<Partial<LocalWorkspace>> | LocalWorkspace[]>): LocalWorkspace[] {
  const seen = new Map<string, LocalWorkspace>()

  for (const group of groups) {
    for (const candidate of group) {
      const workspace = normalizeLocalWorkspace(candidate)
      if (!workspace) {
        continue
      }

      const key = workspace.path.toLowerCase()
      const current = seen.get(key)
      if (!current || (workspace.source === 'app' && current.source !== 'app')) {
        seen.set(key, workspace)
      }
    }
  }

  return [...seen.values()].sort((left, right) => {
    if (left.source === 'app' && right.source !== 'app') {
      return -1
    }
    if (left.source !== 'app' && right.source === 'app') {
      return 1
    }
    return left.label.localeCompare(right.label, 'ja')
  })
}

function appendLogEntry(entries: PaneLogEntry[], entry: PaneLogEntry): PaneLogEntry[] {
  return [...entries, { ...entry, text: clipText(entry.text, 32_000) }].slice(-MAX_LOGS)
}

function appendStreamEntry(
  entries: PaneState['streamEntries'],
  kind: PaneState['streamEntries'][number]['kind'],
  text: string,
  createdAt: number
): PaneState['streamEntries'] {
  const normalized = text.trim()
  if (!normalized) {
    return entries
  }

  const clipped = clipText(normalized, 2_000)
  const lastEntry = entries.at(-1)
  if (
    lastEntry &&
    lastEntry.kind === kind &&
    createdAt - lastEntry.createdAt < 1_500 &&
    lastEntry.text.length + clipped.length < 1_800
  ) {
    return [
      ...entries.slice(0, -1),
      {
        ...lastEntry,
        text: `${lastEntry.text}\n${clipped}`,
        createdAt
      }
    ]
  }

  return [...entries, { id: createId('stream'), kind, text: clipped, createdAt }].slice(-MAX_STREAM_ENTRIES)
}

function hasSessionContent(pane: Pick<PaneState, 'logs' | 'streamEntries' | 'sessionId' | 'liveOutput' | 'lastResponse'>): boolean {
  return (
    pane.logs.length > 0 ||
    pane.streamEntries.length > 0 ||
    Boolean(pane.sessionId) ||
    Boolean(pane.liveOutput.trim()) ||
    Boolean(pane.lastResponse?.trim())
  )
}

function clipSessionLabelText(text: string): string {
  if (text.length <= MAX_SESSION_LABEL_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_SESSION_LABEL_LENGTH - 1).trimEnd()}...`
}

function getSessionTopicCandidate(logs: PaneLogEntry[]): string | null {
  const firstUserEntry = logs.find((entry) => entry.role === 'user' && entry.text.trim())
  if (!firstUserEntry) {
    return null
  }

  const normalizedLines = firstUserEntry.text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let imageCount = 0
  let insideImageBlock = false
  const contentLines: string[] = []

  for (const line of normalizedLines) {
    if (line === '[\u6dfb\u4ed8\u753b\u50cf]') {
      insideImageBlock = true
      continue
    }

    if (insideImageBlock && /^-\s+/.test(line)) {
      imageCount += 1
      continue
    }

    insideImageBlock = false
    if (imageCount > 0 && line === '\u6dfb\u4ed8\u753b\u50cf\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002') {
      continue
    }

    contentLines.push(line)
  }

  const normalizedText = contentLines.join(' ').replace(/\s+/g, ' ').trim()
  if (normalizedText) {
    return clipSessionLabelText(normalizedText)
  }

  if (imageCount > 0) {
    return imageCount === 1
      ? '\u753b\u50cf\u306b\u3064\u3044\u3066\u306e\u4f1a\u8a71'
      : `\u753b\u50cf ${imageCount} \u679a\u306b\u3064\u3044\u3066\u306e\u4f1a\u8a71`
  }

  return null
}

function buildSessionLabel(sessionId: string | null, createdAt: number, logs: PaneLogEntry[]): string {
  const topicCandidate = getSessionTopicCandidate(logs)
  if (topicCandidate) {
    return topicCandidate
  }

  if (sessionId) {
    return `\u30bb\u30c3\u30b7\u30e7\u30f3 ${sessionId.slice(0, 8)}`
  }

  return `\u30bb\u30c3\u30b7\u30e7\u30f3 ${new Date(createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
}

function createArchivedSessionRecord(pane: PaneState): PaneSessionRecord {
  const createdAt = pane.lastRunAt ?? pane.lastActivityAt ?? pane.lastFinishedAt ?? Date.now()
  const updatedAt = pane.lastActivityAt ?? pane.lastFinishedAt ?? createdAt
  const logs = pane.logs.slice(-MAX_LOGS)

  return {
    key: createId('session'),
    label: buildSessionLabel(pane.sessionId, createdAt, logs),
    sessionId: pane.sessionId,
    createdAt,
    updatedAt,
    status: pane.status,
    logs,
    streamEntries: pane.streamEntries.slice(-MAX_STREAM_ENTRIES)
  }
}

function appendSessionRecord(history: PaneSessionRecord[], record: PaneSessionRecord): PaneSessionRecord[] {
  return [record, ...history].slice(0, MAX_SESSION_HISTORY)
}

function extractGeminiQuotaResetWindow(message: string): string | null {
  const match = message.match(/quota will reset after\s+([^.!\n]+)/i)
  return match?.[1]?.trim() || null
}

function getProviderIssueSummary(provider: ProviderId, message: string): { displayMessage: string; status: PaneStatus; statusText: string } | null {
  if (
    provider === 'gemini' &&
    /exhausted your capacity on this model|quota will reset after|resource_exhausted|too many requests/i.test(message)
  ) {
    const resetWindow = extractGeminiQuotaResetWindow(message)
    return {
      displayMessage: resetWindow
        ? `Gemini の利用上限に達しました。${resetWindow} 後に再実行するか、別モデルや別 CLI に切り替えてください。`
        : 'Gemini の利用上限に達しました。少し待って再実行するか、別モデルや別 CLI に切り替えてください。',
      status: 'attention',
      statusText: 'Gemini の利用上限に達しました'
    }
  }

  if (
    provider === 'gemini' &&
    /tool execution denied by policy|you are in plan mode and cannot modify source code|may only use write_file or replace to save plans/i.test(message)
  ) {
    return {
      displayMessage: 'Gemini CLI が Plan Mode に入り、ソースコード変更が拒否されました。現状の設定では調査計画までは進めても、実ファイル編集に移れないことがあります。編集を確実に進めるなら Codex CLI を使うか、Gemini 側で Plan Mode に落ちない実行設定が必要です。',
      status: 'attention',
      statusText: 'Gemini が Plan Mode で停止しました'
    }
  }

  if (provider === 'codex' && /rejected:\s*blocked by policy|blocked by policy/i.test(message)) {
    return {
      displayMessage: 'Codex が生成したツール実行が安全ポリシーにより拒否されました。TAKO 自体の故障ではなく、CLI 側が PowerShell / シェル操作を危険と判断したケースです。処理を小さく分けるか、プロセス停止や起動を伴う大きなコマンドを避けると通りやすくなります。',
      status: 'attention',
      statusText: 'Codex のツール実行がポリシーで拒否されました'
    }
  }

  return null
}

function normalizeSshHostKey(host: string): string {
  return host.trim().toLowerCase()
}

function mergeLocalSshKeys(...collections: LocalSshKey[][]): LocalSshKey[] {
  const merged = new Map<string, LocalSshKey>()

  for (const keys of collections) {
    for (const key of keys) {
      if (!key.privateKeyPath) {
        continue
      }

      merged.set(key.privateKeyPath, key)
    }
  }

  return [...merged.values()]
}

function getPaneRecentActivity(pane: PaneState): number {
  return Math.max(
    pane.lastActivityAt ?? 0,
    pane.lastFinishedAt ?? 0,
    pane.lastRunAt ?? 0,
    pane.shellLastRunAt ?? 0
  )
}

function findReusableSshPane(paneId: string, host: string, panes: PaneState[]): PaneState | null {
  const normalizedHost = normalizeSshHostKey(host)
  if (!normalizedHost) {
    return null
  }

  const candidates = panes
    .filter((pane) => pane.id !== paneId && normalizeSshHostKey(pane.sshHost) === normalizedHost)
    .sort((left, right) => {
      const leftScore = (left.sshSelectedKeyPath.trim() ? 4 : 0) + (left.sshIdentityFile.trim() ? 2 : 0) + (left.sshLocalKeys.length > 0 ? 1 : 0)
      const rightScore = (right.sshSelectedKeyPath.trim() ? 4 : 0) + (right.sshIdentityFile.trim() ? 2 : 0) + (right.sshLocalKeys.length > 0 ? 1 : 0)
      if (leftScore !== rightScore) {
        return rightScore - leftScore
      }

      return getPaneRecentActivity(right) - getPaneRecentActivity(left)
    })

  return candidates[0] ?? null
}

function getPreferredLocalSshKey(pane: PaneState, localKeys: LocalSshKey[], panes: PaneState[]): LocalSshKey | null {
  if (localKeys.length === 0) {
    return null
  }

  const keyByPath = new Map(localKeys.map((key) => [key.privateKeyPath, key] as const))
  const currentSelectedPath = pane.sshSelectedKeyPath.trim()
  if (currentSelectedPath && keyByPath.has(currentSelectedPath)) {
    return keyByPath.get(currentSelectedPath) ?? null
  }

  const currentIdentityPath = pane.sshIdentityFile.trim()
  if (currentIdentityPath && keyByPath.has(currentIdentityPath)) {
    return keyByPath.get(currentIdentityPath) ?? null
  }

  const reusablePane = findReusableSshPane(pane.id, pane.sshHost, panes)
  const reusableSelectedPath = reusablePane?.sshSelectedKeyPath.trim() ?? ''
  if (reusableSelectedPath && keyByPath.has(reusableSelectedPath)) {
    return keyByPath.get(reusableSelectedPath) ?? null
  }

  const reusableIdentityPath = reusablePane?.sshIdentityFile.trim() ?? ''
  if (reusableIdentityPath && keyByPath.has(reusableIdentityPath)) {
    return keyByPath.get(reusableIdentityPath) ?? null
  }

  return localKeys[0] ?? null
}

function buildSshConnectionFromPane(pane: PaneState, sshHosts: SshHost[] = [], panes: PaneState[] = []): SshConnectionOptions {
  const matchedHost = sshHosts.find((item) => item.alias === pane.sshHost.trim())
  const reusablePane = findReusableSshPane(pane.id, pane.sshHost, panes)
  const localKeys = mergeLocalSshKeys(pane.sshLocalKeys, reusablePane?.sshLocalKeys ?? [])
  const preferredKey = getPreferredLocalSshKey({ ...pane, sshLocalKeys: localKeys }, localKeys, panes)
  const selectedLocalKeyPath = localKeys.some((item) => item.privateKeyPath === pane.sshSelectedKeyPath.trim())
    ? pane.sshSelectedKeyPath.trim()
    : ''

  return {
    username: pane.sshUser.trim() || matchedHost?.user || undefined,
    port: pane.sshPort.trim() || matchedHost?.port || undefined,
    password: pane.sshPassword.trim() || undefined,
    identityFile: selectedLocalKeyPath || pane.sshIdentityFile.trim() || preferredKey?.privateKeyPath || reusablePane?.sshIdentityFile.trim() || matchedHost?.identityFile || undefined,
    proxyJump: matchedHost?.proxyJump || undefined,
    proxyCommand: matchedHost?.proxyCommand || undefined,
    extraArgs: undefined
  }
}

function buildSshLabel(host: string, remotePath: string, connection?: SshConnectionOptions): string {
  const userPrefix = connection?.username?.trim() ? `${connection.username.trim()}@` : ''
  return `${userPrefix}${host}:${remotePath}`
}

function buildTargetFromPane(pane: PaneState, localWorkspaces: LocalWorkspace[], sshHosts: SshHost[] = [], panes: PaneState[] = []): WorkspaceTarget | null {
  if (pane.workspaceMode === 'local') {
    if (!pane.localWorkspacePath.trim()) {
      return null
    }

    const workspace = localWorkspaces.find((item) => item.path === pane.localWorkspacePath)
    return {
      kind: 'local',
      path: pane.localWorkspacePath,
      label: workspace?.label ?? pane.localWorkspacePath,
      resourceType: 'folder',
      workspacePath: pane.localWorkspacePath
    }
  }

  if (!pane.sshHost.trim() || !pane.remoteWorkspacePath.trim()) {
    return null
  }

  const connection = buildSshConnectionFromPane(pane, sshHosts, panes)

  return {
    kind: 'ssh',
    host: pane.sshHost.trim(),
    path: pane.remoteWorkspacePath.trim(),
    label: buildSshLabel(pane.sshHost.trim(), pane.remoteWorkspacePath.trim(), connection),
    resourceType: 'folder',
    workspacePath: pane.remoteWorkspacePath.trim(),
    connection
  }
}

function buildPaneSessionScopeKey(pane: Pick<PaneState, 'provider' | 'model' | 'workspaceMode' | 'localWorkspacePath' | 'sshHost' | 'sshUser' | 'sshPort' | 'remoteWorkspacePath'>): string {
  if (pane.workspaceMode === 'local') {
    return ['local', pane.provider, pane.model, pane.localWorkspacePath.trim()].join('::')
  }

  return ['ssh', pane.provider, pane.model, pane.sshUser.trim(), pane.sshHost.trim(), pane.sshPort.trim(), pane.remoteWorkspacePath.trim()].join('::')
}

function createInitialPane(index: number, payload: BootstrapPayload, localWorkspaces: LocalWorkspace[]): PaneState {
  const provider = PROVIDER_ORDER[index % PROVIDER_ORDER.length]
  const providerCatalog = payload.providers[provider]
  const firstWorkspace = localWorkspaces[0]
  const model = providerCatalog.models[0]?.id ?? ''
  const defaultReasoning = providerCatalog.models[0]?.defaultReasoningEffort ?? 'medium'

  return {
    id: createId('pane'),
    title: `Task ${index + 1}`,
    settingsOpen: false,
    workspaceOpen: false,
    shellOpen: false,
    provider,
    model,
    reasoningEffort: defaultReasoning,
    autonomyMode: 'balanced',
    codexFastMode: 'off',
    status: 'idle',
    statusText: statusLabel('idle'),
    runInProgress: false,
    shellCommand: '',
    shellOutput: '',
    shellHistory: [],
    shellHistoryIndex: null,
    localShellPath: firstWorkspace?.path ?? '',
    remoteShellPath: '',
    shellRunning: false,
    shellLastExitCode: null,
    shellLastError: null,
    shellLastRunAt: null,
    workspaceMode: 'local',
    localWorkspacePath: firstWorkspace?.path ?? '',
    localBrowserPath: '',
    localBrowserEntries: [],
    localBrowserLoading: false,
    sshHost: '',
    sshUser: '',
    sshPort: '',
    sshPassword: '',
    sshIdentityFile: '',
    sshProxyJump: '',
    sshProxyCommand: '',
    sshExtraArgs: '',
    sshLocalKeys: [],
    sshSelectedKeyPath: '',
    sshPublicKeyText: '',
    sshKeyName: 'id_ed25519',
    sshKeyComment: 'tako-cli-dev-tool',
    sshDiagnostics: [],
    sshActionState: 'idle',
    sshActionMessage: null,
    sshPasswordPulseAt: 0,
    sshLocalPath: firstWorkspace?.path ?? '',
    sshRemotePath: '',
    remoteWorkspacePath: '',
    remoteWorkspaces: [],
    remoteAvailableProviders: [],
    remoteHomeDirectory: null,
    remoteBrowserPath: '',
    remoteBrowserEntries: [],
    remoteParentPath: null,
    remoteNewDirectoryName: '',
    remoteBrowserLoading: false,
    prompt: '',
    logs: [],
    streamEntries: [],
    sessionHistory: [],
    selectedSessionKey: null,
    liveOutput: '',
    attachedContextIds: [],
    sessionId: null,
    sessionScopeKey: null,
    autoShare: false,
    autoShareTargetIds: [],
    pendingShareGlobal: false,
    pendingShareTargetIds: [],
    currentRequestText: null,
    currentRequestAt: null,
    stopRequested: false,
    stopRequestAvailable: false,
    lastRunAt: null,
    runningSince: null,
    lastActivityAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResponse: null
  }
}

function createSharedContextItem(
  pane: PaneState,
  target: WorkspaceTarget | null,
  response: string,
  options: {
    scope: SharedContextItem['scope']
    targetPaneIds?: string[]
    targetPaneTitles?: string[]
    contentLabel: string
  }
): SharedContextItem {
  return {
    id: createId('context'),
    sourcePaneId: pane.id,
    sourcePaneTitle: pane.title,
    provider: pane.provider,
    scope: options.scope,
    targetPaneIds: options.targetPaneIds ?? [],
    targetPaneTitles: options.targetPaneTitles ?? [],
    contentLabel: options.contentLabel,
    workspaceLabel: target?.label ?? '\u672a\u9078\u629e',
    summary: summarize(response),
    detail: clipText(response, 16_000),
    consumedByPaneIds: [],
    createdAt: Date.now()
  }
}

function getLatestAssistantText(pane: PaneState): string | null {
  if (pane.lastResponse?.trim()) {
    return pane.lastResponse
  }

  const latestAssistant = [...pane.logs].reverse().find((entry) => entry.role === 'assistant')
  return latestAssistant?.text ?? null
}

function getPaneOutputText(pane: Pick<PaneState, 'liveOutput' | 'lastResponse'>): string | null {
  if (pane.liveOutput.trim()) {
    return pane.liveOutput
  }

  if (pane.lastResponse?.trim()) {
    return pane.lastResponse
  }

  return null
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fallback for environments where the async clipboard API is blocked.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API is unavailable')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('Copy command failed')
  }
}

function getShareablePayload(pane: PaneState): { text: string | null; contentLabel: string } {
  if (pane.selectedSessionKey) {
    const selectedSession = pane.sessionHistory.find((session) => session.key === pane.selectedSessionKey)
    if (selectedSession) {
      const latestAssistant = [...selectedSession.logs].reverse().find((entry) => entry.role === 'assistant')?.text
      if (latestAssistant?.trim()) {
        return { text: latestAssistant, contentLabel: '\u9078\u629e\u4e2d\u30bb\u30c3\u30b7\u30e7\u30f3' }
      }

      const combinedLogs = selectedSession.logs.map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`).join('\n\n').trim()
      if (combinedLogs) {
        return { text: combinedLogs, contentLabel: '\u9078\u629e\u4e2d\u30bb\u30c3\u30b7\u30e7\u30f3' }
      }

      const combinedStream = selectedSession.streamEntries.map((entry) => `[${entry.kind}] ${entry.text}`).join('\n').trim()
      if (combinedStream) {
        return { text: combinedStream, contentLabel: '\u9078\u629e\u4e2d\u30bb\u30c3\u30b7\u30e7\u30f3' }
      }
    }
  }

  return { text: getLatestAssistantText(pane), contentLabel: '\u6700\u65b0\u7d50\u679c' }
}

function resetActiveSessionFields(pane: PaneState): PaneState {
  return {
    ...pane,
    prompt: '',
    status: 'idle',
    statusText: statusLabel('idle'),
    runInProgress: false,
    logs: [],
    streamEntries: [],
    selectedSessionKey: null,
    liveOutput: '',
    sessionId: null,
    sessionScopeKey: null,
    currentRequestText: null,
    currentRequestAt: null,
    stopRequested: false,
    stopRequestAvailable: false,
    lastRunAt: null,
    runningSince: null,
    lastActivityAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResponse: null
  }
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function isPaneBusyForExecution(pane: Pick<PaneState, 'status' | 'runInProgress'>): boolean {
  return pane.runInProgress || pane.status === 'running' || pane.status === 'updating'
}

function applyBackgroundActionSuccess(pane: PaneState, statusText: string, eventAt: number): PaneState {
  if (isPaneBusyForExecution(pane)) {
    return {
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'system', statusText, eventAt)
    }
  }

  return {
    ...pane,
    status: 'idle',
    statusText,
    lastError: null
  }
}

function applyBackgroundActionFailure(pane: PaneState, statusText: string, errorMessage: string, eventAt: number): PaneState {
  if (isPaneBusyForExecution(pane)) {
    return {
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'stderr', `${statusText}: ${errorMessage}`, eventAt)
    }
  }

  return {
    ...pane,
    status: 'error',
    statusText,
    lastError: errorMessage
  }
}

function normalizeSharedContextItem(rawItem: Partial<SharedContextItem> | null | undefined): SharedContextItem | null {
  if (!rawItem?.id || !rawItem.sourcePaneId || !rawItem.sourcePaneTitle || !rawItem.provider || !rawItem.workspaceLabel) {
    return null
  }

  return {
    id: rawItem.id,
    sourcePaneId: rawItem.sourcePaneId,
    sourcePaneTitle: rawItem.sourcePaneTitle,
    provider: rawItem.provider,
    workspaceLabel: rawItem.workspaceLabel,
    scope: rawItem.scope === 'direct' ? 'direct' : 'global',
    targetPaneIds: Array.isArray(rawItem.targetPaneIds)
      ? rawItem.targetPaneIds.filter((item): item is string => typeof item === 'string')
      : [],
    targetPaneTitles: Array.isArray(rawItem.targetPaneTitles)
      ? rawItem.targetPaneTitles.filter((item): item is string => typeof item === 'string')
      : [],
    contentLabel: typeof rawItem.contentLabel === 'string' && rawItem.contentLabel.trim() ? rawItem.contentLabel : '\u6700\u65b0\u7d50\u679c',
    summary: typeof rawItem.summary === 'string' ? rawItem.summary : '',
    detail: typeof rawItem.detail === 'string' ? rawItem.detail : '',
    consumedByPaneIds: Array.isArray(rawItem.consumedByPaneIds)
      ? rawItem.consumedByPaneIds.filter((item): item is string => typeof item === 'string')
      : [],
    createdAt: typeof rawItem.createdAt === 'number' ? rawItem.createdAt : Date.now()
  }
}

function loadPersistedState(): {
  panes: Partial<PaneState>[]
  sharedContext: SharedContextItem[]
  layout: LayoutMode
  localWorkspaces: LocalWorkspace[]
  focusedPaneId: string | null
} {
  const layout = readJsonStorage<LayoutMode>(STORAGE_KEYS.layout, 'triple')

  return {
    panes: readJsonStorage<Partial<PaneState>[]>(STORAGE_KEYS.panes, []),
    sharedContext: readJsonStorage<SharedContextItem[]>(STORAGE_KEYS.sharedContext, [])
      .map((item) => normalizeSharedContextItem(item))
      .filter((item): item is SharedContextItem => Boolean(item)),
    layout: layout === 'quad' || layout === 'focus' ? layout : 'triple',
    localWorkspaces: mergeLocalWorkspaces(readJsonStorage<LocalWorkspace[]>(STORAGE_KEYS.localWorkspaces, [])),
    focusedPaneId: readJsonStorage<string | null>(STORAGE_KEYS.focusedPane, null)
  }
}

function persistState(payload: {
  panes: PaneState[]
  sharedContext: SharedContextItem[]
  layout: LayoutMode
  localWorkspaces: LocalWorkspace[]
  focusedPaneId: string | null
}): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEYS.panes, JSON.stringify(payload.panes))
  window.localStorage.setItem(STORAGE_KEYS.sharedContext, JSON.stringify(payload.sharedContext))
  window.localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(payload.layout))
  window.localStorage.setItem(STORAGE_KEYS.localWorkspaces, JSON.stringify(getManualWorkspaces(payload.localWorkspaces)))
  window.localStorage.setItem(STORAGE_KEYS.focusedPane, JSON.stringify(payload.focusedPaneId))
}

function normalizeLocalDirectoryEntry(rawEntry: Partial<LocalDirectoryEntry> | null | undefined): LocalDirectoryEntry | null {
  if (!rawEntry?.label || !rawEntry.path) {
    return null
  }

  return {
    label: rawEntry.label,
    path: rawEntry.path,
    isDirectory: rawEntry.isDirectory !== false
  }
}

function normalizeRemoteDirectoryEntry(rawEntry: Partial<RemoteDirectoryEntry> | null | undefined): RemoteDirectoryEntry | null {
  if (!rawEntry?.label || !rawEntry.path) {
    return null
  }

  return {
    label: rawEntry.label,
    path: rawEntry.path,
    isDirectory: rawEntry.isDirectory !== false,
    isWorkspace: Boolean(rawEntry.isWorkspace)
  }
}

function normalizeSessionRecord(rawRecord: Partial<PaneSessionRecord> | null | undefined): PaneSessionRecord | null {
  if (!rawRecord?.key) {
    return null
  }

  const logs = Array.isArray(rawRecord.logs) ? rawRecord.logs.slice(-MAX_LOGS) : []
  const createdAt = typeof rawRecord.createdAt === 'number' ? rawRecord.createdAt : Date.now()
  const sessionId = typeof rawRecord.sessionId === 'string' ? rawRecord.sessionId : null

  return {
    key: rawRecord.key,
    label: buildSessionLabel(sessionId, createdAt, logs),
    sessionId,
    createdAt,
    updatedAt: typeof rawRecord.updatedAt === 'number' ? rawRecord.updatedAt : null,
    status:
      rawRecord.status === 'completed' || rawRecord.status === 'attention' || rawRecord.status === 'error' || rawRecord.status === 'running' || rawRecord.status === 'updating'
        ? rawRecord.status
        : 'idle',
    logs,
    streamEntries: Array.isArray(rawRecord.streamEntries) ? rawRecord.streamEntries.slice(-MAX_STREAM_ENTRIES) : []
  }
}

function normalizePane(
  rawPane: Partial<PaneState>,
  payload: BootstrapPayload,
  localWorkspaces: LocalWorkspace[]
): PaneState {
  const provider = isProviderId(rawPane.provider) ? rawPane.provider : 'codex'
  const catalog = payload.providers[provider]
  const fallbackModel = catalog.models[0]
  const model = catalog.models.some((item) => item.id === rawPane.model) ? rawPane.model ?? '' : fallbackModel?.id ?? ''
  const modelInfo = catalog.models.find((item) => item.id === model) ?? fallbackModel
  const reasoningEffort =
    isReasoningEffort(rawPane.reasoningEffort) &&
    (modelInfo?.supportedReasoningEfforts.length ? modelInfo.supportedReasoningEfforts.includes(rawPane.reasoningEffort) : true)
      ? rawPane.reasoningEffort
      : modelInfo?.defaultReasoningEffort ?? 'medium'
  const workspaceMode = rawPane.workspaceMode === 'ssh' ? 'ssh' : 'local'
  const persistedLocalWorkspacePath = typeof rawPane.localWorkspacePath === 'string' ? rawPane.localWorkspacePath.trim() : ''
  const localWorkspacePath = persistedLocalWorkspacePath || localWorkspaces[0]?.path || ''
  const rawStatus = rawPane.status ?? 'idle'
  const restoredStatus: PaneStatus =
    rawStatus === 'running'
      ? 'attention'
      : rawStatus === 'completed' || rawStatus === 'attention' || rawStatus === 'error' || rawStatus === 'updating'
        ? rawStatus
        : 'idle'
  const remoteBrowserEntries = Array.isArray(rawPane.remoteBrowserEntries)
    ? rawPane.remoteBrowserEntries
        .map((entry) => normalizeRemoteDirectoryEntry(entry))
        .filter((entry): entry is RemoteDirectoryEntry => Boolean(entry))
    : []
  const rawStatusText = typeof rawPane.statusText === 'string' ? rawPane.statusText : ''
  const statusText =
    rawStatus === 'running'
      ? '\u524d\u56de\u306e\u5b9f\u884c\u306f\u4e2d\u65ad\u3055\u308c\u307e\u3057\u305f'
      : rawStatusText.includes('\u5916\u90e8\u30bf\u30fc\u30df\u30ca\u30eb')
        ? statusLabel(restoredStatus)
        : rawStatusText || statusLabel(restoredStatus)

  return {
    id: rawPane.id ?? createId('pane'),
    title: typeof rawPane.title === 'string' && rawPane.title.trim() ? rawPane.title : 'Task',
    settingsOpen: rawPane.settingsOpen === true,
    workspaceOpen: rawPane.workspaceOpen === true,
    shellOpen: rawPane.shellOpen === true,
    provider,
    model,
    reasoningEffort,
    autonomyMode: rawPane.autonomyMode === 'max' ? 'max' : 'balanced',
    codexFastMode: rawPane.codexFastMode === 'fast' ? 'fast' : 'off',
    status: restoredStatus,
    statusText,
    runInProgress: false,
    shellCommand: typeof rawPane.shellCommand === 'string' ? rawPane.shellCommand : '',
    shellOutput: typeof rawPane.shellOutput === 'string' ? clipText(rawPane.shellOutput, MAX_SHELL_OUTPUT) : '',
    shellHistory: Array.isArray(rawPane.shellHistory)
      ? rawPane.shellHistory.filter((item): item is string => typeof item === 'string').slice(-50)
      : [],
    shellHistoryIndex: typeof rawPane.shellHistoryIndex === 'number' ? rawPane.shellHistoryIndex : null,
    localShellPath: typeof rawPane.localShellPath === 'string' && rawPane.localShellPath.trim() ? rawPane.localShellPath : localWorkspacePath,
    remoteShellPath: typeof rawPane.remoteShellPath === 'string' ? rawPane.remoteShellPath : '',
    shellRunning: false,
    shellLastExitCode: typeof rawPane.shellLastExitCode === 'number' ? rawPane.shellLastExitCode : null,
    shellLastError: typeof rawPane.shellLastError === 'string' ? rawPane.shellLastError : null,
    shellLastRunAt: typeof rawPane.shellLastRunAt === 'number' ? rawPane.shellLastRunAt : null,
    workspaceMode,
    localWorkspacePath,
    localBrowserPath: typeof rawPane.localBrowserPath === 'string' ? rawPane.localBrowserPath : '',
    localBrowserEntries: Array.isArray(rawPane.localBrowserEntries)
      ? rawPane.localBrowserEntries
          .map((entry) => normalizeLocalDirectoryEntry(entry))
          .filter((entry): entry is LocalDirectoryEntry => Boolean(entry))
      : [],
    localBrowserLoading: false,
    sshHost: typeof rawPane.sshHost === 'string' ? rawPane.sshHost : '',
    sshUser: typeof rawPane.sshUser === 'string' ? rawPane.sshUser : '',
    sshPort: typeof rawPane.sshPort === 'string' ? rawPane.sshPort : '',
    sshPassword: typeof rawPane.sshPassword === 'string' ? rawPane.sshPassword : '',
    sshIdentityFile: typeof rawPane.sshIdentityFile === 'string' ? rawPane.sshIdentityFile : '',
    sshProxyJump: typeof rawPane.sshProxyJump === 'string' ? rawPane.sshProxyJump : '',
    sshProxyCommand: typeof rawPane.sshProxyCommand === 'string' ? rawPane.sshProxyCommand : '',
    sshExtraArgs: typeof rawPane.sshExtraArgs === 'string' ? rawPane.sshExtraArgs : '',
    sshLocalKeys: Array.isArray(rawPane.sshLocalKeys) ? rawPane.sshLocalKeys : [],
    sshSelectedKeyPath: typeof rawPane.sshSelectedKeyPath === 'string' ? rawPane.sshSelectedKeyPath : '',
    sshPublicKeyText: typeof rawPane.sshPublicKeyText === 'string' ? rawPane.sshPublicKeyText : '',
    sshKeyName: typeof rawPane.sshKeyName === 'string' && rawPane.sshKeyName.trim() ? rawPane.sshKeyName : 'id_ed25519',
    sshKeyComment: typeof rawPane.sshKeyComment === 'string' ? rawPane.sshKeyComment : 'tako-cli-dev-tool',
    sshDiagnostics: Array.isArray(rawPane.sshDiagnostics)
      ? rawPane.sshDiagnostics.filter((item): item is string => typeof item === 'string')
      : [],
    sshActionState: rawPane.sshActionState === 'running' || rawPane.sshActionState === 'success' || rawPane.sshActionState === 'error' ? rawPane.sshActionState : 'idle',
    sshActionMessage: typeof rawPane.sshActionMessage === 'string' ? rawPane.sshActionMessage : null,
    sshPasswordPulseAt: 0,
    sshLocalPath: typeof rawPane.sshLocalPath === 'string' ? rawPane.sshLocalPath : localWorkspacePath,
    sshRemotePath: typeof rawPane.sshRemotePath === 'string' ? rawPane.sshRemotePath : '',
    remoteWorkspacePath: typeof rawPane.remoteWorkspacePath === 'string' ? rawPane.remoteWorkspacePath : '',
    remoteWorkspaces: Array.isArray(rawPane.remoteWorkspaces) ? rawPane.remoteWorkspaces : [],
    remoteAvailableProviders: Array.isArray(rawPane.remoteAvailableProviders)
      ? rawPane.remoteAvailableProviders.filter(isProviderId)
      : [],
    remoteHomeDirectory: typeof rawPane.remoteHomeDirectory === 'string' ? rawPane.remoteHomeDirectory : null,
    remoteBrowserPath: typeof rawPane.remoteBrowserPath === 'string' ? rawPane.remoteBrowserPath : '',
    remoteBrowserEntries,
    remoteParentPath: typeof rawPane.remoteParentPath === 'string' ? rawPane.remoteParentPath : null,
    remoteNewDirectoryName: typeof rawPane.remoteNewDirectoryName === 'string' ? rawPane.remoteNewDirectoryName : '',
    remoteBrowserLoading: false,
    prompt: typeof rawPane.prompt === 'string' ? rawPane.prompt : '',
    logs: Array.isArray(rawPane.logs) ? rawPane.logs.slice(-MAX_LOGS) : [],
    streamEntries: Array.isArray(rawPane.streamEntries) ? rawPane.streamEntries.slice(-MAX_STREAM_ENTRIES) : [],
    sessionHistory: Array.isArray(rawPane.sessionHistory)
      ? rawPane.sessionHistory
          .map((item) => normalizeSessionRecord(item))
          .filter((item): item is PaneSessionRecord => Boolean(item))
      : [],
    selectedSessionKey: typeof rawPane.selectedSessionKey === 'string' ? rawPane.selectedSessionKey : null,
    liveOutput: typeof rawPane.liveOutput === 'string' ? clipText(rawPane.liveOutput, MAX_LIVE_OUTPUT) : '',
    attachedContextIds: Array.isArray(rawPane.attachedContextIds)
      ? rawPane.attachedContextIds.filter((item): item is string => typeof item === 'string')
      : [],
    sessionId: typeof rawPane.sessionId === 'string' ? rawPane.sessionId : null,
    sessionScopeKey: typeof rawPane.sessionScopeKey === 'string' ? rawPane.sessionScopeKey : null,
    autoShare: Boolean(rawPane.autoShare),
    autoShareTargetIds: Array.isArray(rawPane.autoShareTargetIds)
      ? rawPane.autoShareTargetIds.filter((item): item is string => typeof item === 'string')
      : [],
    pendingShareGlobal: Boolean(rawPane.pendingShareGlobal),
    pendingShareTargetIds: Array.isArray(rawPane.pendingShareTargetIds)
      ? rawPane.pendingShareTargetIds.filter((item): item is string => typeof item === 'string')
      : [],
    currentRequestText: typeof rawPane.currentRequestText === 'string' && rawPane.currentRequestText.trim() ? rawPane.currentRequestText : null,
    currentRequestAt: typeof rawPane.currentRequestAt === 'number' ? rawPane.currentRequestAt : null,
    stopRequested: false,
    stopRequestAvailable: false,
    lastRunAt: typeof rawPane.lastRunAt === 'number' ? rawPane.lastRunAt : null,
    runningSince: null,
    lastActivityAt: typeof rawPane.lastActivityAt === 'number' ? rawPane.lastActivityAt : null,
    lastFinishedAt: typeof rawPane.lastFinishedAt === 'number' ? rawPane.lastFinishedAt : null,
    lastError: typeof rawPane.lastError === 'string' ? rawPane.lastError : null,
    lastResponse: typeof rawPane.lastResponse === 'string' ? rawPane.lastResponse : null
  }
}

function App() {
  const persistedRef = useRef(loadPersistedState())
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalWorkspace[]>(mergeLocalWorkspaces(persistedRef.current.localWorkspaces))
  const [panes, setPanes] = useState<PaneState[]>([])
  const [sharedContext, setSharedContext] = useState<SharedContextItem[]>(persistedRef.current.sharedContext)
  const [layout, setLayout] = useState<LayoutMode>(persistedRef.current.layout)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(persistedRef.current.focusedPaneId)
  const [selectedPaneIds, setSelectedPaneIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [workspacePicker, setWorkspacePicker] = useState<WorkspacePickerState | null>(null)
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null)
  const [matrixDropTargetId, setMatrixDropTargetId] = useState<string | null>(null)
  const [paneImageAttachments, setPaneImageAttachments] = useState<Record<string, PromptImageAttachment[]>>({})

  const panesRef = useRef<PaneState[]>([])
  const localWorkspacesRef = useRef<LocalWorkspace[]>([])
  const sharedContextRef = useRef<SharedContextItem[]>([])
  const controllersRef = useRef<Record<string, AbortController>>({})
  const stopRequestedRef = useRef<Set<string>>(new Set())
  const streamErroredRef = useRef<Set<string>>(new Set())
  const shellControllersRef = useRef<Record<string, AbortController>>({})
  const shellStopRequestedRef = useRef<Set<string>>(new Set())
  const workspaceRefreshTimersRef = useRef<Record<string, number>>({})
  const matrixTileRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const paneCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const paneImageAttachmentsRef = useRef<Record<string, PromptImageAttachment[]>>({})
  const promptImageCleanupPathsRef = useRef<Record<string, string[]>>({})
  const matrixTileRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const paneCardRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const refreshBootstrapInFlightRef = useRef(false)
  const refreshBootstrapRef = useRef<(() => Promise<void>) | null>(null)

  panesRef.current = panes
  localWorkspacesRef.current = localWorkspaces
  sharedContextRef.current = sharedContext
  paneImageAttachmentsRef.current = paneImageAttachments

  const revokePromptImagePreview = (attachment: Pick<PromptImageAttachment, 'previewUrl'>) => {
    if (attachment.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }

  const cleanupPromptImageFiles = (localPaths: string[]) => {
    const normalizedPaths = [...new Set(localPaths.map((entry) => entry.trim()).filter(Boolean))]
    if (normalizedPaths.length === 0) {
      return
    }

    void unstagePromptImages(normalizedPaths).catch(() => undefined)
  }

  const queuePromptImageCleanup = (paneId: string, localPaths: string[]) => {
    const normalizedPaths = [...new Set(localPaths.map((entry) => entry.trim()).filter(Boolean))]
    if (normalizedPaths.length === 0) {
      return
    }

    const existing = promptImageCleanupPathsRef.current[paneId] ?? []
    promptImageCleanupPathsRef.current[paneId] = [...new Set([...existing, ...normalizedPaths])]
  }

  const flushQueuedPromptImageCleanup = (paneId: string) => {
    const queuedPaths = promptImageCleanupPathsRef.current[paneId] ?? []
    if (queuedPaths.length === 0) {
      return
    }

    delete promptImageCleanupPathsRef.current[paneId]
    cleanupPromptImageFiles(queuedPaths)
  }

  const updatePanePromptImages = (
    paneId: string,
    updater: (current: PromptImageAttachment[]) => PromptImageAttachment[]
  ) => {
    setPaneImageAttachments((current) => {
      const existing = current[paneId] ?? []
      const next = updater(existing)
      if (next.length === 0) {
        if (!(paneId in current)) {
          return current
        }

        const snapshot = { ...current }
        delete snapshot[paneId]
        return snapshot
      }

      return {
        ...current,
        [paneId]: next
      }
    })
  }

  const clearPanePromptImages = (paneId: string, options: { cleanupFiles?: boolean } = {}) => {
    const existing = paneImageAttachmentsRef.current[paneId] ?? []
    if (options.cleanupFiles !== false) {
      cleanupPromptImageFiles(existing.flatMap((attachment) => attachment.localPath ? [attachment.localPath] : []))
    }

    setPaneImageAttachments((current) => {
      for (const attachment of existing) {
        revokePromptImagePreview(attachment)
      }

      if (!(paneId in current)) {
        return current
      }

      const snapshot = { ...current }
      delete snapshot[paneId]
      return snapshot
    })
  }

  const clearMultiplePanePromptImages = (paneIds: string[], options: { cleanupFiles?: boolean } = {}) => {
    const paneIdSet = new Set(paneIds)
    if (paneIdSet.size === 0) {
      return
    }

    if (options.cleanupFiles !== false) {
      const localPaths = [...paneIdSet].flatMap((paneId) => (paneImageAttachmentsRef.current[paneId] ?? []).flatMap((attachment) => attachment.localPath ? [attachment.localPath] : []))
      cleanupPromptImageFiles(localPaths)
    }

    setPaneImageAttachments((current) => {
      let changed = false
      const snapshot = { ...current }

      for (const paneId of paneIdSet) {
        const existing = snapshot[paneId] ?? []
        if (existing.length === 0) {
          continue
        }

        changed = true
        for (const attachment of existing) {
          revokePromptImagePreview(attachment)
        }
        delete snapshot[paneId]
      }

      return changed ? snapshot : current
    })
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of Object.values(workspaceRefreshTimersRef.current)) {
        window.clearTimeout(timer)
      }
      for (const controller of Object.values(controllersRef.current)) {
        controller.abort()
      }
      for (const controller of Object.values(shellControllersRef.current)) {
        controller.abort()
      }
      const pendingPaths = Object.values(promptImageCleanupPathsRef.current).flat()
      cleanupPromptImageFiles([
        ...pendingPaths,
        ...Object.values(paneImageAttachmentsRef.current).flatMap((attachments) => attachments.flatMap((attachment) => attachment.localPath ? [attachment.localPath] : []))
      ])
      for (const attachments of Object.values(paneImageAttachmentsRef.current)) {
        for (const attachment of attachments) {
          revokePromptImagePreview(attachment)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    persistState({
      panes,
      sharedContext,
      layout,
      localWorkspaces,
      focusedPaneId
    })
  }, [bootstrap, focusedPaneId, layout, localWorkspaces, panes, sharedContext])

  useEffect(() => {
    if (panes.length === 0) {
      return
    }

    if (!focusedPaneId || !panes.some((pane) => pane.id === focusedPaneId)) {
      setFocusedPaneId(panes[0].id)
    }
  }, [focusedPaneId, panes])

  useEffect(() => {
    setSelectedPaneIds((current) => current.filter((paneId) => panes.some((pane) => pane.id === paneId)))
  }, [panes])

  const refreshBootstrap = async () => {
    if (refreshBootstrapInFlightRef.current) {
      return
    }

    refreshBootstrapInFlightRef.current = true
    setLoading(true)
    setGlobalError(null)

    try {
      const payload = await fetchBootstrapWithRetry()
      const nextLocalWorkspaces = mergeLocalWorkspaces(
        payload.localWorkspaces,
        getManualWorkspaces(localWorkspacesRef.current),
        getManualWorkspaces(persistedRef.current.localWorkspaces)
      )

      setBootstrap(payload)
      setLocalWorkspaces(nextLocalWorkspaces)
      setPanes((current) => {
        const source =
          current.length > 0
            ? current
            : persistedRef.current.panes.length > 0
              ? persistedRef.current.panes
              : PROVIDER_ORDER.map((_, index) => createInitialPane(index, payload, nextLocalWorkspaces))

        return source.map((pane) => normalizePane(pane, payload, nextLocalWorkspaces))
      })
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : String(error))
    } finally {
      refreshBootstrapInFlightRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshBootstrapRef.current = refreshBootstrap
  }, [refreshBootstrap])

  useEffect(() => {
    void refreshBootstrap()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const handleWindowFocus = () => {
      void refreshBootstrapRef.current?.()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshBootstrapRef.current?.()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!workspacePicker) {
      return
    }

    return acquireBodyScrollLock()
  }, [workspacePicker])

  const catalogs = bootstrap?.providers ?? EMPTY_CATALOGS
  const isBootstrapping = loading && !bootstrap
  const paneOrderKey = useMemo(() => panes.map((pane) => pane.id).join('|'), [panes])
  const selectedPane = useMemo(
    () => panes.find((pane) => pane.id === focusedPaneId) ?? panes[0] ?? null,
    [focusedPaneId, panes]
  )
  const visiblePanes = useMemo(
    () => (layout === 'focus' ? (selectedPane ? [selectedPane] : []) : panes),
    [layout, panes, selectedPane]
  )
  const visiblePaneOrderKey = useMemo(() => visiblePanes.map((pane) => pane.id).join('|'), [visiblePanes])
  const workspacePickerParentPath = workspacePicker
    ? workspacePicker.mode === 'local'
      ? getAbsoluteLocalParentPath(workspacePicker.path)
      : getAbsoluteRemoteParentPath(workspacePicker.path)
    : null

  const metrics = useMemo(() => {
    const result = {
      running: 0,
      completed: 0,
      attention: 0,
      error: 0,
      stalled: 0
    }

    for (const pane of panes) {
      if (isPaneBusyForExecution(pane)) {
        result.running += 1
      } else if (pane.status === 'completed') {
        result.completed += 1
      } else if (pane.status === 'attention') {
        result.attention += 1
      } else if (pane.status === 'error') {
        result.error += 1
      }

      if (pane.runInProgress && pane.lastActivityAt !== null && now - pane.lastActivityAt > STALL_MS) {
        result.stalled += 1
      }
    }

    return result
  }, [now, panes])

  useLayoutEffect(() => {
    const nextMatrixRects = new Map<string, DOMRect>()
    for (const pane of panes) {
      const element = matrixTileRefs.current[pane.id]
      if (!element) {
        continue
      }

      const nextRect = getDocumentRect(element)
      const previousRect = matrixTileRectsRef.current.get(pane.id)
      if (previousRect) {
        animateReorder(element, previousRect, nextRect)
      }
      nextMatrixRects.set(pane.id, nextRect)
    }
    matrixTileRectsRef.current = nextMatrixRects

    const nextPaneRects = new Map<string, DOMRect>()
    for (const pane of visiblePanes) {
      const element = paneCardRefs.current[pane.id]
      if (!element) {
        continue
      }

      const nextRect = getDocumentRect(element)
      const previousRect = paneCardRectsRef.current.get(pane.id)
      if (previousRect) {
        animateReorder(element, previousRect, nextRect)
      }
      nextPaneRects.set(pane.id, nextRect)
    }
    paneCardRectsRef.current = nextPaneRects
  }, [layout, paneOrderKey, visiblePaneOrderKey])

  const updatePane = (paneId: string, updates: Partial<PaneState>) => {
    setPanes((current) => current.map((pane) => {
      if (pane.id !== paneId) {
        return pane
      }

      const nextPane = { ...pane, ...updates }
      if (typeof updates.sshHost !== 'string') {
        return nextPane
      }

      const reusablePane = findReusableSshPane(paneId, nextPane.sshHost, current)
      if (!reusablePane) {
        return nextPane
      }

      const mergedLocalKeys = mergeLocalSshKeys(nextPane.sshLocalKeys, reusablePane.sshLocalKeys)
      const hasExplicitKeySelection = Boolean(nextPane.sshSelectedKeyPath.trim() || nextPane.sshIdentityFile.trim())
      const preferredKey = getPreferredLocalSshKey({ ...nextPane, sshLocalKeys: mergedLocalKeys }, mergedLocalKeys, current)

      if (mergedLocalKeys.length !== nextPane.sshLocalKeys.length) {
        nextPane.sshLocalKeys = mergedLocalKeys
      }

      if (!hasExplicitKeySelection) {
        if (preferredKey) {
          nextPane.sshSelectedKeyPath = preferredKey.privateKeyPath
          nextPane.sshIdentityFile = preferredKey.privateKeyPath
          nextPane.sshPublicKeyText = preferredKey.publicKey
          nextPane.sshKeyName = preferredKey.name
          nextPane.sshKeyComment = preferredKey.comment
        } else if (reusablePane.sshIdentityFile.trim()) {
          nextPane.sshIdentityFile = reusablePane.sshIdentityFile.trim()
        }
      }

      return nextPane
    }))
  }

  const mutatePane = (paneId: string, updater: (pane: PaneState) => PaneState) => {
    setPanes((current) => current.map((pane) => (pane.id === paneId ? updater(pane) : pane)))
  }

  const appendPaneSystemMessage = (paneId: string, text: string) => {
    const eventAt = Date.now()
    mutatePane(paneId, (pane) => ({
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'system', text, eventAt),
      lastActivityAt: eventAt
    }))
  }

  const scheduleWorkspaceContentsRefresh = (paneId: string, delay = 240) => {
    const existingTimer = workspaceRefreshTimersRef.current[paneId]
    if (existingTimer) {
      window.clearTimeout(existingTimer)
    }

    workspaceRefreshTimersRef.current[paneId] = window.setTimeout(() => {
      delete workspaceRefreshTimersRef.current[paneId]

      const pane = panesRef.current.find((item) => item.id === paneId)
      if (!pane) {
        return
      }

      if (pane.workspaceMode === 'local') {
        const targetPath = pane.localBrowserPath.trim() || pane.localWorkspacePath.trim()
        if (targetPath) {
          void handleBrowseLocal(paneId, targetPath)
        }
        return
      }

      const targetPath = pane.remoteBrowserPath.trim() || pane.remoteWorkspacePath.trim()
      if (pane.sshHost.trim() && targetPath) {
        void handleBrowseRemote(paneId, targetPath)
      }
    }, delay)
  }

  const handleRefreshWorkspaceContents = (paneId: string) => {
    scheduleWorkspaceContentsRefresh(paneId, 0)
  }

  const scrollToPane = (paneId: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`pane-${paneId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })
  }

  const handleSelectPane = (paneId: string, shouldScroll = false, toggleSelection = false) => {
    setFocusedPaneId(paneId)
    setSelectedPaneIds((current) => {
      if (!toggleSelection) {
        return current.length === 0 ? current : []
      }

      return current.includes(paneId)
        ? current.filter((item) => item !== paneId)
        : [...current, paneId]
    })

    if (shouldScroll && !toggleSelection) {
      scrollToPane(paneId)
    }
  }

  const handleMatrixClick = (event: { ctrlKey: boolean; metaKey: boolean }, paneId: string) => {
    handleSelectPane(paneId, layout !== 'focus', event.ctrlKey || event.metaKey)
  }

  const resolveDraggedPaneId = (event: ReactDragEvent<HTMLElement>): string | null => {
    const transferPaneId = event.dataTransfer.getData('text/plain').trim()
    return draggedPaneId ?? (transferPaneId || null)
  }

  const handleMatrixDragStart = (event: ReactDragEvent<HTMLButtonElement>, paneId: string) => {
    if (panes.length < 2) {
      return
    }

    setDraggedPaneId(paneId)
    setMatrixDropTargetId(paneId)
    setFocusedPaneId(paneId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', paneId)
  }

  const handleMatrixDragEnter = (event: ReactDragEvent<HTMLButtonElement>, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId || sourcePaneId === targetPaneId) {
      return
    }

    event.preventDefault()
    setMatrixDropTargetId(targetPaneId)
  }

  const handleMatrixDragOver = (event: ReactDragEvent<HTMLButtonElement>, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId || sourcePaneId === targetPaneId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (matrixDropTargetId !== targetPaneId) {
      setMatrixDropTargetId(targetPaneId)
    }
  }

  const handleMatrixDrop = (event: ReactDragEvent<HTMLButtonElement>, targetPaneId: string) => {
    const sourcePaneId = resolveDraggedPaneId(event)
    if (!sourcePaneId) {
      return
    }

    event.preventDefault()
    if (sourcePaneId !== targetPaneId) {
      setPanes((current) => reorderPanesById(current, sourcePaneId, targetPaneId))
    }
    setMatrixDropTargetId(null)
  }

  const handleMatrixDragEnd = () => {
    setDraggedPaneId(null)
    setMatrixDropTargetId(null)
  }

  const handleProviderChange = (paneId: string, provider: ProviderId) => {
    if (!bootstrap) {
      return
    }

    const nextModel = bootstrap.providers[provider].models[0]
    const hasPromptImages = (paneImageAttachmentsRef.current[paneId] ?? []).length > 0
    if (provider === 'copilot' && hasPromptImages) {
      clearPanePromptImages(paneId)
    }

    updatePane(paneId, {
      provider,
      model: nextModel?.id ?? '',
      reasoningEffort: nextModel?.defaultReasoningEffort ?? 'medium',
      codexFastMode: 'off',
      sessionId: null,
      sessionScopeKey: null,
      selectedSessionKey: null,
      ...(provider === 'copilot' && hasPromptImages
        ? {
            status: 'attention' as const,
            statusText: 'Copilot では画像添付を使えません',
            lastError: 'GitHub Copilot CLI は画像入力未対応のため、添付画像を解除しました。'
          }
        : {})
    })
  }

  const handleAddPromptImages = async (paneId: string, files: File[], source: PromptImageAttachmentSource) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    if (pane.provider === 'copilot') {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'Copilot では画像添付を使えません',
        lastError: 'GitHub Copilot CLI は画像入力未対応です。Codex CLI または Gemini CLI を選択してください。'
      })
      return
    }

    const normalizedFiles = files
      .map((file) => normalizePromptImageFile(file, source))
      .filter((item): item is { file: File; fileName: string; mimeType: string } => Boolean(item))

    if (normalizedFiles.length === 0) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '画像ファイルを選択してください',
        lastError: '添付できるのは画像ファイルのみです。'
      })
      return
    }

    const draftAttachments: PromptImageAttachment[] = normalizedFiles.map(({ file, fileName, mimeType }) => ({
      id: createId('prompt-image'),
      fileName,
      mimeType,
      size: file.size,
      localPath: null,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
      source,
      error: null
    }))

    updatePanePromptImages(paneId, (current) => [...current, ...draftAttachments])

    await Promise.all(draftAttachments.map(async (attachment, index) => {
      const sourceFile = normalizedFiles[index]
      if (!sourceFile) {
        return
      }

      try {
        const contentBase64 = await readFileAsBase64(sourceFile.file)
        const response = await stagePromptImage({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          contentBase64
        })

        updatePanePromptImages(paneId, (current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  status: 'ready',
                  localPath: response.attachment.localPath,
                  error: null
                }
              : item
          )
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updatePanePromptImages(paneId, (current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  status: 'error',
                  localPath: null,
                  error: message
                }
              : item
          )
        )
        updatePane(paneId, {
          status: 'attention',
          statusText: '画像添付を確認してください',
          lastError: `画像を準備できませんでした: ${attachment.fileName}`
        })
      }
    }))
  }

  const handleRemovePromptImage = (paneId: string, attachmentId: string) => {
    const existing = paneImageAttachmentsRef.current[paneId] ?? []
    const targetAttachment = existing.find((attachment) => attachment.id === attachmentId)
    if (!targetAttachment) {
      return
    }

    if (targetAttachment.localPath) {
      cleanupPromptImageFiles([targetAttachment.localPath])
    }

    revokePromptImagePreview(targetAttachment)
    updatePanePromptImages(paneId, (current) => current.filter((attachment) => attachment.id !== attachmentId))
  }

  const handleModelChange = (paneId: string, model: string) => {
    if (!bootstrap) {
      return
    }

    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const normalizedModel = model.trim()
    if (!normalizedModel) {
      return
    }

    const modelInfo = bootstrap.providers[pane.provider].models.find((item) => item.id === normalizedModel)

    const reasoningEffort =
      !modelInfo ||
      modelInfo.supportedReasoningEfforts.length === 0 ||
      modelInfo.supportedReasoningEfforts.includes(pane.reasoningEffort)
        ? pane.reasoningEffort
        : modelInfo.defaultReasoningEffort ?? 'medium'

    updatePane(paneId, {
      model: normalizedModel,
      reasoningEffort,
      sessionId: null,
      sessionScopeKey: null,
      selectedSessionKey: null
    })
  }

  const replaceSourceSharedContext = (sourcePaneId: string, nextSourceContexts: SharedContextItem[]) => {
    const previousSourceContextIds = sharedContextRef.current
      .filter((item) => item.sourcePaneId === sourcePaneId)
      .map((item) => item.id)

    const nextSharedContext = [...nextSourceContexts, ...sharedContextRef.current.filter((item) => item.sourcePaneId !== sourcePaneId)]
      .slice(0, MAX_SHARED_CONTEXT)
    const storedSourceContexts = nextSharedContext.filter((item) => item.sourcePaneId === sourcePaneId)

    setSharedContext(nextSharedContext)
    setPanes((current) =>
      current.map((pane) => {
        const baseAttached = pane.attachedContextIds.filter((item) => !previousSourceContextIds.includes(item))
        const nextAttached = storedSourceContexts
          .filter((item) => item.targetPaneIds.includes(pane.id) && !item.consumedByPaneIds.includes(pane.id))
          .map((item) => item.id)

        return {
          ...pane,
          attachedContextIds: [...baseAttached, ...nextAttached.filter((item) => !baseAttached.includes(item))]
        }
      })
    )
  }

  const setPendingShareSelection = (
    paneId: string,
    responseOverride: string | undefined,
    selection: { mode: 'none' | 'global' | 'direct'; targetPaneIds?: string[] }
  ): boolean => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return false
    }

    const targetPanes = panesRef.current.filter((item) => item.id !== paneId)
    const allowedTargetIds = new Set(targetPanes.map((item) => item.id))
    const normalizedTargetIds = selection.mode === 'global'
      ? targetPanes.map((item) => item.id)
      : (selection.targetPaneIds ?? []).filter((item): item is string => typeof item === 'string' && allowedTargetIds.has(item))

    if (selection.mode === 'none' || normalizedTargetIds.length === 0) {
      replaceSourceSharedContext(paneId, [])
      updatePane(paneId, {
        pendingShareGlobal: false,
        pendingShareTargetIds: []
      })
      return true
    }

    const payload = getShareablePayload(pane)
    const response = responseOverride ?? payload.text
    if (!response) {
      replaceSourceSharedContext(paneId, [])
      updatePane(paneId, {
        pendingShareGlobal: selection.mode === 'global',
        pendingShareTargetIds: selection.mode === 'direct' ? normalizedTargetIds : []
      })
      return true
    }

    updatePane(paneId, {
      pendingShareGlobal: false,
      pendingShareTargetIds: []
    })

    const target = buildTargetFromPane(pane, localWorkspacesRef.current, bootstrap?.sshHosts ?? [], panesRef.current)
    const selectedTargetPanes = targetPanes.filter((item) => normalizedTargetIds.includes(item.id))

    const nextSourceContexts = selection.mode === 'global'
      ? [
          createSharedContextItem(pane, target, response, {
            scope: 'global',
            targetPaneIds: selectedTargetPanes.map((item) => item.id),
            targetPaneTitles: selectedTargetPanes.map((item) => item.title),
            contentLabel: payload.contentLabel
          })
        ]
      : selectedTargetPanes.map((targetPane) =>
          createSharedContextItem(pane, target, response, {
            scope: 'direct',
            targetPaneIds: [targetPane.id],
            targetPaneTitles: [targetPane.title],
            contentLabel: payload.contentLabel
          })
        )

    replaceSourceSharedContext(paneId, nextSourceContexts)
    return true
  }

  const shareFromPane = (
    paneId: string,
    responseOverride?: string,
    options?: {
      scope?: SharedContextItem['scope']
      targetPaneId?: string
    }
  ) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const allTargetIds = panesRef.current.filter((item) => item.id !== paneId).map((item) => item.id)
    const existingContexts = sharedContextRef.current.filter((item) => item.sourcePaneId === paneId)
    const globalContext = existingContexts.find((item) => item.scope === 'global') ?? null
    const isGlobalShareArmed = pane.pendingShareGlobal
    const directTargetIds = existingContexts
      .filter((item) => item.scope === 'direct')
      .flatMap((item) => item.targetPaneIds)
    const effectiveDirectTargetIds = Array.from(new Set([...directTargetIds, ...pane.pendingShareTargetIds]))
    const hasShareablePayload = Boolean((responseOverride ?? getShareablePayload(pane).text)?.trim())

    if ((options?.scope ?? 'global') === 'global') {
      const enabled = setPendingShareSelection(
        paneId,
        responseOverride,
        globalContext || isGlobalShareArmed ? { mode: 'none' } : { mode: 'global' }
      )
      if (!enabled) {
        appendPaneSystemMessage(paneId, '\u5171\u6709\u3067\u304d\u308b\u6700\u65b0\u7d50\u679c\u304c\u307e\u3060\u3042\u308a\u307e\u305b\u3093')
        return
      }

      appendPaneSystemMessage(
        paneId,
        globalContext || isGlobalShareArmed
          ? '\u5168\u4f53\u5171\u6709\u3092\u89e3\u9664\u3057\u307e\u3057\u305f'
          : hasShareablePayload
            ? '\u6700\u65b0\u7d50\u679c\u3092\u5168\u4f53\u5171\u6709\u306b\u8ffd\u52a0\u3057\u307e\u3057\u305f'
            : '\u6b21\u56de\u306e\u5fdc\u7b54\u3092\u5168\u4f53\u5171\u6709\u3059\u308b\u3088\u3046\u306b\u8a2d\u5b9a\u3057\u307e\u3057\u305f'
      )
      return
    }

    const targetPaneId = options?.targetPaneId?.trim()
    if (!targetPaneId) {
      return
    }

    const targetPane = panesRef.current.find((item) => item.id === targetPaneId)
    if (!targetPane) {
      return
    }

    if (globalContext || isGlobalShareArmed) {
      const remainingTargetIds = allTargetIds.filter((id) => id !== targetPaneId)
      setPendingShareSelection(
        paneId,
        responseOverride,
        remainingTargetIds.length > 0 ? { mode: 'direct', targetPaneIds: remainingTargetIds } : { mode: 'none' }
      )
      appendPaneSystemMessage(paneId, `${targetPane.title} \u3092\u5171\u6709\u5148\u304b\u3089\u5916\u3057\u307e\u3057\u305f`)
      return
    }

    const nextTargetIds = effectiveDirectTargetIds.includes(targetPaneId)
      ? effectiveDirectTargetIds.filter((id) => id !== targetPaneId)
      : [...effectiveDirectTargetIds, targetPaneId]

    const enabled = setPendingShareSelection(
      paneId,
      responseOverride,
      nextTargetIds.length > 0 ? { mode: 'direct', targetPaneIds: nextTargetIds } : { mode: 'none' }
    )
    if (!enabled) {
      appendPaneSystemMessage(paneId, '\u5171\u6709\u3067\u304d\u308b\u6700\u65b0\u7d50\u679c\u304c\u307e\u3060\u3042\u308a\u307e\u305b\u3093')
      return
    }

    if (isLocalDevEnvironment()) {
      console.log('[share-toggle-click]', {
        sourcePaneId: paneId,
        targetPaneId,
        nextTargetIds,
        directTargetIds: effectiveDirectTargetIds,
        hasShareablePayload,
        enabled
      })
    }

    appendPaneSystemMessage(
      paneId,
      effectiveDirectTargetIds.includes(targetPaneId)
        ? `${targetPane.title} \u3078\u306e\u500b\u5225\u5171\u6709\u3092\u89e3\u9664\u3057\u307e\u3057\u305f`
        : hasShareablePayload
          ? `${targetPane.title} \u3078\u500b\u5225\u5171\u6709\u3057\u307e\u3057\u305f`
          : `${targetPane.title} \u3078\u306e1\u56de\u5171\u6709\u3092\u4e88\u7d04\u3057\u307e\u3057\u305f`
    )
  }

  const handleDeleteSharedContext = (contextId: string) => {
    setSharedContext((current) => current.filter((item) => item.id !== contextId))
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        attachedContextIds: pane.attachedContextIds.filter((item) => item !== contextId)
      }))
    )
  }

  const handleStreamEvent = (paneId: string, event: RunStreamEvent) => {
    const eventAt = Date.now()
    const shouldKeepRunning = Boolean(controllersRef.current[paneId]) && !stopRequestedRef.current.has(paneId)

    if (event.type === 'assistant-delta') {
      startTransition(() => {
        mutatePane(paneId, (pane) => ({
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          liveOutput: appendLiveOutputChunk(pane.liveOutput, event.text),
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          lastActivityAt: eventAt,
          statusText: '\u5fdc\u7b54\u3092\u751f\u6210\u4e2d'
        }))
      })
      return
    }

    if (event.type === 'session') {
      mutatePane(paneId, (pane) => ({
        ...pane,
        status: shouldKeepRunning ? 'running' : pane.status,
        sessionId: event.sessionId,
        sessionScopeKey: buildPaneSessionScopeKey(pane),
        runInProgress: shouldKeepRunning ? true : pane.runInProgress,
        runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
        lastActivityAt: eventAt,
        statusText: shouldKeepRunning ? '\u5b9f\u884c\u4e2d' : pane.statusText,
        streamEntries: appendStreamEntry(pane.streamEntries, 'system', `\u30bb\u30c3\u30b7\u30e7\u30f3\u958b\u59cb: ${event.sessionId}`, eventAt)
      }))
      return
    }

    if (event.type === 'status' || event.type === 'tool' || event.type === 'stderr') {
      const kind = event.type === 'status' ? 'status' : event.type === 'tool' ? 'tool' : 'stderr'
      const normalizedText = sanitizeTerminalText(event.text).trim()
      mutatePane(paneId, (pane) => {
        const issueSummary = event.type === 'stderr' ? getProviderIssueSummary(pane.provider, normalizedText) : null

        return {
          ...pane,
          status: shouldKeepRunning ? 'running' : pane.status,
          lastActivityAt: eventAt,
          runInProgress: shouldKeepRunning ? true : pane.runInProgress,
          runningSince: shouldKeepRunning ? pane.runningSince ?? eventAt : pane.runningSince,
          statusText: shouldKeepRunning ? '\u5b9f\u884c\u4e2d' : pane.statusText,
          streamEntries:
            issueSummary && !pane.streamEntries.some((entry) => entry.kind === 'system' && entry.text === issueSummary.displayMessage)
              ? appendStreamEntry(appendStreamEntry(pane.streamEntries, kind, normalizedText, eventAt), 'system', issueSummary.displayMessage, eventAt)
              : appendStreamEntry(pane.streamEntries, kind, normalizedText, eventAt)
        }
      })
      return
    }

    if (event.type === 'final') {
      const finalText = clipText(sanitizeTerminalText(event.response).trim(), MAX_LIVE_OUTPUT)
      const assistantEntry: PaneLogEntry = {
        id: createId('log'),
        role: 'assistant',
        text: finalText,
        createdAt: eventAt
      }

      let shouldShareGlobal = false
      let autoShareTargetIds: string[] = []
      let pendingShareGlobal = false
      let pendingShareTargetIds: string[] = []
      mutatePane(paneId, (pane) => {
        const finalPreview = finalText.slice(0, 120)
        const liveOutputHasFinal = Boolean(finalPreview) && pane.liveOutput.includes(finalPreview)
        const nextLiveOutput = finalText
          ? liveOutputHasFinal
            ? clipText(pane.liveOutput, MAX_LIVE_OUTPUT)
            : appendLiveOutputLine(pane.liveOutput, finalText)
          : pane.liveOutput

        shouldShareGlobal = pane.autoShare
        autoShareTargetIds = pane.autoShareTargetIds.filter((item) => item !== pane.id)
        pendingShareGlobal = pane.pendingShareGlobal
        pendingShareTargetIds = pane.pendingShareTargetIds.filter((item) => item !== pane.id)
        return {
          ...pane,
          logs: appendLogEntry(pane.logs, assistantEntry),
          status: event.statusHint,
          statusText: statusLabel(event.statusHint),
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: event.statusHint === 'error' ? '\u51e6\u7406\u304c\u30a8\u30e9\u30fc\u3067\u7d42\u4e86\u3057\u307e\u3057\u305f' : null,
          lastResponse: assistantEntry.text,
          liveOutput: nextLiveOutput,
          sessionId: event.sessionId ?? pane.sessionId,
          sessionScopeKey: buildPaneSessionScopeKey(pane),
          streamEntries: appendStreamEntry(pane.streamEntries, 'system', `\u7d50\u679c: ${statusLabel(event.statusHint)}`, eventAt)
        }
      })

      if (pendingShareGlobal) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'global' })
      } else if (pendingShareTargetIds.length > 0) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'direct', targetPaneIds: pendingShareTargetIds })
      } else if (shouldShareGlobal) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'global' })
      } else if (autoShareTargetIds.length > 0) {
        setPendingShareSelection(paneId, assistantEntry.text, { mode: 'direct', targetPaneIds: autoShareTargetIds })
      }
      scheduleWorkspaceContentsRefresh(paneId)
      return
    }

    if (event.type === 'error') {
      const message = sanitizeTerminalText(event.message).trim()
      streamErroredRef.current.add(paneId)
      mutatePane(paneId, (pane) => {
        const issueSummary = getProviderIssueSummary(pane.provider, message)
        const systemEntry: PaneLogEntry = {
          id: createId('log'),
          role: 'system',
          text: issueSummary?.displayMessage ?? message,
          createdAt: eventAt
        }

        return {
          ...pane,
          logs: appendLogEntry(pane.logs, systemEntry),
          status: issueSummary?.status ?? 'error',
          statusText: issueSummary?.statusText ?? statusLabel('error'),
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: issueSummary?.displayMessage ?? message,
          streamEntries: appendStreamEntry(pane.streamEntries, 'stderr', message, eventAt)
        }
      })
      scheduleWorkspaceContentsRefresh(paneId)
    }
  }

  const handleRun = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || isPaneBusyForExecution(pane) || controllersRef.current[paneId]) {
      return
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current, bootstrap?.sshHosts ?? [], panesRef.current)
    if (!target) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'ワークスペースを選択してください',
        lastError: 'ワークスペースが未設定です。'
      })
      return
    }

    const promptImages = paneImageAttachmentsRef.current[paneId] ?? []
    const prompt = pane.prompt.trim() || (promptImages.length > 0 ? '添付画像を確認してください。' : '')
    if (!prompt) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '指示または画像を追加してください',
        lastError: 'プロンプトが空です。画像のみで実行する場合は画像を添付してください。'
      })
      return
    }

    if (pane.provider === 'copilot' && promptImages.length > 0) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'Copilot では画像添付を使えません',
        lastError: 'GitHub Copilot CLI は画像入力未対応です。Codex CLI または Gemini CLI を選択してください。'
      })
      return
    }

    if (promptImages.some((attachment) => attachment.status === 'uploading')) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '画像の準備中です',
        lastError: '画像のアップロードが完了してから実行してください。'
      })
      return
    }

    const failedImage = promptImages.find((attachment) => attachment.status === 'error')
    if (failedImage) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '画像添付を確認してください',
        lastError: failedImage.error || `画像を準備できませんでした: ${failedImage.fileName}`
      })
      return
    }

    const readyImageAttachments: RunImageAttachment[] = promptImages.flatMap((attachment) =>
      attachment.status === 'ready' && attachment.localPath
        ? [{
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            localPath: attachment.localPath
          }]
        : []
    )

    if (promptImages.length > 0 && readyImageAttachments.length !== promptImages.length) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '画像の準備中です',
        lastError: '画像の準備が完了していないため、もう一度確認してください。'
      })
      return
    }

    const requestText = buildPromptWithImageSummary(prompt, readyImageAttachments)
    const startedAt = Date.now()
    const currentSessionScopeKey = buildPaneSessionScopeKey(pane)
    const resumeSessionId = pane.sessionScopeKey === currentSessionScopeKey ? pane.sessionId : null
    const userEntry: PaneLogEntry = {
      id: createId('log'),
      role: 'user',
      text: requestText,
      createdAt: startedAt
    }

    const memory = [...pane.logs, userEntry].slice(-8)
    const attachedContext = sharedContext.filter((item) => pane.attachedContextIds.includes(item.id))
    const consumedContextIds = attachedContext.map((item) => item.id)
    const sharedContextPayload = attachedContext.map((item) => ({
      sourcePaneTitle: item.sourcePaneTitle,
      provider: item.provider,
      workspaceLabel: item.workspaceLabel,
      summary: item.summary,
      detail: item.detail
    }))
    const controller = new AbortController()

    controllersRef.current[paneId] = controller
    stopRequestedRef.current.delete(paneId)
    streamErroredRef.current.delete(paneId)

    if (consumedContextIds.length > 0) {
      setSharedContext((current) =>
        current
          .flatMap((item) => {
            if (!consumedContextIds.includes(item.id)) {
              return [item]
            }

            const nextConsumedByPaneIds = item.consumedByPaneIds.includes(paneId)
              ? item.consumedByPaneIds
              : [...item.consumedByPaneIds, paneId]
            const nextTargetPaneIds = item.targetPaneIds.filter((id) => id !== paneId)
            const nextTargetPaneTitles = item.targetPaneTitles.filter((_, index) => item.targetPaneIds[index] !== paneId)

            if (item.scope === 'direct' || nextTargetPaneIds.length === 0) {
              return []
            }

            return [
              {
                ...item,
                targetPaneIds: nextTargetPaneIds,
                targetPaneTitles: nextTargetPaneTitles,
                consumedByPaneIds: nextConsumedByPaneIds
              }
            ]
          })
          .slice(0, MAX_SHARED_CONTEXT)
      )
    }

    mutatePane(paneId, (currentPane) => ({
      ...currentPane,
      prompt: '',
      logs: appendLogEntry(currentPane.logs, userEntry),
      status: 'running',
      statusText: '実行中',
      runInProgress: true,
      lastRunAt: startedAt,
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      lastResponse: null,
      selectedSessionKey: null,
      liveOutput: '',
      sessionId: resumeSessionId,
      sessionScopeKey: currentSessionScopeKey,
      currentRequestText: requestText,
      currentRequestAt: startedAt,
      stopRequested: false,
      stopRequestAvailable: true,
      attachedContextIds: currentPane.attachedContextIds.filter((item) => !consumedContextIds.includes(item)),
      streamEntries: appendStreamEntry([], 'system', `開始: ${currentPane.provider} / ${target.label}`, startedAt)
    }))
    queuePromptImageCleanup(paneId, readyImageAttachments.map((attachment) => attachment.localPath))
    clearPanePromptImages(paneId, { cleanupFiles: false })

    try {
      await runPaneStream(
        {
          paneId,
          provider: pane.provider,
          model: pane.model,
          reasoningEffort: pane.reasoningEffort,
          autonomyMode: pane.autonomyMode,
          codexFastMode: pane.codexFastMode,
          target,
          prompt,
          sessionId: resumeSessionId,
          memory,
          sharedContext: sharedContextPayload,
          imageAttachments: readyImageAttachments
        },
        (event) => handleStreamEvent(paneId, event),
        controller.signal
      )
    } catch (error) {
      const message = sanitizeTerminalText(error instanceof Error ? error.message : String(error)).trim()
      const stopped = controller.signal.aborted || stopRequestedRef.current.has(paneId)
      const streamErrored = streamErroredRef.current.delete(paneId)

      if (!stopped && !streamErrored) {
        const failedAt = Date.now()
        mutatePane(paneId, (currentPane) => {
          const issueSummary = getProviderIssueSummary(currentPane.provider, message)
          const fallbackAttentionMessage = 'ストリーム接続が途中で切れました。サーバー側で実行が残っている可能性があるため、必要なら停止再送を試してください。'
          const displayMessage = issueSummary?.displayMessage ?? fallbackAttentionMessage
          const systemEntry: PaneLogEntry = {
            id: createId('log'),
            role: 'system',
            text: displayMessage,
            createdAt: failedAt
          }

          const nextStreamEntries = appendStreamEntry(currentPane.streamEntries, 'stderr', message, failedAt)

          return {
            ...currentPane,
            logs: appendLogEntry(currentPane.logs, systemEntry),
            status: issueSummary?.status ?? 'attention',
            statusText: issueSummary?.statusText ?? 'ストリーム接続が途切れました',
            runInProgress: false,
            runningSince: null,
            stopRequested: false,
            stopRequestAvailable: true,
            lastActivityAt: failedAt,
            lastFinishedAt: failedAt,
            lastError: displayMessage,
            streamEntries:
              issueSummary && !currentPane.streamEntries.some((entry) => entry.kind === 'system' && entry.text === issueSummary.displayMessage)
                ? appendStreamEntry(nextStreamEntries, 'system', issueSummary.displayMessage, failedAt)
                : nextStreamEntries
          }
        })
        scheduleWorkspaceContentsRefresh(paneId)
      }

      if (stopped) {
        const stoppedAt = Date.now()
        mutatePane(paneId, (currentPane) => ({
          ...currentPane,
          status: 'attention',
          statusText: '停止しました',
          runInProgress: false,
          runningSince: null,
          stopRequested: false,
          stopRequestAvailable: false,
          lastActivityAt: stoppedAt,
          lastFinishedAt: stoppedAt,
          lastError: null,
          streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', '実行を停止しました', stoppedAt)
        }))
      }
    } finally {
      delete controllersRef.current[paneId]
      stopRequestedRef.current.delete(paneId)
      flushQueuedPromptImageCleanup(paneId)
    }
  }

  const handleStop = async (paneId: string) => {
    const hasLocalController = Boolean(controllersRef.current[paneId])

    if (hasLocalController) {
      stopRequestedRef.current.add(paneId)
    }

    mutatePane(paneId, (pane) => ({
      ...pane,
      stopRequested: true,
      stopRequestAvailable: true,
      statusText: '\u505c\u6b62\u8981\u6c42\u3092\u9001\u4fe1\u4e2d'
    }))

    try {
      const result = await stopPaneRun(paneId)

      if (hasLocalController) {
        controllersRef.current[paneId]?.abort()
        return
      }

      const completedAt = Date.now()
      mutatePane(paneId, (pane) => ({
        ...pane,
        status: result.stopped ? 'attention' : 'attention',
        statusText: result.stopped ? '\u505c\u6b62\u3057\u307e\u3057\u305f' : '\u505c\u6b62\u5bfe\u8c61\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f',
        runInProgress: false,
        runningSince: null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastActivityAt: completedAt,
        lastFinishedAt: result.stopped ? completedAt : pane.lastFinishedAt,
        lastError: result.stopped ? null : '\u30b5\u30fc\u30d0\u30fc\u5074\u3067\u505c\u6b62\u3067\u304d\u308b\u5b9f\u884c\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
        streamEntries: appendStreamEntry(
          pane.streamEntries,
          'system',
          result.stopped
            ? '\u30b5\u30fc\u30d0\u30fc\u5074\u306e\u5b9f\u884c\u306b\u505c\u6b62\u8981\u6c42\u3092\u9001\u4fe1\u3057\u3001\u505c\u6b62\u3057\u307e\u3057\u305f'
            : '\u30b5\u30fc\u30d0\u30fc\u5074\u3067\u505c\u6b62\u3067\u304d\u308b\u5b9f\u884c\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f',
          completedAt
        )
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      mutatePane(paneId, (pane) =>
        applyBackgroundActionFailure(
          {
            ...pane,
            stopRequested: false,
            stopRequestAvailable: pane.runInProgress || pane.stopRequestAvailable
          },
          '\u505c\u6b62\u8981\u6c42\u306e\u9001\u4fe1\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
          message,
          failedAt
        )
      )
    }
  }

  const handleAddPane = () => {
    if (!bootstrap) {
      return
    }

    const created = createInitialPane(panesRef.current.length, bootstrap, localWorkspacesRef.current)
    setPanes((current) => [...current, created])
    setFocusedPaneId(created.id)
    setSelectedPaneIds([])
  }

  const closeAllPaneAccordions = () => {
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        settingsOpen: false,
        workspaceOpen: false,
        shellOpen: false
      }))
    )
  }

  const deletePanesById = (paneIds: string[]) => {
    const ids = [...new Set(paneIds)]
    if (ids.length === 0) {
      return
    }

    clearMultiplePanePromptImages(ids)

    const removedContextIds = sharedContextRef.current
      .filter((item) => ids.includes(item.sourcePaneId))
      .map((item) => item.id)

    for (const paneId of ids) {
      stopRequestedRef.current.add(paneId)
      controllersRef.current[paneId]?.abort()
      delete controllersRef.current[paneId]
      shellStopRequestedRef.current.add(paneId)
      shellControllersRef.current[paneId]?.abort()
      delete shellControllersRef.current[paneId]
      void stopPaneRun(paneId).catch(() => undefined)
      void stopShellRun(paneId).catch(() => undefined)
    }

    setSharedContext((current) =>
      current
        .filter((item) => !ids.includes(item.sourcePaneId))
        .map((item) =>
          item.targetPaneIds.some((targetPaneId) => ids.includes(targetPaneId))
            ? {
                ...item,
                targetPaneIds: item.targetPaneIds.filter((id) => !ids.includes(id)),
                targetPaneTitles: item.targetPaneTitles.filter((_, index) => !ids.includes(item.targetPaneIds[index]))
              }
            : item
        )
        .filter((item) => item.scope !== 'direct' || item.targetPaneIds.length > 0)
    )

    let nextFocusId: string | null = null
    setPanes((current) => {
      const removedIndex = current.findIndex((pane) => ids.includes(pane.id))
      const remaining = current
        .filter((pane) => !ids.includes(pane.id))
        .map((pane) => ({
          ...pane,
          attachedContextIds: pane.attachedContextIds.filter((item) => !removedContextIds.includes(item))
        }))

      if (remaining.length === 0 && bootstrap) {
        const replacement = createInitialPane(0, bootstrap, localWorkspacesRef.current)
        nextFocusId = replacement.id
        return [replacement]
      }

      nextFocusId = remaining[Math.max(0, removedIndex - 1)]?.id ?? remaining[0]?.id ?? null
      return remaining
    })

    setFocusedPaneId(nextFocusId)
    setSelectedPaneIds([])
  }

  const handleDeletePane = (paneId: string) => {
    deletePanesById([paneId])
  }

  const handleDeleteSelectedPanes = () => {
    if (selectedPaneIds.length === 0) {
      return
    }

    const targetIds = panes
      .filter((pane) => selectedPaneIds.includes(pane.id))
      .map((pane) => pane.id)

    if (targetIds.length === 0) {
      return
    }

    const message =
      targetIds.length === 1
        ? '\u9078\u629e\u4e2d\u306e\u30da\u30a4\u30f3\u3092\u524a\u9664\u3057\u3066\u3082\u826f\u3044\u3067\u3059\u304b\uff1f'
        : `\u9078\u629e\u4e2d\u306e ${targetIds.length} \u500b\u306e\u30da\u30a4\u30f3\u3092\u524a\u9664\u3057\u3066\u3082\u826f\u3044\u3067\u3059\u304b\uff1f`

    if (!window.confirm(message)) {
      return
    }

    deletePanesById(targetIds)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || selectedPaneIds.length === 0) {
        return
      }

      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      handleDeleteSelectedPanes()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedPaneIds, panes])

  const handleDuplicatePane = (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const duplicated: PaneState = {
      ...pane,
      id: createId('pane'),
      title: `${pane.title} copy`,
      status: 'idle',
      statusText: statusLabel('idle'),
      runInProgress: false,
      prompt: '',
      logs: [],
      streamEntries: [],
      sessionHistory: [],
      selectedSessionKey: null,
      liveOutput: '',
      sessionId: null,
      sessionScopeKey: null,
      currentRequestText: null,
      currentRequestAt: null,
      stopRequested: false,
      stopRequestAvailable: false,
      sshActionState: 'idle',
      sshActionMessage: null,
      sshPasswordPulseAt: 0,
      lastRunAt: null,
      runningSince: null,
      lastActivityAt: null,
      lastFinishedAt: null,
      lastError: null,
      lastResponse: null
    }

    setPanes((current) => [...current, duplicated])
    setFocusedPaneId(duplicated.id)
  }

  const handleStartNewSession = (paneId: string) => {
    mutatePane(paneId, (pane) => {
      const nextHistory = hasSessionContent(pane)
        ? appendSessionRecord(pane.sessionHistory, createArchivedSessionRecord(pane))
        : pane.sessionHistory

      return {
        ...resetActiveSessionFields(pane),
        sessionHistory: nextHistory
      }
    })
  }

  const handleResetSession = (paneId: string) => {
    mutatePane(paneId, (pane) => resetActiveSessionFields(pane))
  }

  const handleSelectSession = (paneId: string, sessionKey: string | null) => {
    mutatePane(paneId, (pane) => ({
      ...pane,
      selectedSessionKey: sessionKey
    }))
  }

  const handleResumeSession = (paneId: string, sessionKey: string | null) => {
    if (!sessionKey) {
      return
    }

    mutatePane(paneId, (pane) => {
      const selectedSession = pane.sessionHistory.find((session) => session.key === sessionKey)
      if (!selectedSession?.sessionId) {
        return pane
      }

      const latestUser = [...selectedSession.logs].reverse().find((entry) => entry.role === 'user') ?? null
      const latestAssistant = [...selectedSession.logs].reverse().find((entry) => entry.role === 'assistant') ?? null

      return {
        ...pane,
        prompt: '',
        status: 'idle',
        statusText: statusLabel('idle'),
        runInProgress: false,
        logs: selectedSession.logs.slice(-MAX_LOGS),
        streamEntries: selectedSession.streamEntries.slice(-MAX_STREAM_ENTRIES),
        selectedSessionKey: null,
        liveOutput: '',
        sessionId: selectedSession.sessionId,
        sessionScopeKey: buildPaneSessionScopeKey(pane),
        currentRequestText: latestUser?.text ?? null,
        currentRequestAt: latestUser?.createdAt ?? null,
        stopRequested: false,
        stopRequestAvailable: false,
        lastRunAt: selectedSession.updatedAt,
        runningSince: null,
        lastActivityAt: selectedSession.updatedAt,
        lastFinishedAt: selectedSession.updatedAt,
        lastError: null,
        lastResponse: latestAssistant?.text ?? null
      }
    })
  }

  const copyPaneText = async (paneId: string, text: string | null, _successMessage: string): Promise<boolean> => {
    if (!text?.trim()) {
      return false
    }

    try {
      await writeClipboardText(text)
      return true
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: '\u30b3\u30d4\u30fc\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        lastError: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const handleCopyOutput = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    await copyPaneText(paneId, pane ? getPaneOutputText(pane) : null, '\u51fa\u529b\u3092\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f')
  }

  const handleCopyProviderCommand = async (paneId: string, text: string, successMessage: string) => {
    return copyPaneText(paneId, text, successMessage)
  }

  const handleCopyText = async (paneId: string, text: string, successMessage: string) => {
    return copyPaneText(paneId, text, successMessage)
  }

  const handleClearSelectedSessionHistory = (paneId: string, sessionKey: string | null) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const confirmMessage = sessionKey ? '選択中のセッション履歴をクリアしますか？' : '現在のセッション履歴をクリアしますか？'
    if (!window.confirm(confirmMessage)) {
      return
    }

    mutatePane(paneId, (currentPane) => {
      if (sessionKey) {
        return {
          ...currentPane,
          sessionHistory: currentPane.sessionHistory.filter((session) => session.key !== sessionKey),
          selectedSessionKey: currentPane.selectedSessionKey === sessionKey ? null : currentPane.selectedSessionKey
        }
      }

      return resetActiveSessionFields(currentPane)
    })
  }

  const handleClearAllSessionHistory = (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    if (!hasSessionContent(pane) && pane.sessionHistory.length === 0) {
      return
    }

    if (!window.confirm('このペインの会話履歴とストリーム履歴をすべてクリアしますか？')) {
      return
    }

    mutatePane(paneId, (currentPane) => ({
      ...resetActiveSessionFields(currentPane),
      sessionHistory: []
    }))
  }

  const handleBrowseLocal = async (paneId: string, targetPath: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const workspaceRoot = pane.localWorkspacePath.trim()
    const nextPath = workspaceRoot ? clampLocalPathToWorkspace(targetPath, workspaceRoot) : targetPath.trim()
    if (!nextPath) {
      return
    }

    updatePane(paneId, {
      localBrowserLoading: true
    })

    try {
      const payload = await browseLocalDirectory(nextPath)
      mutatePane(paneId, (pane) => ({
        ...pane,
        localBrowserLoading: false,
        localBrowserPath: payload.path,
        localBrowserEntries: payload.entries,
        lastError: null
      }))
    } catch (error) {
      updatePane(paneId, {
        localBrowserLoading: false,
        status: 'error',
        statusText: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u306e\u5185\u5bb9\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleSelectLocalWorkspace = async (paneId: string, workspacePath: string) => {
    const selectedPath = workspacePath.trim()
    if (!selectedPath) {
      return
    }

    updatePane(paneId, {
      workspaceMode: 'local',
      localWorkspacePath: selectedPath,
      localBrowserPath: '',
      localBrowserEntries: [],
      localBrowserLoading: true
    })

    try {
      const payload = await browseLocalDirectory(selectedPath)
      const nextWorkspacePath = payload.path.trim() || selectedPath
      mutatePane(paneId, (pane) => ({
        ...pane,
        workspaceMode: 'local',
        localWorkspacePath: nextWorkspacePath,
        localBrowserPath: nextWorkspacePath,
        localBrowserEntries: payload.entries,
        localShellPath: nextWorkspacePath,
        localBrowserLoading: false,
        lastError: null
      }))
    } catch (error) {
      updatePane(paneId, {
        localBrowserLoading: false,
        status: 'error',
        statusText: '\u30d5\u30a9\u30eb\u30c0\u5185\u5bb9\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleBrowseWorkspacePicker = async (targetPath: string) => {
    const normalizedTargetPath = targetPath.trim()
    if (!workspacePicker || !normalizedTargetPath) {
      return
    }

    setWorkspacePicker((current) =>
      current
        ? {
            ...current,
            loading: true,
            error: null
          }
        : current
    )

    try {
      if (workspacePicker.mode === 'local') {
        const payload = await browseLocalDirectory(normalizedTargetPath)
        setWorkspacePicker((current) =>
          current
            ? {
                ...current,
                path: payload.path,
                entries: payload.entries.filter((entry) => entry.isDirectory).map((entry) => ({
                  label: entry.label,
                  path: entry.path
                })),
                loading: false,
                error: null
              }
            : current
        )
      } else {
        const pane = panesRef.current.find((item) => item.id === workspacePicker.paneId)
        if (!pane || !pane.sshHost.trim()) {
          throw new Error('SSH 接続先が未設定です。')
        }

        const payload = await browseRemoteDirectory(
          pane.sshHost.trim(),
          normalizedTargetPath,
          buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
        )

        setWorkspacePicker((current) =>
          current
            ? {
                ...current,
                path: payload.path,
                entries: payload.entries.filter((entry) => entry.isDirectory).map((entry) => ({
                  label: entry.label,
                  path: entry.path,
                  isWorkspace: entry.isWorkspace
                })),
                roots: buildRemoteWorkspacePickerRoots(bootstrap?.remoteRoots ?? [], payload.homeDirectory),
                loading: false,
                error: null
              }
            : current
        )
      }
    } catch (error) {
      setWorkspacePicker((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error)
            }
          : current
      )
    }
  }

  const handleOpenWorkspacePicker = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    const startPath = pane?.localWorkspacePath || localWorkspacesRef.current[0]?.path || ''

    setWorkspacePicker({
      mode: 'local',
      paneId,
      path: startPath,
      entries: [],
      roots: [],
      loading: true,
      error: null
    })

    try {
      const [rootsPayload, directoryPayload] = await Promise.all([
        fetchLocalBrowseRoots(),
        browseLocalDirectory(startPath)
      ])

      setWorkspacePicker({
        mode: 'local',
        paneId,
        path: directoryPayload.path,
        entries: directoryPayload.entries.filter((entry) => entry.isDirectory).map((entry) => ({
          label: entry.label,
          path: entry.path
        })),
        roots: rootsPayload.roots,
        loading: false,
        error: null
      })
    } catch (error) {
      setWorkspacePicker({
        mode: 'local',
        paneId,
        path: startPath,
        entries: [],
        roots: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleOpenRemoteWorkspacePicker = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '先にリモートに接続してください',
        lastError: 'リモートワークスペースを選択する前に SSH 接続が必要です。'
      })
      return
    }

    const startPath = pane.remoteWorkspacePath || pane.remoteBrowserPath || pane.remoteHomeDirectory || '~'
    const roots = buildRemoteWorkspacePickerRoots(bootstrap?.remoteRoots ?? [], pane.remoteHomeDirectory)

    setWorkspacePicker({
      mode: 'ssh',
      paneId,
      path: startPath,
      entries: [],
      roots,
      loading: true,
      error: null
    })

    try {
      const payload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        startPath,
        buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
      )

      setWorkspacePicker({
        mode: 'ssh',
        paneId,
        path: payload.path,
        entries: payload.entries.filter((entry) => entry.isDirectory).map((entry) => ({
          label: entry.label,
          path: entry.path,
          isWorkspace: entry.isWorkspace
        })),
        roots: buildRemoteWorkspacePickerRoots(bootstrap?.remoteRoots ?? [], payload.homeDirectory),
        loading: false,
        error: null
      })
    } catch (error) {
      setWorkspacePicker({
        mode: 'ssh',
        paneId,
        path: startPath,
        entries: [],
        roots,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleConfirmWorkspacePicker = async () => {
    if (!workspacePicker?.path) {
      return
    }

    if (workspacePicker.mode === 'local') {
      const workspace = buildLocalWorkspaceRecord(workspacePicker.path)
      setLocalWorkspaces((current) => mergeLocalWorkspaces([workspace], current))
      await handleSelectLocalWorkspace(workspacePicker.paneId, workspace.path)
    } else {
      const selectedPath = workspacePicker.path
      updatePane(workspacePicker.paneId, {
        workspaceMode: 'ssh',
        remoteWorkspacePath: selectedPath,
        sshRemotePath: selectedPath,
        remoteShellPath: selectedPath,
        status: 'idle',
        statusText: 'リモートワークスペースを選択しました',
        lastError: null
      })
      void handleBrowseRemote(workspacePicker.paneId, selectedPath)
    }

    setWorkspacePicker(null)
  }

  const handleAddLocalWorkspace = async (paneId: string) => {
    await handleOpenWorkspacePicker(paneId)
  }

  const handleCreateWorkspacePickerDirectory = async () => {
    if (!workspacePicker?.path || workspacePicker.loading) {
      return
    }

    const folderName = window.prompt('作成するフォルダ名', '')
    if (folderName === null) {
      return
    }

    const trimmedName = folderName.trim()
    if (!trimmedName) {
      setWorkspacePicker((current) =>
        current
          ? {
              ...current,
              error: '新しいフォルダ名を入力してください。'
            }
          : current
      )
      return
    }

    const parentPath = workspacePicker.path
    setWorkspacePicker((current) =>
      current
        ? {
            ...current,
            loading: true,
            error: null
          }
        : current
    )

    try {
      if (workspacePicker.mode === 'local') {
        const payload = await createLocalDirectory(parentPath, trimmedName)
        const directoryPayload = await browseLocalDirectory(payload.path)
        setWorkspacePicker((current) =>
          current
            ? {
                ...current,
                path: directoryPayload.path,
                entries: directoryPayload.entries.filter((entry) => entry.isDirectory).map((entry) => ({
                  label: entry.label,
                  path: entry.path
                })),
                loading: false,
                error: null
              }
            : current
        )
      } else {
        const pane = panesRef.current.find((item) => item.id === workspacePicker.paneId)
        if (!pane || !pane.sshHost.trim()) {
          throw new Error('SSH 接続先が未設定です。')
        }

        const payload = await createRemoteDirectory(
          pane.sshHost.trim(),
          parentPath,
          trimmedName,
          buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
        )
        const directoryPayload = await browseRemoteDirectory(
          pane.sshHost.trim(),
          payload.path,
          buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
        )

        setWorkspacePicker((current) =>
          current
            ? {
                ...current,
                path: directoryPayload.path,
                entries: directoryPayload.entries.filter((entry) => entry.isDirectory).map((entry) => ({
                  label: entry.label,
                  path: entry.path,
                  isWorkspace: entry.isWorkspace
                })),
                roots: buildRemoteWorkspacePickerRoots(bootstrap?.remoteRoots ?? [], directoryPayload.homeDirectory),
                loading: false,
                error: null
              }
            : current
        )
      }
    } catch (error) {
      setWorkspacePicker((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error)
            }
          : current
      )
    }
  }

  const handleRemoveLocalWorkspace = (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const targetWorkspace = localWorkspacesRef.current.find((item) => item.path === pane.localWorkspacePath)
    if (!targetWorkspace || targetWorkspace.source !== 'manual') {
      return
    }

    const nextWorkspaces = mergeLocalWorkspaces(
      bootstrap?.localWorkspaces ?? [],
      getManualWorkspaces(localWorkspacesRef.current).filter((item) => item.path !== targetWorkspace.path)
    )
    const fallbackPath = nextWorkspaces[0]?.path ?? ''

    setLocalWorkspaces(nextWorkspaces)
    setPanes((current) =>
      current.map((item) =>
        item.localWorkspacePath === targetWorkspace.path
          ? {
              ...item,
              localWorkspacePath: fallbackPath,
              localBrowserPath: '',
              localBrowserEntries: [],
              localShellPath: fallbackPath
            }
          : item
      )
    )
  }

  const handleOpenWorkspace = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current, bootstrap?.sshHosts ?? [], panesRef.current)
    if (!target) {
      return
    }

    try {
      await openWorkspaceInVsCode(target)
      const completedAt = Date.now()
      mutatePane(paneId, (currentPane) => applyBackgroundActionSuccess(currentPane, 'VSCode \u3092\u8d77\u52d5\u3057\u307e\u3057\u305f', completedAt))
    } catch (error) {
      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      mutatePane(paneId, (currentPane) => applyBackgroundActionFailure(currentPane, 'VSCode \u306e\u8d77\u52d5\u306b\u5931\u6557\u3057\u307e\u3057\u305f', message, failedAt))
    }
  }

  const handleOpenFileManager = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || pane.workspaceMode !== 'local') {
      return
    }

    const targetPath = pane.localBrowserPath.trim() || pane.localWorkspacePath.trim()
    if (!targetPath) {
      return
    }

    try {
      await openTargetInFileManager({
        kind: 'local',
        path: targetPath,
        label: targetPath,
        resourceType: 'folder'
      })
      const completedAt = Date.now()
      mutatePane(paneId, (currentPane) => applyBackgroundActionSuccess(currentPane, 'Explorer を起動しました', completedAt))
    } catch (error) {
      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      mutatePane(paneId, (currentPane) => applyBackgroundActionFailure(currentPane, 'Explorer の起動に失敗しました', message, failedAt))
    }
  }

  const handleOpenCommandPrompt = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current, bootstrap?.sshHosts ?? [], panesRef.current)
    if (!target) {
      return
    }

    try {
      await openTargetInCommandPrompt(target)
      const completedAt = Date.now()
      mutatePane(paneId, (currentPane) => applyBackgroundActionSuccess(currentPane, '\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8d77\u52d5\u3057\u307e\u3057\u305f', completedAt))
    } catch (error) {
      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      mutatePane(paneId, (currentPane) => applyBackgroundActionFailure(currentPane, '\u30bf\u30fc\u30df\u30ca\u30eb\u306e\u8d77\u52d5\u306b\u5931\u6557\u3057\u307e\u3057\u305f', message, failedAt))
    }
  }

  const handleRunShell = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const command = pane.shellCommand.trim()
    if (!command) {
      updatePane(paneId, {
        shellCommand: '',
        shellHistoryIndex: null,
        shellLastError: null
      })
      return
    }

    if (/^(clear|cls)$/i.test(command)) {
      updatePane(paneId, {
        shellCommand: '',
        shellHistoryIndex: null,
        shellOutput: '',
        shellLastExitCode: null,
        shellLastError: null,
        shellLastRunAt: Date.now()
      })
      return
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current, bootstrap?.sshHosts ?? [], panesRef.current)
    if (!target) {
      mutatePane(paneId, (current) => ({
        ...current,
        shellCommand: '',
        shellHistoryIndex: null,
        shellLastError: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u307e\u305f\u306f SSH \u63a5\u7d9a\u3092\u8a2d\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044',
        shellOutput: appendShellOutputLine(current.shellOutput, '[error] \u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u307e\u305f\u306f SSH \u63a5\u7d9a\u3092\u8a2d\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044'),
        shellLastRunAt: Date.now()
      }))
      return
    }

    if (!bootstrap?.features.shell) {
      mutatePane(paneId, (current) => ({
        ...current,
        shellCommand: '',
        shellHistoryIndex: null,
        shellLastError: '\u7c21\u6613\u5185\u8535\u30bf\u30fc\u30df\u30ca\u30eb API \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002TAKO \u306e\u30b5\u30fc\u30d0\u30fc\u3092\u518d\u8d77\u52d5\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
        shellOutput: appendShellOutputLine(current.shellOutput, '[error] \u7c21\u6613\u5185\u8535\u30bf\u30fc\u30df\u30ca\u30eb API \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002TAKO \u306e\u30b5\u30fc\u30d0\u30fc\u3092\u518d\u8d77\u52d5\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
        shellLastRunAt: Date.now()
      }))
      return
    }

    if (shellControllersRef.current[paneId]) {
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
    shellControllersRef.current[paneId] = controller
    shellStopRequestedRef.current.delete(paneId)

    updatePane(paneId, {
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
          mutatePane(paneId, (current) => {
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
      if (!shellStopRequestedRef.current.has(paneId)) {
        const message = error instanceof Error ? error.message : String(error)
        mutatePane(paneId, (current) => ({
          ...current,
          shellRunning: false,
          shellLastError: message,
          shellOutput: appendShellOutputLine(current.shellOutput, `[error] ${message}`),
          shellLastRunAt: Date.now()
        }))
      }
    } finally {
      delete shellControllersRef.current[paneId]
      shellStopRequestedRef.current.delete(paneId)
      mutatePane(paneId, (current) => ({
        ...current,
        shellRunning: false
      }))
    }
  }

  const handleStopShell = async (paneId: string) => {
    shellStopRequestedRef.current.add(paneId)
    shellControllersRef.current[paneId]?.abort()
    delete shellControllersRef.current[paneId]

    try {
      await stopShellRun(paneId)
    } catch {
      // ignore best-effort stop
    }

    mutatePane(paneId, (pane) => ({
      ...pane,
      shellRunning: false,
      shellLastError: null,
      shellOutput: appendShellOutputLine(pane.shellOutput, '^C'),
      shellLastRunAt: Date.now()
    }))
  }

  const handleOpenPathInVsCode = async (paneId: string, path: string, resourceType: 'folder' | 'file') => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !path.trim()) {
      return
    }

    const resolvedPath =
      pane.workspaceMode === 'local'
        ? resolveLinkedLocalPath(path, pane.localWorkspacePath.trim())
        : resolveLinkedRemotePath(path, pane.remoteWorkspacePath.trim())

    if (!resolvedPath) {
      return
    }

    const target: WorkspaceTarget =
      pane.workspaceMode === 'local'
        ? {
            kind: 'local',
            path: resolvedPath,
            label: resolvedPath,
            resourceType,
            workspacePath: pane.localWorkspacePath.trim()
          }
        : {
            kind: 'ssh',
            host: pane.sshHost.trim(),
            path: resolvedPath,
            label: buildSshLabel(pane.sshHost.trim(), resolvedPath, buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)),
            resourceType,
            workspacePath: pane.remoteWorkspacePath.trim(),
            connection: buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
          }

    try {
      await openWorkspaceInVsCode(target)
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: 'VSCode \u306e\u8d77\u52d5\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleLoadRemote = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH ホストを入力してください',
        lastError: 'SSH ホストが未設定です。'
      })
      return
    }

    const host = pane.sshHost.trim()
    const connection = buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
    const requestedBrowsePath = pane.remoteBrowserPath || pane.remoteWorkspacePath || undefined
    const startedAt = Date.now()
    updatePane(paneId, {
      status: 'running',
      statusText: 'SSH 接続を確認中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      remoteBrowserLoading: true,
      sshActionState: 'running',
      sshActionMessage: `${host} に接続しています...`
    })

    try {
      let browsePayload: Awaited<ReturnType<typeof browseRemoteDirectory>> | null = null
      let browseFallbackWarning: string | null = null

      try {
        browsePayload = await browseRemoteDirectory(host, requestedBrowsePath, connection)
      } catch (error) {
        if (!requestedBrowsePath) {
          throw error
        }

        try {
          browsePayload = await browseRemoteDirectory(host, undefined, connection)
          browseFallbackWarning = `指定したリモートパスを開けなかったため、ホームディレクトリを表示しています: ${requestedBrowsePath}`
        } catch {
          throw error
        }
      }

      if (!browsePayload) {
        throw new Error('remote browse failed')
      }

      const browseCompletedAt = Date.now()
      setPanes((current) =>
        current.map((item) => {
          if (item.id !== paneId) {
            return item
          }

          const nextRemoteWorkspacePath = browseFallbackWarning ? '' : item.remoteWorkspacePath.trim()
          const nextDiagnostics = browseFallbackWarning
            ? Array.from(new Set([...item.sshDiagnostics, browseFallbackWarning]))
            : item.sshDiagnostics

          return {
            ...item,
            remoteBrowserLoading: false,
            remoteBrowserPath: browsePayload.path,
            remoteParentPath: browsePayload.parentPath,
            remoteBrowserEntries: browsePayload.entries,
            remoteHomeDirectory: browsePayload.homeDirectory ?? item.remoteHomeDirectory,
            remoteWorkspacePath: nextRemoteWorkspacePath,
            sshRemotePath: item.sshRemotePath || nextRemoteWorkspacePath || browsePayload.path,
            remoteShellPath: item.remoteShellPath || nextRemoteWorkspacePath || browsePayload.path,
            sshDiagnostics: nextDiagnostics,
            status: browseFallbackWarning ? 'attention' : 'idle',
            statusText: browseFallbackWarning ? 'SSH に接続しましたがホームを表示しています' : 'SSH に接続しました',
            runningSince: null,
            lastActivityAt: browseCompletedAt,
            lastFinishedAt: browseCompletedAt,
            lastError: browseFallbackWarning,
            sshActionState: 'success',
            sshActionMessage: `${host} に接続しました`
          }
        })
      )

      const [workspaceResult, inspectionResult] = await Promise.allSettled([
        fetchRemoteWorkspaces(host, connection),
        inspectSshHost(host, connection)
      ])

      const workspacePayload = workspaceResult.status === 'fulfilled' ? workspaceResult.value : null
      const inspectionPayload = inspectionResult.status === 'fulfilled' ? inspectionResult.value : null
      const failedPartLabels = [
        workspaceResult.status === 'rejected' ? 'ワークスペース一覧' : null,
        inspectionResult.status === 'rejected' ? '接続診断 / CLI確認' : null
      ].filter((item): item is string => Boolean(item))
      const partialErrors = [
        workspaceResult.status === 'rejected'
          ? `ワークスペース一覧の取得に失敗しました: ${workspaceResult.reason instanceof Error ? workspaceResult.reason.message : String(workspaceResult.reason)}`
          : null,
        inspectionResult.status === 'rejected'
          ? `接続診断 / CLI確認の取得に失敗しました: ${inspectionResult.reason instanceof Error ? inspectionResult.reason.message : String(inspectionResult.reason)}`
          : null,
        browseFallbackWarning
      ].filter((item): item is string => Boolean(item))

      setPanes((current) =>
        current.map((item) => {
          if (item.id !== paneId) {
            return item
          }

          const nextProvider =
            inspectionPayload && inspectionPayload.availableProviders.length > 0 && !inspectionPayload.availableProviders.includes(item.provider)
              ? inspectionPayload.availableProviders[0]
              : item.provider
          const nextModel =
            nextProvider !== item.provider && bootstrap
              ? bootstrap.providers[nextProvider].models[0]?.id ?? item.model
              : item.model
          const updatedAt = Date.now()
          const nextLocalKeys = mergeLocalSshKeys(inspectionPayload?.localKeys ?? [], item.sshLocalKeys)
          const selectedKey = getPreferredLocalSshKey({ ...item, sshLocalKeys: nextLocalKeys }, nextLocalKeys, current)
          const availableProviders = inspectionPayload?.availableProviders ?? item.remoteAvailableProviders
          const currentRemoteWorkspacePath = item.remoteWorkspacePath.trim()
          const nextRemoteWorkspacePath = browseFallbackWarning ? '' : currentRemoteWorkspacePath
          const mergedDiagnostics = Array.from(new Set([
            ...(inspectionPayload?.diagnostics ?? item.sshDiagnostics),
            ...partialErrors
          ]))
          const hasPartialFailure = partialErrors.length > 0
          const noRemoteProviderDetected = Boolean(inspectionPayload && inspectionPayload.availableProviders.length === 0)

          return {
            ...item,
            provider: nextProvider,
            model: nextModel,
            sshUser: item.sshUser || inspectionPayload?.suggestedUser || '',
            sshPort: item.sshPort || inspectionPayload?.suggestedPort || '',
            sshIdentityFile: selectedKey?.privateKeyPath || item.sshIdentityFile || inspectionPayload?.suggestedIdentityFile || '',
            sshProxyJump: item.sshProxyJump || inspectionPayload?.suggestedProxyJump || '',
            sshProxyCommand: item.sshProxyCommand || inspectionPayload?.suggestedProxyCommand || '',
            sshLocalKeys: nextLocalKeys,
            sshSelectedKeyPath: selectedKey?.privateKeyPath ?? '',
            sshPublicKeyText: selectedKey?.publicKey ?? item.sshPublicKeyText,
            sshKeyName: selectedKey?.name ?? item.sshKeyName,
            sshKeyComment: selectedKey?.comment ?? item.sshKeyComment,
            sshDiagnostics: mergedDiagnostics,
            sshLocalPath: item.sshLocalPath || localWorkspacesRef.current[0]?.path || '',
            sshRemotePath: item.sshRemotePath || nextRemoteWorkspacePath || browsePayload.path,
            remoteShellPath: item.remoteShellPath || nextRemoteWorkspacePath || browsePayload.path,
            remoteWorkspaces: workspacePayload?.workspaces ?? item.remoteWorkspaces,
            remoteAvailableProviders: availableProviders,
            remoteHomeDirectory: inspectionPayload?.homeDirectory ?? browsePayload.homeDirectory ?? item.remoteHomeDirectory,
            remoteBrowserLoading: false,
            remoteBrowserPath: browsePayload.path,
            remoteParentPath: browsePayload.parentPath,
            remoteBrowserEntries: browsePayload.entries,
            remoteWorkspacePath: nextRemoteWorkspacePath,
            status: hasPartialFailure || noRemoteProviderDetected ? 'attention' : 'idle',
            statusText: hasPartialFailure ? `SSH に接続しましたが ${failedPartLabels.join(' / ')} の取得に失敗しました` : noRemoteProviderDetected ? 'SSH 接続済み / CLI 未検出' : 'SSH を更新しました',
            runningSince: null,
            lastActivityAt: updatedAt,
            lastFinishedAt: updatedAt,
            lastError: hasPartialFailure ? partialErrors.join('\n') : null,
            sshActionState: hasPartialFailure ? 'error' : 'success',
            sshActionMessage: hasPartialFailure ? `${host} への接続は成功しましたが、${failedPartLabels.join(' / ')} の取得に失敗しました` : noRemoteProviderDetected ? `${host} に接続しました。CLI を確認してください` : `${host} の接続情報を更新しました`
          }
        })
      )
    } catch (error) {
      const failedAt = Date.now()
      updatePane(paneId, {
        status: 'error',
        statusText: 'SSH 接続に失敗しました',
        runningSince: null,
        remoteBrowserLoading: false,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: error instanceof Error ? error.message : String(error),
        sshActionState: 'error',
        sshActionMessage: `SSH 接続に失敗しました: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  const handleBrowseRemote = async (paneId: string, nextPath?: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH \u30db\u30b9\u30c8\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044',
        lastError: 'SSH \u30db\u30b9\u30c8\u304c\u672a\u8a2d\u5b9a\u3067\u3059\u3002'
      })
      return
    }

    updatePane(paneId, {
      remoteBrowserLoading: true
    })

    try {
      const browsePayload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        nextPath || pane.remoteBrowserPath || pane.remoteHomeDirectory || undefined,
        buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
      )
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        remoteBrowserLoading: false,
        remoteHomeDirectory: browsePayload.homeDirectory,
        remoteBrowserPath: browsePayload.path,
        remoteParentPath: browsePayload.parentPath,
        remoteBrowserEntries: browsePayload.entries,
        sshRemotePath: currentPane.sshRemotePath || browsePayload.path,
        lastError: null
      }))
    } catch (error) {
      updatePane(paneId, {
        remoteBrowserLoading: false,
        status: 'error',
        statusText: 'SSH \u4e00\u89a7\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleCreateRemoteDirectory = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim() || !pane.remoteBrowserPath.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '\u4f5c\u6210\u5148\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044',
        lastError: '\u30ea\u30e2\u30fc\u30c8\u4e00\u89a7\u3092\u8868\u793a\u3057\u3066\u304b\u3089\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
      })
      return
    }

    const folderName = window.prompt('\u4f5c\u6210\u3059\u308b\u30d5\u30a9\u30eb\u30c0\u540d', '')
    if (folderName === null) {
      return
    }

    const trimmedName = folderName.trim()
    if (!trimmedName) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '\u30d5\u30a9\u30eb\u30c0\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044',
        lastError: '\u65b0\u898f\u30d5\u30a9\u30eb\u30c0\u540d\u304c\u7a7a\u3067\u3059\u3002'
      })
      return
    }

    const startedAt = Date.now()
    updatePane(paneId, {
      remoteBrowserLoading: true,
      status: 'running',
      statusText: '\u30d5\u30a9\u30eb\u30c0\u3092\u4f5c\u6210\u4e2d',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null
    })

    try {
      const payload = await createRemoteDirectory(
        pane.sshHost.trim(),
        pane.remoteBrowserPath.trim(),
        trimmedName,
        buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
      )
      const browsePayload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        pane.remoteBrowserPath.trim(),
        buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
      )
      const finishedAt = Date.now()
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        remoteBrowserLoading: false,
        remoteBrowserPath: browsePayload.path,
        remoteParentPath: browsePayload.parentPath,
        remoteBrowserEntries: browsePayload.entries,
        sshRemotePath: payload.path,
        status: 'completed',
        statusText: '\u30d5\u30a9\u30eb\u30c0\u3092\u4f5c\u6210\u3057\u307e\u3057\u305f',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', `\u30d5\u30a9\u30eb\u30c0\u4f5c\u6210: ${payload.path}`, finishedAt)
      }))
    } catch (error) {
      updatePane(paneId, {
        remoteBrowserLoading: false,
        status: 'error',
        statusText: '\u30d5\u30a9\u30eb\u30c0\u4f5c\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        runningSince: null,
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleGenerateSshKey = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const keyName = pane.sshKeyName.trim() || 'id_ed25519'
    const keyComment = pane.sshKeyComment.trim() || 'tako-cli-dev-tool'
    const startedAt = Date.now()
    updatePane(paneId, {
      status: 'running',
      statusText: 'SSH 鍵を生成中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: 'SSH 鍵を生成中です...'
    })

    try {
      const result = await generateSshKey(keyName, keyComment, '')
      const finishedAt = Date.now()
      mutatePane(paneId, (pane) => ({
        ...pane,
        sshLocalKeys: [result.key, ...pane.sshLocalKeys.filter((item) => item.privateKeyPath !== result.key.privateKeyPath)],
        sshSelectedKeyPath: result.key.privateKeyPath,
        sshIdentityFile: result.key.privateKeyPath,
        sshPublicKeyText: result.key.publicKey,
        sshKeyName: result.key.name,
        sshKeyComment: result.key.comment,
        sshDiagnostics: [
          ...pane.sshDiagnostics.filter((item) => !item.startsWith('\u30ed\u30fc\u30ab\u30eb\u9375:') && !item.startsWith('ローカルの ~/.ssh に利用可能な鍵がありません')),
          `\u30ed\u30fc\u30ab\u30eb\u9375: ${result.key.privateKeyPath}`
        ],
        sshActionState: 'success',
        sshActionMessage: result.created ? `SSH 鍵を生成しました: ${result.key.privateKeyPath}` : `既存の SSH 鍵を選択しました: ${result.key.privateKeyPath}`,
        status: 'completed',
        statusText: result.created ? 'SSH 鍵を生成しました' : '既存の SSH 鍵を選択しました',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        streamEntries: appendStreamEntry(pane.streamEntries, 'system', result.created ? `SSH 鍵を生成しました: ${result.key.privateKeyPath}` : `既存の SSH 鍵を選択しました: ${result.key.privateKeyPath}`, finishedAt)
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      updatePane(paneId, {
        status: 'error',
        statusText: 'SSH \u9375\u306e\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `SSH 鍵の生成に失敗しました: ${message}`
      })
    }
  }

  const handleDeleteSshKey = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    const selectedKey = pane?.sshLocalKeys.find((item) => item.privateKeyPath === pane.sshSelectedKeyPath) ?? null
    if (!pane || !selectedKey) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '削除する SSH 鍵を選択してください',
        lastError: '選択中のローカル SSH 鍵がありません。',
        sshActionState: 'error',
        sshActionMessage: '削除する SSH 鍵を選択してください。'
      })
      return
    }

    if (!window.confirm(`次の SSH 鍵を削除しますか？\n${selectedKey.privateKeyPath}`)) {
      return
    }

    const startedAt = Date.now()
    updatePane(paneId, {
      status: 'running',
      statusText: 'SSH 鍵を削除中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: `SSH 鍵を削除しています: ${selectedKey.privateKeyPath}`
    })

    try {
      const result = await deleteSshKey(selectedKey.privateKeyPath)
      const finishedAt = Date.now()
      mutatePane(paneId, (currentPane) => {
        const nextSelectedKey = result.remainingKeys.find((item) => item.privateKeyPath === currentPane.sshSelectedKeyPath) ?? result.remainingKeys[0] ?? null
        const nextIdentityFile = currentPane.sshIdentityFile === selectedKey.privateKeyPath
          ? nextSelectedKey?.privateKeyPath ?? ''
          : currentPane.sshIdentityFile
        const nextDiagnostics = [
          ...currentPane.sshDiagnostics.filter((item) => !item.startsWith('\u30ed\u30fc\u30ab\u30eb\u9375:') && !item.startsWith('ローカルの ~/.ssh に利用可能な鍵がありません')),
          ...(nextSelectedKey ? [`\u30ed\u30fc\u30ab\u30eb\u9375: ${nextSelectedKey.privateKeyPath}`] : ['ローカルの ~/.ssh に利用可能な鍵がありません。必要ならここから生成してください。'])
        ]

        return {
          ...currentPane,
          sshLocalKeys: result.remainingKeys,
          sshSelectedKeyPath: nextSelectedKey?.privateKeyPath ?? '',
          sshIdentityFile: nextIdentityFile,
          sshPublicKeyText: nextSelectedKey?.publicKey ?? '',
          sshKeyName: nextSelectedKey?.name ?? 'id_ed25519',
          sshKeyComment: nextSelectedKey?.comment ?? 'tako-cli-dev-tool',
          sshDiagnostics: nextDiagnostics,
          sshActionState: 'success',
          sshActionMessage: result.deleted ? `SSH 鍵を削除しました: ${selectedKey.privateKeyPath}` : `SSH 鍵は既に削除されていました: ${selectedKey.privateKeyPath}`,
          status: 'completed',
          statusText: result.deleted ? 'SSH 鍵を削除しました' : 'SSH 鍵は既に削除済みでした',
          runningSince: null,
          lastActivityAt: finishedAt,
          lastFinishedAt: finishedAt,
          lastError: null,
          streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', result.deleted ? `SSH 鍵を削除しました: ${selectedKey.privateKeyPath}` : `SSH 鍵は既に削除済みでした: ${selectedKey.privateKeyPath}`, finishedAt)
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      updatePane(paneId, {
        status: 'error',
        statusText: 'SSH 鍵の削除に失敗しました',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `SSH 鍵の削除に失敗しました: ${message}`
      })
    }
  }

  const handleRemoveKnownHost = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH ホストを入力してください',
        lastError: '削除する接続先ホスト鍵の対象が未設定です。',
        sshActionState: 'error',
        sshActionMessage: '接続先のホスト鍵を削除する対象を入力してください。'
      })
      return
    }

    const host = pane.sshHost.trim()
    const startedAt = Date.now()
    updatePane(paneId, {
      status: 'running',
      statusText: '接続先のホスト鍵を削除しています',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: `${host} の接続先ホスト鍵を削除しています...`
    })

    try {
      const result = await removeKnownHost(host, buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current))
      const finishedAt = Date.now()
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        sshDiagnostics: [
          `接続先のホスト鍵を削除しました: ${result.removedHosts.length > 0 ? result.removedHosts.join(', ') : host}`,
          ...currentPane.sshDiagnostics.filter((item) => !item.startsWith('接続先のホスト鍵を削除しました:'))
        ],
        sshActionState: 'success',
        sshActionMessage: result.removedHosts.length > 0 ? `${host} の接続先ホスト鍵を削除しました` : `${host} のホスト鍵は見つかりませんでした`,
        status: 'completed',
        statusText: result.removedHosts.length > 0 ? '接続先のホスト鍵を削除しました' : '削除対象のホスト鍵はありませんでした',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', result.removedHosts.length > 0 ? `接続先のホスト鍵を削除しました: ${result.removedHosts.join(', ')}` : `削除対象のホスト鍵はありませんでした: ${host}`, finishedAt)
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      updatePane(paneId, {
        status: 'error',
        statusText: '接続先のホスト鍵の削除に失敗しました',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `接続先のホスト鍵の削除に失敗しました: ${message}`
      })
    }
  }

  const handleInstallSshPublicKey = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim() || !pane.sshPublicKeyText.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '\u63a5\u7d9a\u5148\u3068\u516c\u958b\u9375\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044',
        lastError: 'SSH \u516c\u958b\u9375\u306e\u767b\u9332\u306b\u5fc5\u8981\u306a\u60c5\u5831\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002',
        sshActionState: 'error',
        sshActionMessage: '接続先と公開鍵を確認してください。',
        sshPasswordPulseAt: 0
      })
      return
    }

    if (!pane.sshPassword.trim()) {
      const pulseAt = Date.now()
      updatePane(paneId, {
        status: 'attention',
        statusText: 'パスワードを入力してください',
        lastError: '公開鍵を接続先に登録する場合はパスワードを設定してください。',
        sshActionState: 'error',
        sshActionMessage: '公開鍵を接続先に登録する場合はパスワードを設定してください',
        sshPasswordPulseAt: pulseAt
      })
      return
    }

    const startedAt = Date.now()
    updatePane(paneId, {
      status: 'running',
      statusText: '公開鍵を接続先に登録中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: `公開鍵を ${pane.sshHost.trim()} の接続先へ登録中です...`,
      sshPasswordPulseAt: 0
    })

    try {
      await installSshKey(pane.sshHost.trim(), pane.sshPublicKeyText.trim(), buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current))
      const finishedAt = Date.now()
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        sshDiagnostics: [`公開鍵を接続先へ登録しました: ${pane.sshHost.trim()}`, ...currentPane.sshDiagnostics.filter((item) => !item.startsWith('公開鍵を接続先へ登録しました:'))],
        sshActionState: 'success',
        sshActionMessage: `公開鍵を ${pane.sshHost.trim()} の接続先へ登録しました`,
        status: 'completed',
        statusText: '公開鍵を接続先に登録しました',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        sshPasswordPulseAt: 0,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', `公開鍵を接続先へ登録しました: ${pane.sshHost.trim()}`, finishedAt)
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      updatePane(paneId, {
        status: 'error',
        statusText: '\u516c\u958b\u9375\u306e\u767b\u9332\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `公開鍵の登録に失敗しました: ${message}`,
        sshPasswordPulseAt: 0
      })
    }
  }

  const handleTransferSshPath = async (
    paneId: string,
    direction: 'upload' | 'download',
    options?: { localPath?: string; remotePath?: string; remoteLabel?: string; isDirectory?: boolean }
  ) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH \u63a5\u7d9a\u5148\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044',
        lastError: '\u8ee2\u9001\u5148\u306e SSH \u63a5\u7d9a\u304c\u672a\u8a2d\u5b9a\u3067\u3059\u3002'
      })
      return
    }

    let localPath = options?.localPath?.trim() || pane.sshLocalPath.trim()
    let remotePath = options?.remotePath?.trim() || pane.sshRemotePath.trim()

    if (direction === 'download' && remotePath && !localPath) {
      if (options?.isDirectory) {
        const picked = await pickLocalWorkspace()
        localPath = picked.paths[0] ?? ''
      } else {
        const fallbackName = options?.remoteLabel?.trim() || remotePath.split('/').filter(Boolean).pop() || 'download.txt'
        const picked = await pickSaveFilePath(fallbackName)
        localPath = picked.path ?? ''
      }
    }

    if (!localPath || !remotePath) {
      updatePane(paneId, {
        status: 'attention',
        statusText: direction === 'upload' ? '\u9001\u4fe1\u5143\u3068\u9001\u4fe1\u5148\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044' : '\u53d6\u5f97\u5143\u3068\u4fdd\u5b58\u5148\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044',
        lastError: '\u8ee2\u9001\u306b\u5fc5\u8981\u306a\u60c5\u5831\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002'
      })
      return
    }

    updatePane(paneId, {
      sshLocalPath: localPath,
      sshRemotePath: remotePath,
      status: 'running',
      statusText: direction === 'upload' ? '\u9001\u4fe1\u4e2d' : '\u53d7\u4fe1\u4e2d',
      lastError: null
    })

    try {
      await transferSshPath(
        direction,
        pane.sshHost.trim(),
        localPath,
        remotePath,
        buildSshConnectionFromPane(pane, bootstrap?.sshHosts ?? [], panesRef.current)
      )
      appendPaneSystemMessage(
        paneId,
        direction === 'upload' ? `\u9001\u4fe1\u5b8c\u4e86: ${localPath} -> ${remotePath}` : `\u53d7\u4fe1\u5b8c\u4e86: ${remotePath} -> ${localPath}`
      )
      const finishedAt = Date.now()
      updatePane(paneId, {
        status: 'completed',
        statusText: direction === 'upload' ? '\u9001\u4fe1\u5b8c\u4e86' : '\u53d7\u4fe1\u5b8c\u4e86',
        sshLocalPath: localPath,
        sshRemotePath: remotePath,
        lastError: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt
      })

      if (direction === 'upload') {
        void handleBrowseRemote(paneId, pane.remoteBrowserPath || pane.remoteWorkspacePath || undefined)
      }
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: '\u8ee2\u9001\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
        sshLocalPath: localPath,
        sshRemotePath: remotePath,
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }
  useEffect(() => {
    if (!selectedPane || selectedPane.workspaceMode !== 'local' || !selectedPane.localWorkspacePath) {
      return
    }

    if (selectedPane.localBrowserLoading || selectedPane.localBrowserPath) {
      return
    }

    void handleBrowseLocal(selectedPane.id, selectedPane.localWorkspacePath)
  }, [
    selectedPane,
    selectedPane?.id,
    selectedPane?.workspaceMode,
    selectedPane?.localWorkspacePath,
    selectedPane?.localBrowserPath,
    selectedPane?.localBrowserLoading
  ])

  return (
    <div className="app-shell">
      <div className="background-layer" />

      <header className="topbar">
        <div className="topbar-brand">
          <img src={TITLE_IMAGE_URL} alt="T.A.K.O" className="topbar-title-mark" />
          <div className="topbar-copy-block">
            <p className="eyebrow">MULTI CLI DEVELOPMENT TOOL</p>
            <h1>Turtle AI Kantan Operator (T.A.K.O)</h1>
            <p className="topbar-copy">Raw CLI, multiple lanes, one calm deck. Remote-ready over SSH.</p>
          </div>
        </div>
      </header>

      {isBootstrapping && (
        <div className="global-loading">
          <span className="loading-spinner" aria-hidden="true" />
          <span>{'CLI \u30c7\u30c3\u30ad\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002'}</span>
        </div>
      )}

      {globalError && (
        <div className="global-error">
          <XCircle size={18} />
          <span>{globalError}</span>
        </div>
      )}

      <section className="summary-grid compact">
        <article className="metric-card compact">
          <header>
            <Activity size={16} />
            <span>{'\u5b9f\u884c\u4e2d'}</span>
          </header>
          <strong>{metrics.running}</strong>
          <p>{'\u5b9f\u884c\u4e2d\u306e\u30bf\u30b9\u30af'}</p>
        </article>
        <article className="metric-card compact">
          <header>
            <CheckCircle2 size={16} />
            <span>{'\u5b8c\u4e86'}</span>
          </header>
          <strong>{metrics.completed}</strong>
          <p>{'\u6b63\u5e38\u306b\u7d42\u4e86\u3057\u305f\u30bf\u30b9\u30af'}</p>
        </article>
        <article className="metric-card compact">
          <header>
            <Bot size={16} />
            <span>{'\u78ba\u8a8d\u5f85\u3061'}</span>
          </header>
          <strong>{metrics.attention}</strong>
          <p>{'\u5165\u529b\u3084\u5224\u65ad\u304c\u5fc5\u8981\u306a\u30bf\u30b9\u30af'}</p>
        </article>
        <article className="metric-card compact">
          <header>
            <XCircle size={16} />
            <span>{'\u505c\u6ede / \u30a8\u30e9\u30fc'}</span>
          </header>
          <strong>{metrics.error + metrics.stalled}</strong>
          <p>{'\u5931\u6557\u307e\u305f\u306f\u505c\u6ede\u3092\u691c\u51fa\u3057\u305f\u30bf\u30b9\u30af'}</p>
        </article>
      </section>

      {sharedContext.length > 0 && (
        <section className="context-dock">
          <div className="panel-header context-dock-header">
            <Wifi size={16} />
            <h2>{'\u5171\u6709\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8'}</h2>
          </div>
          <div className="context-dock-note">
            <span>{`\u5168\u4f53 ${sharedContext.filter((item) => item.scope === 'global').length}`}</span>
            <span>{`\u500b\u5225 ${sharedContext.filter((item) => item.scope === 'direct').length}`}</span>
            <span>{'\u6b21\u56de\u306e\u5b9f\u884c1\u56de\u3060\u3051\u306b\u53cd\u6620'}</span>
          </div>
          <div className="context-dock-list">
            {sharedContext.map((item) => {
              const pendingPaneTitles = panes.filter((pane) => pane.attachedContextIds.includes(item.id)).map((pane) => pane.title)
              const consumedPaneTitles = panes.filter((pane) => item.consumedByPaneIds.includes(pane.id)).map((pane) => pane.title)
              const directTargets = item.targetPaneTitles.length > 0
                ? item.targetPaneTitles
                : panes.filter((pane) => item.targetPaneIds.includes(pane.id)).map((pane) => pane.title)

              return (
                <article key={item.id} className="context-dock-item">
                  <div className="context-dock-item-head">
                    <div>
                      <strong>{item.sourcePaneTitle}</strong>
                      <span className="context-dock-meta">
                        {item.contentLabel} / {item.scope === 'global' ? '\u5168\u4f53\u5171\u6709' : '\u500b\u5225\u5171\u6709'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-button danger compact-icon-button"
                      onClick={() => handleDeleteSharedContext(item.id)}
                      title={'\u5171\u6709\u3092\u524a\u9664'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <span>{item.summary}</span>
                  <span className="context-dock-meta">{'\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9: '}{item.workspaceLabel}</span>
                  <span className="context-dock-meta">
                    {item.scope === 'global'
                      ? pendingPaneTitles.length > 0
                        ? '\u6b21\u56de\u4f7f\u7528\u4e88\u5b9a: ' + pendingPaneTitles.join(', ')
                        : '\u6b21\u56de\u4f7f\u7528\u4e88\u5b9a: \u307e\u3060\u3042\u308a\u307e\u305b\u3093'
                      : directTargets.length > 0
                        ? '\u500b\u5225\u5171\u6709\u5148: ' + directTargets.join(', ')
                        : '\u500b\u5225\u5171\u6709\u5148: \u306a\u3057'}
                  </span>
                  <span className="context-dock-meta">
                    {consumedPaneTitles.length > 0
                      ? '\u4f7f\u7528\u6e08\u307f: ' + consumedPaneTitles.join(', ')
                      : '\u4f7f\u7528\u6e08\u307f: \u307e\u3060\u3042\u308a\u307e\u305b\u3093'}
                  </span>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <div className="main-grid single-column">
        <main className="workspace-stage full-stage">
          <div className="stage-toolbar">
            <div className="toolbar-group">
              <button type="button" className="primary-button" onClick={handleAddPane}>
                <Plus size={16} />
                {'\u30da\u30a4\u30f3\u8ffd\u52a0'}
              </button>
              <button type="button" className="secondary-button" onClick={closeAllPaneAccordions}>
                {'\u898b\u305f\u76ee\u30ad\u30ec\u30a4'}
              </button>
              <button
                type="button"
                className={layout === 'quad' ? 'switch-button active' : 'switch-button'}
                onClick={() => setLayout('quad')}
              >
                <Grid2x2 size={15} />
                2x2
              </button>
              <button
                type="button"
                className={layout === 'triple' ? 'switch-button active' : 'switch-button'}
                onClick={() => setLayout('triple')}
              >
                <SplitSquareHorizontal size={15} />
                {'3\u5217'}
              </button>
              <button
                type="button"
                className={layout === 'focus' ? 'switch-button active' : 'switch-button'}
                onClick={() => setLayout('focus')}
              >
                <LayoutPanelTop size={15} />
                Focus
              </button>
            </div>

            <div className="toolbar-status-strip" aria-label="pane-status-summary">
              <span className="toolbar-status-chip running">実行中 {metrics.running}</span>
              <span className="toolbar-status-chip completed">完了 {metrics.completed}</span>
              <span className="toolbar-status-chip attention">確認待ち {metrics.attention}</span>
              <span className="toolbar-status-chip issue">停滞 / エラー {metrics.error + metrics.stalled}</span>
            </div>
          </div>

          <div className="pane-matrix">
            {panes.map((pane, index) => {
              const isFocused = pane.id === focusedPaneId
              const isStalled = pane.runInProgress && pane.lastActivityAt !== null && now - pane.lastActivityAt > STALL_MS

              return (
                <button
                  key={`matrix-${pane.id}`}
                  ref={(node) => {
                    if (node) {
                      matrixTileRefs.current[pane.id] = node
                    } else {
                      delete matrixTileRefs.current[pane.id]
                    }
                  }}
                  type="button"
                  draggable={panes.length > 1}
                  className={`matrix-tile status-${isStalled ? 'attention' : pane.status} ${isFocused ? 'active' : ''} ${selectedPaneIds.includes(pane.id) ? 'selected' : ''} ${draggedPaneId === pane.id ? 'is-dragging' : ''} ${matrixDropTargetId === pane.id && draggedPaneId !== pane.id ? 'is-drop-target' : ''}`}
                  onClick={(event) => handleMatrixClick(event, pane.id)}
                  onDragStart={(event) => handleMatrixDragStart(event, pane.id)}
                  onDragEnter={(event) => handleMatrixDragEnter(event, pane.id)}
                  onDragOver={(event) => handleMatrixDragOver(event, pane.id)}
                  onDrop={(event) => handleMatrixDrop(event, pane.id)}
                  onDragEnd={handleMatrixDragEnd}
                >
                  <span className="matrix-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{pane.title}</strong>
                  <span>{catalogs[pane.provider]?.label ?? pane.provider}</span>
                </button>
              )
            })}
          </div>

          <div className={`pane-grid layout-${layout}`}>
            {visiblePanes.map((pane) => (
              <div
                key={pane.id}
                className="pane-grid-item"
                ref={(node) => {
                  if (node) {
                    paneCardRefs.current[pane.id] = node
                  } else {
                    delete paneCardRefs.current[pane.id]
                  }
                }}
              >
                <TerminalPane
                  pane={pane}
                  catalogs={catalogs}
                  localWorkspaces={localWorkspaces}
                  sshHosts={bootstrap?.sshHosts ?? []}
                  sharedContext={sharedContext}
                  now={now}
                  isFocused={pane.id === focusedPaneId}
                  onFocus={(paneId) => handleSelectPane(paneId)}
                  onUpdate={updatePane}
                  onProviderChange={handleProviderChange}
                  onModelChange={handleModelChange}
                  promptImageAttachments={paneImageAttachments[pane.id] ?? []}
                  onAddPromptImages={(paneId, files, source) => void handleAddPromptImages(paneId, files, source)}
                  onRemovePromptImage={handleRemovePromptImage}
                  onRun={(paneId) => void handleRun(paneId)}
                  onStop={(paneId) => void handleStop(paneId)}
                  onShare={shareFromPane}
                  onShareToPane={(sourcePaneId, targetPaneId) =>
                    shareFromPane(sourcePaneId, undefined, { scope: 'direct', targetPaneId })
                  }
                  onCopyOutput={(paneId) => void handleCopyOutput(paneId)}
                  onCopyProviderCommand={(paneId, text, successMessage) => handleCopyProviderCommand(paneId, text, successMessage)}
                  onCopyText={(paneId, text, successMessage) => handleCopyText(paneId, text, successMessage)}
                  onDuplicate={handleDuplicatePane}
                  onStartNewSession={handleStartNewSession}
                  onResetSession={handleResetSession}
                  onSelectSession={handleSelectSession}
                  onResumeSession={handleResumeSession}
                  onClearSelectedSessionHistory={handleClearSelectedSessionHistory}
                  onClearAllSessionHistory={handleClearAllSessionHistory}
                  onDelete={handleDeletePane}
                  onLoadRemote={(paneId) => void handleLoadRemote(paneId)}
                  onBrowseRemote={(paneId, path) => void handleBrowseRemote(paneId, path)}
                  onRefreshWorkspaceContents={handleRefreshWorkspaceContents}
                  onCreateRemoteDirectory={(paneId) => void handleCreateRemoteDirectory(paneId)}
                  onOpenFileManager={(paneId) => void handleOpenFileManager(paneId)}
                  onOpenWorkspace={(paneId) => void handleOpenWorkspace(paneId)}
                  onOpenCommandPrompt={(paneId) => void handleOpenCommandPrompt(paneId)}
                  onRunShell={(paneId) => void handleRunShell(paneId)}
                  onStopShell={(paneId) => void handleStopShell(paneId)}
                  onOpenPath={(paneId, path, resourceType) => void handleOpenPathInVsCode(paneId, path, resourceType)}
                  onAddLocalWorkspace={(paneId) => void handleAddLocalWorkspace(paneId)}
                  onOpenRemoteWorkspacePicker={(paneId) => void handleOpenRemoteWorkspacePicker(paneId)}
                  onSelectLocalWorkspace={(paneId, workspacePath) => void handleSelectLocalWorkspace(paneId, workspacePath)}
                  onRemoveLocalWorkspace={handleRemoveLocalWorkspace}
                  onBrowseLocal={(paneId, path) => void handleBrowseLocal(paneId, path)}
                  onGenerateSshKey={(paneId) => void handleGenerateSshKey(paneId)}
                  onDeleteSshKey={(paneId) => void handleDeleteSshKey(paneId)}
                  onInstallSshPublicKey={(paneId) => void handleInstallSshPublicKey(paneId)}
                  onRemoveKnownHost={(paneId) => void handleRemoveKnownHost(paneId)}
                  onTransferSshPath={(paneId, direction, options) => void handleTransferSshPath(paneId, direction, options)}
                  shareTargets={panes.filter((item) => item.id !== pane.id).map((item) => ({ id: item.id, title: item.title }))}
                />
              </div>
            ))}
          </div>
        </main>

      </div>

      {workspacePicker && (
        <div className="output-modal-backdrop">
          <div className="output-modal workspace-picker-modal">
            <div className="panel-header slim">
              <div>
                <h3>{workspacePicker.mode === 'local' ? '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u9078\u629e' : '\u30ea\u30e2\u30fc\u30c8\u4e00\u89a7/\u30ea\u30e2\u30fc\u30c8\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u9078\u629e'}</h3>
                <p className="workspace-picker-current-path">{workspacePicker.path || (workspacePicker.mode === 'local' ? '\u4f7f\u3044\u305f\u3044\u30d5\u30a9\u30eb\u30c0\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044\u3002' : '\u4f7f\u3044\u305f\u3044\u30ea\u30e2\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044\u3002')}</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => setWorkspacePicker(null)}>{'\u9589\u3058\u308b'}</button>
            </div>

            <div className="workspace-picker-toolbar">
              <div className="workspace-picker-roots">
                {workspacePicker.roots.map((root) => (
                  <button key={root.path} type="button" className={isWorkspacePickerRootActive(workspacePicker, root.path) ? 'switch-button active' : 'switch-button'} onClick={() => void handleBrowseWorkspacePicker(root.path)}>
                    {root.label}
                  </button>
                ))}
              </div>
              <div className="workspace-picker-actions">
                <button type="button" className="secondary-button" disabled={!workspacePicker.path || workspacePicker.loading} onClick={() => void handleCreateWorkspacePickerDirectory()}>
                  {'\u65b0\u3057\u3044\u30d5\u30a9\u30eb\u30c0'}
                </button>
                {workspacePickerParentPath && (
                  <button type="button" className="secondary-button" disabled={workspacePicker.loading} onClick={() => void handleBrowseWorkspacePicker(workspacePickerParentPath)}>
                    {'\u4e00\u3064\u4e0a\u3078'}
                  </button>
                )}
                <button type="button" className="secondary-button" disabled={!workspacePicker.path || workspacePicker.loading} onClick={() => void handleBrowseWorkspacePicker(workspacePicker.path)}>
                  {'\u518d\u8aad\u8fbc'}
                </button>
              </div>
            </div>

            {workspacePicker.error && (
              <div className="global-error compact-error">
                <XCircle size={16} />
                <span>{workspacePicker.error}</span>
              </div>
            )}

            <div className="workspace-picker-list">
              {workspacePicker.loading ? (
                <div className="panel-placeholder">{workspacePicker.mode === 'local' ? '\u30d5\u30a9\u30eb\u30c0\u4e00\u89a7\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002' : '\u30ea\u30e2\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u4e00\u89a7\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002'}</div>
              ) : workspacePicker.entries.length > 0 ? (
                workspacePicker.entries.map((entry) => (
                  <button key={entry.path} type="button" className="workspace-picker-entry" onClick={() => void handleBrowseWorkspacePicker(entry.path)}>
                    <strong>{entry.label}</strong>
                    <span>{entry.path}</span>
                    {entry.isWorkspace ? <span>{'\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u5019\u88dc'}</span> : null}
                  </button>
                ))
              ) : (
                <div className="panel-placeholder">{workspacePicker.mode === 'local' ? '\u3053\u306e\u5834\u6240\u306b\u8868\u793a\u3067\u304d\u308b\u30d5\u30a9\u30eb\u30c0\u304c\u3042\u308a\u307e\u305b\u3093\u3002' : '\u3053\u306e\u5834\u6240\u306b\u8868\u793a\u3067\u304d\u308b\u30ea\u30e2\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u304c\u3042\u308a\u307e\u305b\u3093\u3002'}</div>
              )}
            </div>

            <div className="output-modal-footer workspace-picker-footer">
              <button type="button" className="secondary-button" onClick={() => setWorkspacePicker(null)}>{'\u30ad\u30e3\u30f3\u30bb\u30eb'}</button>
              <button type="button" className="primary-button" disabled={!workspacePicker.path || workspacePicker.loading} onClick={() => void handleConfirmWorkspacePicker()}>
                {workspacePicker.mode === 'local' ? '\u3053\u306e\u30d5\u30a9\u30eb\u30c0\u3092\u4f7f\u3046' : '\u3053\u306e\u30ea\u30e2\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u3092\u4f7f\u3046'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App


















