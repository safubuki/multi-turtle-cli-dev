import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  Copy,  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  History,
  LoaderCircle,
  Maximize2,
  Play,
  RefreshCcw,
  Settings2,
  Share2,
  Square,
  Trash2,
  Wifi,
  X
} from 'lucide-react'
import type { LocalWorkspace, PaneState, ProviderCatalogResponse, ProviderId, SharedContextItem, SshHost } from '../types'

interface TransferOptions {
  localPath?: string
  remotePath?: string
  remoteLabel?: string
  isDirectory?: boolean
}

interface TerminalPaneProps {
  pane: PaneState
  catalogs: Record<ProviderId, ProviderCatalogResponse>
  localWorkspaces: LocalWorkspace[]
  sshHosts: SshHost[]
  sharedContext: SharedContextItem[]
  now: number
  isFocused: boolean
  onFocus: (paneId: string) => void
  onUpdate: (paneId: string, updates: Partial<PaneState>) => void
  onProviderChange: (paneId: string, provider: ProviderId) => void
  onModelChange: (paneId: string, model: string) => void
  onRun: (paneId: string) => void
  onStop: (paneId: string) => void
  onShare: (paneId: string) => void
  onShareToPane: (sourcePaneId: string, targetPaneId: string) => void
  onCopyLatest: (paneId: string) => void
  onCopyOutput: (paneId: string) => void
  onDuplicate: (paneId: string) => void
  onStartNewSession: (paneId: string) => void
  onResetSession: (paneId: string) => void
  onDelete: (paneId: string) => void
  onLoadRemote: (paneId: string) => void
  onBrowseRemote: (paneId: string, path?: string) => void
  onCreateRemoteDirectory: (paneId: string) => void
  onOpenWorkspace: (paneId: string) => void
  onOpenCommandPrompt: (paneId: string) => void
  onUpdateProviderCli: (paneId: string) => void
  providerUpdating: boolean
  onRunShell: (paneId: string) => void
  onStopShell: (paneId: string) => void
  onOpenPath: (paneId: string, path: string, resourceType: 'folder' | 'file') => void
  onAddLocalWorkspace: (paneId: string) => void
  onSelectLocalWorkspace: (paneId: string, workspacePath: string) => void
  onRemoveLocalWorkspace: (paneId: string) => void
  onBrowseLocal: (paneId: string, path: string) => void
  onGenerateSshKey: (paneId: string) => void
  onInstallSshPublicKey: (paneId: string) => void
  onTransferSshPath: (paneId: string, direction: 'upload' | 'download', options?: TransferOptions) => void
  shareTargets: Array<{ id: string; title: string }>
  onSelectSession: (paneId: string, sessionKey: string | null) => void
  onToggleContext: (paneId: string, contextId: string) => void
}

const UI = {
  notRun: '\u672a\u5b9f\u884c',
  unselected: '\u672a\u9078\u629e',
  sshUnset: 'SSH \u672a\u8a2d\u5b9a',
  currentSession: '\u73fe\u5728\u306e\u30bb\u30c3\u30b7\u30e7\u30f3',
  currentPrefix: '\u73fe\u5728 / ',
  deleteConfirm: '\u3053\u306e\u30da\u30a4\u30f3\u3092\u524a\u9664\u3057\u3066\u3082\u826f\u3044\u3067\u3059\u304b\uff1f',
  newSession: '\u65b0\u898f\u30bb\u30c3\u30b7\u30e7\u30f3',
  paneMenu: '\u5171\u6709',
  shareGlobal: '\u6700\u65b0\u7d50\u679c\u3092\u5168\u4f53\u5171\u6709\u306b\u8ffd\u52a0',
  shareDirect: '\u76f8\u624b\u30da\u30a4\u30f3\u3078\u500b\u5225\u5171\u6709',
  copyResponse: '\u5fdc\u7b54\u3092\u30b3\u30d4\u30fc',
  copyOutput: '\u51fa\u529b\u3092\u30b3\u30d4\u30fc',
  duplicatePane: '\u30da\u30a4\u30f3\u3092\u8907\u88fd',
  resetConversation: '\u4f1a\u8a71\u3092\u521d\u671f\u5316',
  autoShare: '\u5b8c\u4e86\u6642\u306b\u6700\u65b0\u7d50\u679c\u3092\u5168\u4f53\u5171\u6709',
  autoShareShort: '\u5b8c\u4e86\u6642',
  updateCli: 'CLI\u3092\u66f4\u65b0',
  updateCliField: 'CLI\u66f4\u65b0',
  deletePane: '\u30da\u30a4\u30f3\u3092\u524a\u9664',
  openVsCode: 'VSCode\u3067\u958b\u304f',
  output: 'AI\u7d50\u679c\u51fa\u529b',
  outputEmpty: '\u307e\u3060\u51fa\u529b\u306f\u3042\u308a\u307e\u305b\u3093\u3002',
  outputPlaceholder: '\u3053\u3053\u306b\u5b9f\u884c\u7d50\u679c\u3068\u6700\u65b0\u306e\u5fdc\u7b54\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002',
  outputExpand: '\u51fa\u529b\u3092\u62e1\u5927',
  instruction: 'AI\u6307\u793a\uff08\u30d7\u30ed\u30f3\u30d7\u30c8\uff09',
  workspaceUnset: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u672a\u8a2d\u5b9a',
  promptPlaceholder: '\u3084\u308a\u305f\u3044\u3053\u3068\u3092\u5165\u529b\u3057\u307e\u3059\u3002Ctrl+Enter \u3067\u5b9f\u884c\u3067\u304d\u307e\u3059\u3002',
  stalledHint: '\u51fa\u529b\u304c\u6b62\u307e\u3063\u3066\u3044\u307e\u3059\u3002\u78ba\u8a8d\u304b\u518d\u5b9f\u884c\u3092\u691c\u8a0e\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
  runningHint: 'CLI \u3092\u5b9f\u884c\u4e2d\u3067\u3059\u3002',
  updatingHint: 'AI \u3092\u66f4\u65b0\u4e2d\u3067\u3059\u3002',
  stop: '\u505c\u6b62',
  run: '\u5b9f\u884c',
  settings: 'CLI/AI\u30e2\u30c7\u30eb\u9078\u629e/\u8a2d\u5b9a',
  workspace: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u8a2d\u5b9a',
  cli: 'CLI',
  model: '\u30e2\u30c7\u30eb',
  reasoning: '\u63a8\u8ad6\u30ec\u30d9\u30eb',
  reasoningUnavailable: '\u9078\u629e\u3067\u304d\u307e\u305b\u3093',
  executionStyle: '\u81ea\u52d5\u627f\u8a8d\u30ec\u30d9\u30eb',
  readonlyCodex: 'Codex \u306f --full-auto \u56fa\u5b9a\u3067\u3059\u3002Fast\u30e2\u30fc\u30c9\u306f\u30d7\u30ed\u30f3\u30d7\u30c8\u5148\u982d\u306b /fast \u3092\u4ed8\u3051\u3066\u5b9f\u884c\u3057\u307e\u3059\u3002',
  styleHint: '\u6a19\u6e96\u306f\u901a\u5e38\u306e\u7de8\u96c6\u3068\u30c4\u30fc\u30eb\u5b9f\u884c\u3092\u81ea\u52d5\u3067\u9032\u3081\u3001\u5236\u9650\u306a\u3057\u306f\u305d\u308c\u3088\u308a\u5e83\u3044\u64cd\u4f5c\u307e\u3067\u8a31\u53ef\u3057\u307e\u3059\u3002Gemini \u306f auto_edit / yolo\u3001Copilot \u306f allow-all-tools / allow-all \u306b\u5bfe\u5fdc\u3057\u307e\u3059\u3002',
  unchanged: '\u9078\u629e\u3067\u304d\u307e\u305b\u3093',
  normal: '\u6a19\u6e96\u306e\u81ea\u52d5\u627f\u8a8d',
  active: '\u5236\u9650\u306a\u3057\u306e\u81ea\u52d5\u627f\u8a8d',
  currentWorkspace: '\u73fe\u5728\u306e\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
  chooseWorkspace: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u9078\u629e',
  removeFromList: '\u4e00\u89a7\u304b\u3089\u5916\u3059',
  savedWorkspaces: '\u767b\u9332\u6e08\u307f\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
  folderContents: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u306e\u5185\u5bb9',
  browseLoading: '\u30d5\u30a9\u30eb\u30c0\u5185\u5bb9\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002',
  browseEmpty: '\u9078\u629e\u3057\u305f\u30d5\u30a9\u30eb\u30c0\u306e\u5185\u5bb9\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002',
  currentConnection: '\u73fe\u5728\u306e\u63a5\u7d9a',
  connectionSettings: '\u63a5\u7d9a\u8a2d\u5b9a',
  connectionSupport: '\u30d7\u30ed\u30ad\u30b7 / \u88dc\u52a9\u8a2d\u5b9a',
  refreshConnection: '\u30ea\u30e2\u30fc\u30c8\u306b\u63a5\u7d9a',
  remoteWorkspace: '\u30ea\u30e2\u30fc\u30c8\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
  publicKey: '\u516c\u958b\u9375',
  generateKey: '\u9375\u3092\u751f\u6210',
  installKey: '\u516c\u958b\u9375\u3092\u767b\u9332',
  diagnostics: '\u63a5\u7d9a\u8a3a\u65ad',
  dragHint: '\u30ed\u30fc\u30ab\u30eb\u4e00\u89a7\u304b\u3089\u30c9\u30e9\u30c3\u30b0\u3059\u308b\u3068\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u3067\u304d\u307e\u3059\u3002',
  remoteList: '\u30ea\u30e2\u30fc\u30c8\u4e00\u89a7',
  remoteLoading: '\u30ea\u30e2\u30fc\u30c8\u4e00\u89a7\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002',
  remoteEmpty: '\u63a5\u7d9a\u3092\u66f4\u65b0\u3059\u308b\u3068\u30ea\u30e2\u30fc\u30c8\u4e00\u89a7\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002',
  oneLevelUp: '\u4e00\u3064\u4e0a\u3078',
  createFolder: '\u30d5\u30a9\u30eb\u30c0\u4f5c\u6210',
  receive: '\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9',
  downloadCurrent: '\u3053\u3053\u3092\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9',
  localPc: '\u30ed\u30fc\u30ab\u30ebPC\uff08\u3053\u306ePC\uff09',
  remotePc: '\u30ea\u30e2\u30fc\u30c8PC\uff08SSH\uff09',
  useWorkspace: '\u4f7f\u3046',
  sharedContext: '\u5171\u6709\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8',
  sharedFrom: '\u5171\u6709\u5143',
  noSharedContext: '\u5171\u6709\u6e08\u307f\u306e\u6587\u8108\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002',
  selectedCount: '\u4ef6\u9078\u629e',
  runLogs: '\u5b9f\u884c\u30ed\u30b0',
  runLogsEmpty: '\u307e\u3060\u5b9f\u884c\u30ed\u30b0\u306f\u3042\u308a\u307e\u305b\u3093\u3002',
  session: '\u30bb\u30c3\u30b7\u30e7\u30f3',
  sessions: '\u30bb\u30c3\u30b7\u30e7\u30f3',
  stream: '\u30b9\u30c8\u30ea\u30fc\u30e0',
  conversation: '\u4f1a\u8a71\u5c65\u6b74',
  embeddedTerminal: '\u7c21\u6613\u5185\u8535\u30bf\u30fc\u30df\u30ca\u30eb',
  fastMode: 'Fast\u30e2\u30fc\u30c9',
  fastOff: '\u901a\u5e38',
  fastOn: '\u6709\u52b9 (/fast)',
  shareHint: '\u4e00\u56de\u5171\u6709\u306e\u30dc\u30bf\u30f3\u306f\u6b21\u56de\u306e\u5b9f\u884c1\u56de\u3060\u3051\u306b\u53cd\u6620\u3057\u307e\u3059\u3002\u300c\u5b8c\u4e86\u6642\u300d\u3092 ON \u306b\u3059\u308b\u3068\u3001\u5b8c\u4e86\u306e\u305f\u3073\u306b\u6700\u65b0\u7d50\u679c\u3092\u5171\u6709\u3057\u7d9a\u3051\u307e\u3059\u3002\u4e00\u56de\u5171\u6709\u306f\u4f7f\u308f\u308c\u308b\u3068\u81ea\u52d5\u3067\u6d88\u8cbb\u3055\u308c\u3001\u4f7f\u3046\u524d\u306b\u3082\u3046\u4e00\u5ea6\u62bc\u3059\u3068\u53d6\u308a\u6d88\u305b\u307e\u3059\u3002',
  shellExpand: '\u7c21\u6613\u5185\u8535\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u62e1\u5927',
  terminalPlaceholder: '\u3053\u3053\u3067 cd / ping / git / npm / ssh \u7d4c\u7531\u306e\u30ea\u30e2\u30fc\u30c8\u5b9f\u884c\u3092\u6271\u3048\u307e\u3059\u3002',
  terminalPromptPlaceholder: '',
  terminalRun: '\u30b3\u30de\u30f3\u30c9\u5b9f\u884c',
  terminalClear: '\u30af\u30ea\u30a2',
  terminalStop: '\u505c\u6b62',
  terminalExternal: '\u5916\u90e8\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8a66\u3059',
  terminalPath: '\u73fe\u5728\u30d1\u30b9',
  workspaceTop: '\u30c8\u30c3\u30d7\u3078',
  backToTop: '\u30c8\u30c3\u30d7\u306b\u623b\u308b',
  close: '\u9589\u3058\u308b'
} as const

const LOCAL_DRAG_MIME = 'application/x-multi-turtle-local-path'
function formatClock(timestamp: number | null): string {
  if (!timestamp) {
    return UI.notRun
  }

  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatElapsed(from: number | null, now: number): string {
  if (!from) {
    return '00:00'
  }

  const totalSeconds = Math.max(0, Math.floor((now - from) / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getShortPathLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function getOutputText(pane: PaneState): string {
  if (pane.liveOutput.trim()) {
    return pane.liveOutput
  }

  if (pane.lastResponse?.trim()) {
    return pane.lastResponse
  }

  return ''
}

function hasCurrentSessionContent(pane: PaneState): boolean {
  return (
    pane.logs.length > 0 ||
    pane.streamEntries.length > 0 ||
    Boolean(pane.sessionId) ||
    Boolean(pane.lastResponse?.trim()) ||
    Boolean(pane.liveOutput.trim())
  )
}

function normalizeWindowsPath(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\//g, '\\')
}

function getLocalParentPath(currentPath: string, workspaceRoot: string): string | null {
  const current = normalizeWindowsPath(currentPath)
  const root = normalizeWindowsPath(workspaceRoot)
  if (!current || !root || current.toLowerCase() === root.toLowerCase()) {
    return null
  }

  const segments = current.split('\\')
  if (segments.length <= 1) {
    return null
  }

  segments.pop()
  let parent = segments.join('\\')
  if (/^[A-Za-z]:$/.test(parent)) {
    parent += '\\'
  }

  return parent.toLowerCase().startsWith(root.toLowerCase()) ? parent : root
}

function readDraggedLocalPath(event: ReactDragEvent<HTMLElement>): string {
  return event.dataTransfer.getData(LOCAL_DRAG_MIME).trim()
}

function isLocalDevEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
}

export function TerminalPane({
  pane,
  catalogs,
  localWorkspaces,
  sshHosts,
  sharedContext,
  now,
  isFocused,
  onFocus,
  onUpdate,
  onProviderChange,
  onModelChange,
  onRun,
  onStop,
  onShare,
  onShareToPane,
  onCopyOutput,
  onDuplicate,
  onStartNewSession,
  onDelete,
  onLoadRemote,
  onBrowseRemote,
  onCreateRemoteDirectory,
  onOpenWorkspace,
  onUpdateProviderCli,
  providerUpdating,
  onRunShell,
  onOpenPath,
  onAddLocalWorkspace,
  onSelectLocalWorkspace,
  onRemoveLocalWorkspace,
  onBrowseLocal,
  onGenerateSshKey,
  onInstallSshPublicKey,
  onTransferSshPath,
  shareTargets,
  onSelectSession,
  onToggleContext
}: TerminalPaneProps) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const [isRunLogsExpanded, setIsRunLogsExpanded] = useState(false)
  const [isShellExpanded, setIsShellExpanded] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [remoteDropTarget, setRemoteDropTarget] = useState<string | null>(null)
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const shellInputRef = useRef<HTMLInputElement | null>(null)
  const shellModalInputRef = useRef<HTMLInputElement | null>(null)
  const shellConsoleRef = useRef<HTMLDivElement | null>(null)
  const shellModalConsoleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        if (menuRef.current) {
          menuRef.current.open = false
        }
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    const element = promptRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    const nextHeight = Math.min(Math.max(element.scrollHeight, 118), 220)
    element.style.height = `${nextHeight}px`
    element.style.overflowY = element.scrollHeight > 220 ? 'auto' : 'hidden'
  }, [pane.prompt])



  useEffect(() => {
    const elements = [shellConsoleRef.current, shellModalConsoleRef.current].filter(Boolean) as HTMLDivElement[]
    for (const element of elements) {
      element.scrollTop = element.scrollHeight
    }
  }, [pane.shellOutput, pane.shellCommand, isShellExpanded])

  useEffect(() => {
    if (pane.shellRunning) {
      return
    }

    const target = isShellExpanded ? shellModalInputRef.current : shellInputRef.current
    target?.focus()
  }, [pane.shellRunning, pane.shellOpen, isShellExpanded])

  const catalog = catalogs[pane.provider]
  const currentModel = catalog?.models.find((model) => model.id === pane.model) ?? catalog?.models[0]
  const reasoningOptions = currentModel?.supportedReasoningEfforts ?? []
  const canSelectReasoning = reasoningOptions.length > 0
  const availableRemoteProviders = pane.remoteAvailableProviders.length > 0 ? pane.remoteAvailableProviders : (['codex', 'copilot', 'gemini'] as ProviderId[])
  const selectedLocalWorkspace = localWorkspaces.find((workspace) => workspace.path === pane.localWorkspacePath)
  const canRemoveLocalWorkspace = selectedLocalWorkspace?.source === 'manual'
  const isProviderUpdating = pane.status === 'updating'
  const isRunInProgress = pane.status === 'running'
  const isBusy = isRunInProgress || isProviderUpdating
  const isStalled = pane.status === 'running' && pane.lastActivityAt !== null && now - pane.lastActivityAt > 45_000
  const canRun = pane.prompt.trim().length > 0 && (pane.workspaceMode === 'local' ? pane.localWorkspacePath.trim().length > 0 : pane.sshHost.trim().length > 0 && pane.remoteWorkspacePath.trim().length > 0)
  const outputText = getOutputText(pane)
  const hasOutput = outputText.trim().length > 0
  const currentShellPath = pane.workspaceMode === 'local' ? (pane.localShellPath || pane.localWorkspacePath) : (pane.remoteShellPath || pane.remoteWorkspacePath)
  const shellPromptLabel = pane.workspaceMode === 'local'
    ? `${currentShellPath || '~'}>`
    : `${pane.sshUser.trim() ? `${pane.sshUser.trim()}@${pane.sshHost.trim()}` : pane.sshHost.trim() || 'ssh'}:${currentShellPath || '~'}$`
  const canRunShell = pane.shellCommand.trim().length > 0 && (pane.workspaceMode === 'local' ? currentShellPath.trim().length > 0 : Boolean(pane.sshHost.trim() && currentShellPath.trim()))
  const localParentPath = useMemo(() => getLocalParentPath(pane.localBrowserPath || pane.localWorkspacePath, pane.localWorkspacePath), [pane.localBrowserPath, pane.localWorkspacePath])
  const isAtLocalWorkspaceTop = normalizeWindowsPath(pane.localBrowserPath || pane.localWorkspacePath) === normalizeWindowsPath(pane.localWorkspacePath)
  const sshDisplayName = pane.sshUser.trim() ? `${pane.sshUser.trim()}@${pane.sshHost.trim()}` : pane.sshHost.trim()
  const workspaceLabel = pane.workspaceMode === 'local' ? selectedLocalWorkspace?.label ?? getShortPathLabel(pane.localWorkspacePath || UI.unselected) : pane.remoteWorkspacePath ? getShortPathLabel(pane.remoteWorkspacePath) : sshDisplayName || UI.sshUnset
  const currentSessionAvailable = hasCurrentSessionContent(pane)
  const fallbackArchivedSession = !currentSessionAvailable ? pane.sessionHistory[0] ?? null : null
  const selectedArchivedSession = pane.selectedSessionKey ? pane.sessionHistory.find((session) => session.key === pane.selectedSessionKey) ?? fallbackArchivedSession : fallbackArchivedSession
  const visibleSession = selectedArchivedSession
    ? { key: selectedArchivedSession.key, label: selectedArchivedSession.label, logs: selectedArchivedSession.logs, streamEntries: selectedArchivedSession.streamEntries, updatedAt: selectedArchivedSession.updatedAt, status: selectedArchivedSession.status }
    : { key: null, label: pane.sessionId ? `${UI.currentPrefix}${pane.sessionId.slice(0, 8)}` : UI.currentSession, logs: pane.logs, streamEntries: pane.streamEntries, updatedAt: pane.lastActivityAt ?? pane.lastRunAt, status: pane.status }
  const sessionOptions = [
    ...(currentSessionAvailable ? [{ key: '__current__', label: pane.sessionId ? `${UI.currentPrefix}${pane.sessionId.slice(0, 8)}` : UI.currentSession }] : []),
    ...pane.sessionHistory.map((session) => ({ key: session.key, label: session.label }))
  ]
  const hasSessionRecords = sessionOptions.length > 0
  const incomingShareSources = useMemo(() => {
    const sourceMap = new Map<string, { id: string; title: string; count: number }>()

    for (const item of sharedContext) {
      if (!item.targetPaneIds.includes(pane.id)) {
        continue
      }

      const existing = sourceMap.get(item.sourcePaneId)
      if (existing) {
        existing.count += 1
        continue
      }

      sourceMap.set(item.sourcePaneId, {
        id: item.sourcePaneId,
        title: item.sourcePaneTitle,
        count: 1
      })
    }

    return Array.from(sourceMap.values())
  }, [pane.id, sharedContext])
  const visibleSharedContext = sharedContext.filter((item) => item.sourcePaneId === pane.id || item.targetPaneIds.includes(pane.id))
  const remoteBaseDropPath = pane.remoteBrowserPath || pane.remoteWorkspacePath
  const currentRemoteLabel = getShortPathLabel(remoteBaseDropPath || pane.remoteHomeDirectory || '')
  const outgoingShareContexts = sharedContext.filter((item) => item.sourcePaneId === pane.id && item.targetPaneIds.length > 0)
  const materializedGlobalShare = outgoingShareContexts.find((item) => item.scope === 'global') ?? null
  const isGlobalShareActive = Boolean(materializedGlobalShare) || pane.pendingShareGlobal
  const activeShareTargetIds = new Set(outgoingShareContexts.flatMap((item) => item.targetPaneIds))
  if (pane.pendingShareGlobal) {
    for (const target of shareTargets) {
      activeShareTargetIds.add(target.id)
    }
  }
  for (const targetPaneId of pane.pendingShareTargetIds) {
    activeShareTargetIds.add(targetPaneId)
  }
  const hasOutgoingShare = outgoingShareContexts.length > 0 || pane.pendingShareGlobal || pane.pendingShareTargetIds.length > 0
  const providerUpdateLabel = providerUpdating
    ? `${catalog?.label ?? pane.provider} \u3092\u66f4\u65b0\u4e2d...`
    : `${catalog?.label ?? pane.provider} \u3092\u66f4\u65b0`

  useEffect(() => {
    if (!isLocalDevEnvironment() || !isMenuOpen) {
      return
    }

    console.log('[share-menu-state]', {
      paneId: pane.id,
      activeGlobalShare: isGlobalShareActive,
      activeTargetPaneIds: Array.from(activeShareTargetIds),
      pendingShareGlobal: pane.pendingShareGlobal,
      pendingShareTargetIds: pane.pendingShareTargetIds,
      outgoingShareContexts: outgoingShareContexts.map((item) => ({
        id: item.id,
        scope: item.scope,
        targetPaneIds: item.targetPaneIds
      }))
    })
  }, [activeShareTargetIds, isGlobalShareActive, isMenuOpen, outgoingShareContexts, pane.id, pane.pendingShareGlobal, pane.pendingShareTargetIds])

  const updateShellCommand = (value: string) => {
    onUpdate(pane.id, { shellCommand: value, shellHistoryIndex: null })
  }

  const toggleAutoShareTarget = (targetPaneId: string, enabled: boolean) => {
    const nextTargetIds = enabled
      ? [...pane.autoShareTargetIds.filter((item) => item !== targetPaneId), targetPaneId]
      : pane.autoShareTargetIds.filter((item) => item !== targetPaneId)
    onUpdate(pane.id, { autoShareTargetIds: nextTargetIds })
  }

  const handleShellKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (pane.shellHistory.length === 0) {
        return
      }

      const nextIndex = pane.shellHistoryIndex === null
        ? pane.shellHistory.length - 1
        : Math.max(0, pane.shellHistoryIndex - 1)
      onUpdate(pane.id, {
        shellHistoryIndex: nextIndex,
        shellCommand: pane.shellHistory[nextIndex] ?? ''
      })
      return
    }

    if (event.key === 'ArrowDown') {
      if (pane.shellHistory.length === 0) {
        return
      }

      event.preventDefault()
      if (pane.shellHistoryIndex === null) {
        return
      }

      const nextIndex = pane.shellHistoryIndex + 1
      if (nextIndex >= pane.shellHistory.length) {
        onUpdate(pane.id, { shellHistoryIndex: null, shellCommand: '' })
        return
      }

      onUpdate(pane.id, {
        shellHistoryIndex: nextIndex,
        shellCommand: pane.shellHistory[nextIndex] ?? ''
      })
      return
    }

    if (event.key === 'Enter' && canRunShell && !pane.shellRunning) {
      event.preventDefault()
      onRunShell(pane.id)
    }
  }

  const startLocalDrag = (event: ReactDragEvent<HTMLElement>, path: string) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(LOCAL_DRAG_MIME, path)
    event.dataTransfer.setData('text/plain', path)
  }

  const allowRemoteDrop = (event: ReactDragEvent<HTMLElement>, targetPath: string) => {
    if (!readDraggedLocalPath(event)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setRemoteDropTarget(targetPath)
  }

  const clearRemoteDrop = () => {
    setRemoteDropTarget(null)
  }

  const handleRemoteDrop = (event: ReactDragEvent<HTMLElement>, targetPath: string) => {
    const localPath = readDraggedLocalPath(event)
    if (!localPath) {
      return
    }

    event.preventDefault()
    setRemoteDropTarget(null)
    onTransferSshPath(pane.id, 'upload', { localPath, remotePath: targetPath })
  }

  const handleDelete = () => {
    if (window.confirm(UI.deleteConfirm)) {
      onDelete(pane.id)
    }
  }
  return (
    <>
      <section
        id={`pane-${pane.id}`}
        className={`terminal-pane minimal-pane status-${pane.status} ${isStalled ? 'status-stalled' : ''} ${isFocused ? 'is-focused' : ''}`}
        onMouseDownCapture={() => onFocus(pane.id)}
      >
        <header className="pane-header compact-header">
          <div className="pane-title-block">
            <div className="pane-led" />
            <div className="pane-title-stack">
              <input className="pane-title-input" value={pane.title} onChange={(event) => onUpdate(pane.id, { title: event.target.value })} />
              <p>{pane.statusText}</p>
            </div>
          </div>

          <div className="pane-header-actions pane-action-stack">
            <div className="pane-action-row icon-row">
              <button type="button" className="icon-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title={UI.backToTop}><ArrowUp size={16} /></button>
                            <details className="pane-menu" ref={menuRef} open={isMenuOpen} onToggle={(event) => setIsMenuOpen((event.currentTarget as HTMLDetailsElement).open)}>
                <summary className={hasOutgoingShare ? 'icon-button share-active' : 'icon-button'} aria-label={UI.paneMenu}>
                  <Share2 size={16} />
                </summary>
                <div className="pane-menu-surface share-menu-surface">
                  <div className="share-target-row">
                    <button type="button" aria-pressed={isGlobalShareActive} className={isGlobalShareActive ? 'menu-action compact-menu-action share-action-button is-sharing is-active' : 'menu-action compact-menu-action share-action-button'} onClick={() => onShare(pane.id)}><Share2 size={15} />{UI.shareGlobal}</button>
                    <label className={pane.autoShare ? 'menu-toggle share-checkbox compact-share-checkbox is-active' : 'menu-toggle share-checkbox compact-share-checkbox'}>
                      <input type="checkbox" checked={pane.autoShare} onChange={(event) => onUpdate(pane.id, { autoShare: event.target.checked })} />
                      <span>{UI.autoShareShort}</span>
                    </label>
                  </div>
                  {shareTargets.length > 0 && (
                    <div className="menu-share-group">
                      <span className="menu-section-label">{UI.shareDirect}</span>
                      <div className="menu-share-targets">
                        {shareTargets.map((target) => {
                          const isTargetActive = activeShareTargetIds.has(target.id)
                          const isAutoShareEnabled = pane.autoShareTargetIds.includes(target.id)
                          return (
                            <div key={target.id} className="share-target-row">
                              <button type="button" aria-pressed={isTargetActive} className={isTargetActive ? 'menu-action compact-menu-action share-action-button is-sharing is-active' : 'menu-action compact-menu-action share-action-button'} onClick={() => onShareToPane(pane.id, target.id)}>
                                <Share2 size={14} />
                                {target.title}
                              </button>
                              <label className={isAutoShareEnabled ? 'menu-toggle share-checkbox compact-share-checkbox is-active' : 'menu-toggle share-checkbox compact-share-checkbox'}>
                                <input type="checkbox" checked={isAutoShareEnabled} onChange={(event) => toggleAutoShareTarget(target.id, event.target.checked)} />
                                <span>{UI.autoShareShort}</span>
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <p className="menu-help">{UI.shareHint}</p>
                </div>
              </details>
              <button type="button" className="icon-button" disabled={!hasSessionRecords} onClick={() => setIsRunLogsExpanded(true)} title={UI.runLogs}><History size={16} /></button>
              <button type="button" className="icon-button danger" onClick={handleDelete} title={UI.deletePane}><Trash2 size={16} /></button>
            </div>

            <div className="pane-action-row launch-row">
              <button type="button" className="secondary-button pane-session-button" disabled={isBusy} onClick={() => onStartNewSession(pane.id)}><RefreshCcw size={16} />{UI.newSession}</button>
              <button type="button" className="secondary-button pane-vscode-button" disabled={isBusy} onClick={() => onDuplicate(pane.id)}><Copy size={16} />{UI.duplicatePane}</button>
              <button type="button" className="secondary-button pane-vscode-button" disabled={pane.workspaceMode === 'local' ? !pane.localWorkspacePath : !pane.sshHost || !pane.remoteWorkspacePath} onClick={() => onOpenWorkspace(pane.id)}><FolderOpen size={16} />{UI.openVsCode}</button>
            </div>
          </div>
        </header>

        <div className="status-strip compact">
          <span className="tiny-badge">{catalog?.label ?? pane.provider}</span>
          <span className="tiny-badge">{currentModel?.name ?? pane.model}</span>
          <span className="tiny-badge">{pane.workspaceMode === 'local' ? UI.localPc : UI.remotePc}</span>
          <span className="tiny-badge">{workspaceLabel}</span>
          <span className={isStalled ? 'tiny-badge warning' : 'tiny-badge'}>{isRunInProgress ? `\u5b9f\u884c ${formatElapsed(pane.runningSince, now)}` : isProviderUpdating ? `\u66f4\u65b0 ${formatElapsed(pane.runningSince, now)}` : `\u6700\u7d42 ${formatClock(pane.lastRunAt)}`}</span>
        </div>

        <section className="primary-panel output-panel">
          <div className="panel-header slim">
            <div>
              <h3>{UI.output}</h3>
              {hasOutput && pane.lastActivityAt ? <p>{`\u6700\u7d42\u66f4\u65b0 ${formatClock(pane.lastActivityAt)}`}</p> : null}
            </div>
            <div className="output-panel-actions">
              {incomingShareSources.length > 0 && (
                <div className="incoming-share-strip" aria-label={UI.sharedFrom}>
                  {incomingShareSources.map((source) => (
                    <span key={source.id} className="incoming-share-chip" title={`${UI.sharedFrom}: ${source.title}`}>
                      <Share2 size={12} />
                      <span className="incoming-share-chip-label">{source.title}</span>
                      {source.count > 1 ? <span className="incoming-share-chip-count">x{source.count}</span> : null}
                    </span>
                  ))}
                </div>
              )}
              <button type="button" className="icon-button" onClick={() => setIsOutputExpanded(true)} title={UI.outputExpand}><Maximize2 size={16} /></button>
            </div>
          </div>
          <div className="output-surface console-output" aria-label="output-console">
            {hasOutput ? <pre>{outputText}</pre> : <p className="panel-placeholder">{UI.outputPlaceholder}</p>}
          </div>
        </section>

        <section className="composer-panel minimal-composer">
          <div className="panel-header slim">
            <div>
              <h3>{UI.instruction}</h3>
              <p>{pane.workspaceMode === 'local' ? pane.localWorkspacePath || UI.workspaceUnset : pane.remoteWorkspacePath || UI.sshUnset}</p>
            </div>
          </div>
          <textarea
            ref={promptRef}
            value={pane.prompt}
            onChange={(event) => onUpdate(pane.id, { prompt: event.target.value })}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canRun && !isBusy) {
                event.preventDefault()
                onRun(pane.id)
              }
            }}
            placeholder={UI.promptPlaceholder}
          />
          <div className="composer-footer">
            <div className="composer-hint">
              {isRunInProgress ? (
                <><LoaderCircle size={16} className="spin" /><span>{isStalled ? UI.stalledHint : UI.runningHint}</span></>
              ) : isProviderUpdating ? (
                <><LoaderCircle size={16} className="spin" /><span>{UI.updatingHint}</span></>
              ) : pane.lastError ? (
                <><AlertTriangle size={16} /><span>{pane.lastError}</span></>
              ) : (
                <span>{workspaceLabel}</span>
              )}
            </div>
            <div className="composer-actions">
              {isRunInProgress ? (
                <button type="button" className="danger-button stable-run-button" onClick={() => onStop(pane.id)}><Square size={16} />{UI.stop}</button>
              ) : (
                <button type="button" className="primary-button stable-run-button" disabled={!canRun || isProviderUpdating} onClick={() => onRun(pane.id)}><Play size={16} />{UI.run}</button>
              )}
            </div>
          </div>
        </section>

        <div className="pane-accordion-group">
          <details className="pane-accordion settings-accordion" open={pane.settingsOpen} onToggle={(event) => onUpdate(pane.id, { settingsOpen: (event.currentTarget as HTMLDetailsElement).open })}>
            <summary className="accordion-summary">
              <span className="accordion-label"><Settings2 size={15} />{UI.settings}</span>
              <span className="accordion-meta">
                <span className="accordion-value">{catalog?.label ?? pane.provider} / {currentModel?.name ?? pane.model}</span>
                <span className={`accordion-caret ${pane.settingsOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
              </span>
            </summary>
            <div className="accordion-body">
              <div className="pane-meta-grid compact-grid">
                <label>
                  <span>{UI.cli}</span>
                  <select value={pane.provider} onChange={(event) => onProviderChange(pane.id, event.target.value as ProviderId)}>
                    {(['codex', 'copilot', 'gemini'] as ProviderId[]).map((provider) => {
                      const item = catalogs[provider]
                      const disabled = pane.workspaceMode === 'ssh' && !availableRemoteProviders.includes(provider)
                      return <option key={provider} value={provider} disabled={disabled}>{item.label}{disabled ? ' (SSH unavailable)' : ''}</option>
                    })}
                  </select>
                </label>
                <label>
                  <span>{UI.model}</span>
                  <select value={pane.model} onChange={(event) => onModelChange(pane.id, event.target.value)}>
                    {catalog?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>{UI.reasoning}</span>
                  <select value={pane.reasoningEffort} disabled={!canSelectReasoning} onChange={(event) => onUpdate(pane.id, { reasoningEffort: event.target.value as PaneState['reasoningEffort'] })}>
                    {canSelectReasoning ? reasoningOptions.map((effort) => <option key={effort} value={effort}>{effort}</option>) : <option value={pane.reasoningEffort}>{UI.reasoningUnavailable}</option>}
                  </select>
                </label>
                <label>
                  <span>{UI.executionStyle}</span>
                  <select value={pane.autonomyMode} disabled={pane.provider === 'codex'} onChange={(event) => onUpdate(pane.id, { autonomyMode: event.target.value === 'max' ? 'max' : 'balanced' })}>
                    <option value="balanced">{UI.normal}</option>
                    <option value="max">{UI.active}</option>
                  </select>
                </label>
                <label>
                  <span>{UI.fastMode}</span>
                  <select value={pane.codexFastMode} disabled={pane.provider !== 'codex'} onChange={(event) => onUpdate(pane.id, { codexFastMode: event.target.value === 'fast' ? 'fast' : 'off' })}>
                    {pane.provider === 'codex' ? (
                      <>
                        <option value="off">{UI.fastOff}</option>
                        <option value="fast">{UI.fastOn}</option>
                      </>
                    ) : (
                      <option value="off">{UI.unchanged}</option>
                    )}
                  </select>
                </label>
                <div className="settings-action-field full-span">
                  <span>{UI.updateCliField}</span>
                  <button type="button" className="secondary-button provider-update-button" disabled={providerUpdating} onClick={() => onUpdateProviderCli(pane.id)}>
                    {providerUpdateLabel}
                  </button>
                </div>
              </div>
              <p className="field-note">{pane.provider === 'codex' ? UI.readonlyCodex : UI.styleHint}</p>
            </div>
          </details>
          <details className="pane-accordion workspace-accordion" open={pane.workspaceOpen} onToggle={(event) => onUpdate(pane.id, { workspaceOpen: (event.currentTarget as HTMLDetailsElement).open })}>
            <summary className="accordion-summary">
              <span className="accordion-label"><FolderOpen size={15} />{UI.workspace}</span>
              <span className="accordion-meta">
                <span className="accordion-value">{workspaceLabel}</span>
                <span className={`accordion-caret ${pane.workspaceOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
              </span>
            </summary>
            <div className="accordion-body">
              <div className="workspace-switch compact-switch">
                <button type="button" className={pane.workspaceMode === 'local' ? 'switch-button active' : 'switch-button'} onClick={() => onUpdate(pane.id, { workspaceMode: 'local' })}>{UI.localPc}</button>
                <button type="button" className={pane.workspaceMode === 'ssh' ? 'switch-button active' : 'switch-button'} onClick={() => onUpdate(pane.id, { workspaceMode: 'ssh' })}>{UI.remotePc}</button>
              </div>

              {pane.workspaceMode === 'local' ? (
                <div className="workspace-stack">
                  <div className="workspace-primary-action">
                    <button type="button" className="primary-button workspace-choose-button" onClick={() => onAddLocalWorkspace(pane.id)}><FolderPlus size={16} />{UI.chooseWorkspace}</button>
                  </div>
                  <div className="workspace-current">
                    <span className="workspace-caption">{UI.currentWorkspace}</span>
                    <strong>{selectedLocalWorkspace?.label ?? getShortPathLabel(pane.localWorkspacePath || UI.unselected)}</strong>
                    <span>{pane.localWorkspacePath || UI.browseEmpty}</span>
                  </div>
                  {canRemoveLocalWorkspace && (
                    <div className="inline-actions wrap-actions compact-utility-row workspace-secondary-actions">
                      <button type="button" className="secondary-button" onClick={() => onRemoveLocalWorkspace(pane.id)}><Trash2 size={16} />{UI.removeFromList}</button>
                    </div>
                  )}
                  {localWorkspaces.length > 1 && (
                    <label>
                      <span>{UI.savedWorkspaces}</span>
                      <select value={pane.localWorkspacePath} onChange={(event) => onSelectLocalWorkspace(pane.id, event.target.value)}>
                        {localWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.path}>{workspace.label}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="browser-panel workspace-browser-shell">
                    <div className="section-headline compact-headline browser-headline">
                      <div><strong>{UI.folderContents}</strong><span className="browser-current-path">{getShortPathLabel(pane.localBrowserPath || pane.localWorkspacePath || '')}</span></div>
                      <div className="browser-toolbar-actions">
                        {!isAtLocalWorkspaceTop && <button type="button" className="ghost-button compact-ghost" onClick={() => onBrowseLocal(pane.id, pane.localWorkspacePath)}><Home size={14} />{UI.workspaceTop}</button>}
                        {localParentPath && <button type="button" className="ghost-button compact-ghost" onClick={() => onBrowseLocal(pane.id, localParentPath)}><ChevronLeft size={14} />{UI.oneLevelUp}</button>}
                      </div>
                    </div>
                    <div className="browser-simple-list browser-list-shell">
                      {pane.localBrowserEntries.length > 0 ? (
                        pane.localBrowserEntries.map((entry) => (
                          <div key={entry.path} className={`browser-row ${entry.isDirectory ? 'directory' : 'file'}`}>
                            <button type="button" draggable className="browser-row-main browser-simple-item" onDragStart={(event) => startLocalDrag(event, entry.path)} onClick={() => entry.isDirectory ? onBrowseLocal(pane.id, entry.path) : onOpenPath(pane.id, entry.path, 'file')}>
                              <span className="browser-row-icon">{entry.isDirectory ? <Folder size={16} /> : <FileText size={16} />}</span>
                              <span className="browser-row-label">{entry.label}</span>
                            </button>
                          </div>
                        ))
                      ) : <div className="panel-placeholder browser-placeholder">{pane.localBrowserLoading ? UI.browseLoading : UI.browseEmpty}</div>}
                    </div>
                  </div>
                </div>
              ) : (                <div className="workspace-stack ssh-stack compact-ssh-stack">
                  <div className="workspace-current ssh-current-card">
                    <span className="workspace-caption">{UI.currentConnection}</span>
                    <strong>{sshDisplayName || UI.sshUnset}</strong>
                    <span>{pane.remoteWorkspacePath || pane.remoteBrowserPath || UI.workspaceUnset}</span>
                  </div>

                  <div className="pane-meta-grid compact-grid ssh-primary-grid">
                    <label>
                      <span>SSH Host / IP</span>
                      <input list={`ssh-hosts-${pane.id}`} value={pane.sshHost} onChange={(event) => onUpdate(pane.id, { sshHost: event.target.value })} placeholder="server.example.com / 192.168.1.20 / ssh-config host" />
                      <datalist id={`ssh-hosts-${pane.id}`}>{sshHosts.map((host) => <option key={host.id} value={host.alias} />)}</datalist>
                    </label>
                    <label>
                      <span>{UI.remoteWorkspace}</span>
                      <input list={`remote-workspaces-${pane.id}`} value={pane.remoteWorkspacePath} onChange={(event) => onUpdate(pane.id, { remoteWorkspacePath: event.target.value, sshRemotePath: event.target.value, remoteShellPath: event.target.value })} placeholder="~/projects/app" />
                      <datalist id={`remote-workspaces-${pane.id}`}>{pane.remoteWorkspaces.map((workspace) => <option key={workspace.path} value={workspace.path}>{workspace.label}</option>)}</datalist>
                    </label>
                  </div>



                  <details className="ssh-mini-accordion">
                    <summary className="ssh-mini-summary"><span className="ssh-mini-summary-row"><span>{UI.connectionSettings}</span><span className="ssh-mini-caret"><ChevronDown size={14} /></span></span></summary>
                    <div className="pane-meta-grid compact-grid ssh-config-grid compact-ssh-grid">
                      <label><span>User</span><input value={pane.sshUser} onChange={(event) => onUpdate(pane.id, { sshUser: event.target.value })} placeholder="yourusername / ubuntu" /></label>
                      <label><span>Port</span><input value={pane.sshPort} onChange={(event) => onUpdate(pane.id, { sshPort: event.target.value })} placeholder="22" /></label>
                      <label><span>Password</span><input type="password" value={pane.sshPassword} onChange={(event) => onUpdate(pane.id, { sshPassword: event.target.value })} placeholder="optional" /></label>
                      <label><span>Identity File</span><input value={pane.sshIdentityFile} onChange={(event) => onUpdate(pane.id, { sshIdentityFile: event.target.value })} placeholder="C:\\Users\\...\\id_ed25519" /></label>
                      {pane.sshLocalKeys.length > 0 && (
                        <label className="full-span">
                          <span>{UI.publicKey}</span>
                          <select value={pane.sshSelectedKeyPath} onChange={(event) => {
                            const selected = pane.sshLocalKeys.find((item) => item.privateKeyPath === event.target.value) ?? null
                            onUpdate(pane.id, { sshSelectedKeyPath: event.target.value, sshIdentityFile: event.target.value, sshPublicKeyText: selected?.publicKey ?? pane.sshPublicKeyText })
                          }}>
                            {pane.sshLocalKeys.map((key) => <option key={key.privateKeyPath} value={key.privateKeyPath}>{key.name}</option>)}
                          </select>
                        </label>
                      )}
                    </div>

                    <div className="inline-actions wrap-actions compact-utility-row ssh-key-actions">
                      <button type="button" className="secondary-button" onClick={() => onGenerateSshKey(pane.id)}>{UI.generateKey}</button>
                      <button type="button" className="secondary-button" disabled={!pane.sshPublicKeyText.trim() || !pane.sshHost.trim()} onClick={() => onInstallSshPublicKey(pane.id)}>{UI.installKey}</button>
                    </div>

                    {pane.sshPublicKeyText && (
                      <div className="browser-panel">
                        <div className="section-headline compact-headline"><strong>{UI.publicKey}</strong><span>{getShortPathLabel(pane.sshSelectedKeyPath || pane.sshIdentityFile || '')}</span></div>
                        <div className="output-surface inline-console-output"><pre>{pane.sshPublicKeyText}</pre></div>
                      </div>
                    )}
                  </details>

                  <details className="ssh-mini-accordion">
                    <summary className="ssh-mini-summary"><span className="ssh-mini-summary-row"><span>{UI.connectionSupport}</span><span className="ssh-mini-caret"><ChevronDown size={14} /></span></span></summary>
                    <div className="workspace-stack ssh-support-stack">
                      <div className="pane-meta-grid compact-grid ssh-config-grid compact-ssh-grid">
                        <label><span>ProxyJump</span><input value={pane.sshProxyJump} onChange={(event) => onUpdate(pane.id, { sshProxyJump: event.target.value })} placeholder="jump-host" /></label>
                        <label><span>ProxyCommand</span><input value={pane.sshProxyCommand} onChange={(event) => onUpdate(pane.id, { sshProxyCommand: event.target.value })} placeholder="connect-proxy -H proxy.example.com:8080 %h %p" /></label>
                        <label className="full-span"><span>Extra Args</span><input value={pane.sshExtraArgs} onChange={(event) => onUpdate(pane.id, { sshExtraArgs: event.target.value })} placeholder="-o PreferredAuthentications=password" /></label>
                      </div>
                      <p className="ssh-help-note">{'HTTP(S) \u30d7\u30ed\u30ad\u30b7 URL \u306f ProxyCommand \u306b connect-proxy / corkscrew \u5f62\u5f0f\u3067\u8a2d\u5b9a\u3057\u307e\u3059\u3002\u4f8b: connect-proxy -H proxy.example.com:8080 %h %p'}</p>

                      {pane.sshDiagnostics.length > 0 && (
                        <div className="browser-panel ssh-diagnostics-panel">
                          <div className="section-headline compact-headline"><strong>{UI.diagnostics}</strong><span>{pane.sshDiagnostics.length}</span></div>
                          <div className="diagnostic-list">{pane.sshDiagnostics.map((item, index) => <div key={`${pane.id}-diag-${index}`} className="diagnostic-item">{item}</div>)}</div>
                        </div>
                      )}
                    </div>
                  </details>

                  <div className="workspace-primary-action remote-connect-action">
                    <button type="button" className="primary-button workspace-choose-button remote-connect-button" onClick={() => onLoadRemote(pane.id)}><Wifi size={16} />{UI.refreshConnection}</button>
                  </div>

                  <div className={`browser-panel workspace-browser-shell remote-browser-shell ${remoteDropTarget === remoteBaseDropPath ? 'is-drop-active' : ''}`} onDragOver={(event) => { if (remoteBaseDropPath) { allowRemoteDrop(event, remoteBaseDropPath) } }} onDragLeave={clearRemoteDrop} onDrop={(event) => { if (remoteBaseDropPath) { handleRemoteDrop(event, remoteBaseDropPath) } }}>
                    <div className="section-headline compact-headline browser-headline ssh-browser-headline">
                      <div><strong>{UI.remoteList}</strong><span className="browser-current-path">{pane.remoteBrowserLoading ? UI.remoteLoading : pane.remoteBrowserPath || pane.remoteHomeDirectory || UI.sshUnset}</span></div>
                      <div className="browser-toolbar-actions wide-toolbar-actions">
                        <button type="button" className="ghost-button compact-ghost" disabled={!pane.remoteHomeDirectory} onClick={() => onBrowseRemote(pane.id, pane.remoteHomeDirectory || undefined)}><Home size={14} />Home</button>
                        <button type="button" className="ghost-button compact-ghost" disabled={!pane.remoteParentPath} onClick={() => onBrowseRemote(pane.id, pane.remoteParentPath || undefined)}><ChevronLeft size={14} />{UI.oneLevelUp}</button>
                        <button type="button" className="ghost-button compact-ghost" disabled={!remoteBaseDropPath} onClick={() => onCreateRemoteDirectory(pane.id)}><FolderPlus size={14} />{UI.createFolder}</button>
                        <button type="button" className="ghost-button compact-ghost" disabled={!remoteBaseDropPath} onClick={() => remoteBaseDropPath && onTransferSshPath(pane.id, 'download', { remotePath: remoteBaseDropPath, remoteLabel: currentRemoteLabel, isDirectory: true })}>{UI.downloadCurrent}</button>
                      </div>
                    </div>

                    <p className="browser-inline-note">{UI.dragHint}</p>
                    <div className="browser-list browser-list-shell remote-browser-list-modern">
                      {pane.remoteBrowserEntries.length > 0 ? (
                        pane.remoteBrowserEntries.map((entry) => (
                          <div key={entry.path} className={`browser-entry remote-entry modern-remote-entry ${entry.path === pane.remoteWorkspacePath ? 'active' : ''} ${remoteDropTarget === entry.path ? 'drop-ready' : ''}`} onDragOver={(event) => { if (entry.isDirectory) { allowRemoteDrop(event, entry.path) } }} onDragLeave={clearRemoteDrop} onDrop={(event) => { if (entry.isDirectory) { handleRemoteDrop(event, entry.path) } }}>
                            <button type="button" className="browser-entry-main browser-entry-button modern-browser-button" onClick={() => entry.isDirectory ? onBrowseRemote(pane.id, entry.path) : onOpenPath(pane.id, entry.path, 'file')}>
                              {entry.isDirectory ? <Folder size={16} /> : <FileText size={16} />}
                              <div><strong>{entry.label}</strong><span>{entry.path}</span></div>
                            </button>
                            <div className="browser-entry-actions">
                              {entry.isDirectory && <button type="button" className={entry.isWorkspace ? 'ghost-button workspace' : 'ghost-button'} onClick={() => onUpdate(pane.id, { remoteWorkspacePath: entry.path, sshRemotePath: entry.path, remoteShellPath: entry.path })}>{UI.useWorkspace}</button>}
                              <button type="button" className="ghost-button" onClick={() => onTransferSshPath(pane.id, 'download', { remotePath: entry.path, remoteLabel: entry.label, isDirectory: entry.isDirectory })}>{UI.receive}</button>
                            </div>
                          </div>
                        ))
                      ) : <div className="panel-placeholder browser-placeholder">{pane.remoteBrowserLoading ? UI.remoteLoading : UI.remoteEmpty}</div>}
                    </div>
                    <div className="badge-row">{pane.remoteAvailableProviders.length > 0 ? pane.remoteAvailableProviders.map((provider) => <span key={provider} className="availability-badge">{catalogs[provider].label}</span>) : <span className="availability-badge muted">CLI unavailable</span>}</div>
                  </div>
                </div>
              )}
            </div>
          </details>
          <details className="pane-accordion shell-accordion" open={pane.shellOpen} onToggle={(event) => onUpdate(pane.id, { shellOpen: (event.currentTarget as HTMLDetailsElement).open })}>
            <summary className="accordion-summary">
              <span className="accordion-label"><Square size={15} />{UI.embeddedTerminal}</span>
              <span className="accordion-meta">
                <span className="accordion-value">{currentShellPath || (pane.workspaceMode === 'local' ? UI.workspaceUnset : UI.sshUnset)}</span>
                <span className={`accordion-caret ${pane.shellOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
              </span>
            </summary>
            <div className="accordion-body shell-panel shell-panel-inline">
              <div className="panel-header slim shell-panel-header">
                <div>
                  <h3>{UI.embeddedTerminal}</h3>
                  <p>{currentShellPath || (pane.workspaceMode === 'local' ? UI.workspaceUnset : UI.sshUnset)}</p>
                </div>
                <button type="button" className="icon-button" onClick={() => setIsShellExpanded(true)} title={UI.shellExpand}><Maximize2 size={16} /></button>
              </div>
              <div className="output-surface console-output shell-console shell-console-interactive" aria-label="embedded-terminal-output" ref={shellConsoleRef} onClick={() => shellInputRef.current?.focus()}>
                {pane.shellOutput ? <pre>{pane.shellOutput}</pre> : null}
                <div className="shell-console-entry">
                  <span className="shell-prompt">{shellPromptLabel}</span>
                  <input
                    ref={shellInputRef}
                    className="shell-inline-input"
                    value={pane.shellCommand}
                    onChange={(event) => updateShellCommand(event.target.value)}
                    onKeyDown={handleShellKeyDown}
                    disabled={pane.shellRunning}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  {pane.shellRunning ? <LoaderCircle size={14} className="spin shell-inline-spinner" /> : null}
                </div>
              </div>
            </div>
          </details>

          {(visibleSharedContext.length > 0 || pane.attachedContextIds.length > 0) && (
            <details className="pane-accordion">
              <summary className="accordion-summary">
                <span className="accordion-label"><Share2 size={15} />{UI.sharedContext}</span>
                <span className="accordion-value">{`${pane.attachedContextIds.length} ${UI.selectedCount}`}</span>
              </summary>
              <div className="accordion-body">
                <div className="chip-list">
                  {visibleSharedContext.length > 0 ? visibleSharedContext.map((item) => {
                    const attached = pane.attachedContextIds.includes(item.id)
                    const consumed = item.consumedByPaneIds.includes(pane.id)
                    return (
                      <button key={item.id} type="button" className={attached ? 'context-chip active' : 'context-chip'} onClick={() => onToggleContext(pane.id, item.id)} title={item.detail}>
                        <strong>{item.sourcePaneTitle}</strong>
                        <span>{item.contentLabel} / {item.scope === 'global' ? UI.shareGlobal : UI.shareDirect}</span>
                        <span>{attached ? UI.shareHint : consumed ? '使用済み / もう一度使うなら再選択' : item.summary}</span>
                      </button>
                    )
                  }) : <div className="empty-chip-row">{UI.noSharedContext}</div>}
                </div>
              </div>
            </details>
          )}

        </div>
      </section>

      {isOutputExpanded && (
        <div className="output-modal-backdrop">
          <div className="output-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div><h3>{UI.output}</h3><p>{pane.title}</p></div>
              <button type="button" className="icon-button" onClick={() => setIsOutputExpanded(false)} title="close"><X size={16} /></button>
            </div>
            <div className="output-modal-body">{hasOutput ? <pre>{outputText}</pre> : null}</div>
            <div className="output-modal-footer"><button type="button" className="secondary-button" disabled={!outputText} onClick={() => onCopyOutput(pane.id)}><Copy size={16} />{UI.copyOutput}</button></div>
          </div>
        </div>
      )}

      {isRunLogsExpanded && (
        <div className="output-modal-backdrop">
          <div className="output-modal run-logs-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div><h3>{UI.runLogs}</h3><p>{pane.title}</p></div>
              <button type="button" className="icon-button" onClick={() => setIsRunLogsExpanded(false)} title={UI.close}><X size={16} /></button>
            </div>
            <div className="output-modal-body run-logs-modal-body">
              {hasSessionRecords ? (
                <>
                  {sessionOptions.length > 1 && (
                    <label className="session-selector">
                      <span>{UI.session}</span>
                      <select value={selectedArchivedSession?.key ?? '__current__'} onChange={(event) => onSelectSession(pane.id, event.target.value === '__current__' ? null : event.target.value)}>
                        {sessionOptions.map((session) => <option key={session.key} value={session.key}>{session.label}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="session-log-meta"><strong>{visibleSession.label}</strong><span>{formatClock(visibleSession.updatedAt)}</span></div>
                  <div className="run-logs-modal-grid">
                    {visibleSession.streamEntries.length > 0 && (
                      <div className="activity-panel">
                        <div className="section-headline compact-headline"><strong>{UI.stream}</strong><span>{visibleSession.streamEntries.length}</span></div>
                        <div className="activity-feed">
                          {visibleSession.streamEntries.map((entry) => (
                            <article key={entry.id} className={`activity-entry ${entry.kind}`}>
                              <header><strong>{entry.kind}</strong><span>{formatClock(entry.createdAt)}</span></header>
                              <p>{entry.text}</p>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                    {visibleSession.logs.length > 0 && (
                      <div className="history-panel">
                        <div className="section-headline compact-headline"><strong>{UI.conversation}</strong><span>{visibleSession.logs.length}</span></div>
                        <div className="history-feed">
                          {visibleSession.logs.map((entry) => (
                            <article key={entry.id} className={`history-entry ${entry.role}`}>
                              <header><strong>{entry.role === 'assistant' ? pane.provider : entry.role}</strong><span>{formatClock(entry.createdAt)}</span></header>
                              <p>{entry.text}</p>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                    {visibleSession.streamEntries.length === 0 && visibleSession.logs.length === 0 && <p className="panel-placeholder run-logs-empty">{UI.runLogsEmpty}</p>}
                  </div>
                </>
              ) : <p className="panel-placeholder run-logs-empty">{UI.runLogsEmpty}</p>}
            </div>
            <div className="output-modal-footer"><button type="button" className="secondary-button" onClick={() => setIsRunLogsExpanded(false)}><X size={16} />{UI.close}</button></div>
          </div>
        </div>
      )}

      {isShellExpanded && (
        <div className="output-modal-backdrop">
          <div className="output-modal shell-output-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div><h3>{UI.embeddedTerminal}</h3><p>{pane.title}</p></div>
              <button type="button" className="icon-button" onClick={() => setIsShellExpanded(false)} title="close"><X size={16} /></button>
            </div>
            <div className="output-modal-body shell-modal-body">
              <div className="output-surface console-output shell-console shell-console-interactive" ref={shellModalConsoleRef} onClick={() => shellModalInputRef.current?.focus()}>
                {pane.shellOutput ? <pre>{pane.shellOutput}</pre> : null}
                <div className="shell-console-entry">
                  <span className="shell-prompt">{shellPromptLabel}</span>
                  <input
                    ref={shellModalInputRef}
                    className="shell-inline-input"
                    value={pane.shellCommand}
                    onChange={(event) => updateShellCommand(event.target.value)}
                    onKeyDown={handleShellKeyDown}
                    disabled={pane.shellRunning}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  {pane.shellRunning ? <LoaderCircle size={14} className="spin shell-inline-spinner" /> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

