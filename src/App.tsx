import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Bot,
  CheckCircle2,
  Grid2x2,
  LayoutPanelTop,
  Plus,
  RefreshCcw,
  SplitSquareHorizontal,
  Wifi,
  XCircle
} from 'lucide-react'
import { TerminalPane } from './components/TerminalPane'
import {
  browseRemoteDirectory,
  browseLocalDirectory,
  createRemoteDirectory,
  fetchBootstrap,
  fetchRemoteWorkspaces,
  inspectSshHost,
  openWorkspaceInVsCode,
  pickLocalWorkspace,
  runPaneStream,
  stopPaneRun
} from './lib/api'
import type {
  BootstrapPayload,
  LocalWorkspace,
  PaneLogEntry,
  PaneSessionRecord,
  PaneState,
  PaneStatus,
  ProviderCatalogResponse,
  ProviderId,
  ReasoningEffort,
  RemoteDirectoryEntry,
  RunStreamEvent,
  SharedContextItem,
  WorkspaceTarget
} from './types'

type LayoutMode = 'quad' | 'triple' | 'focus'

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
const MAX_LIVE_OUTPUT = 64_000
const MAX_SHARED_CONTEXT = 16
const STALL_MS = 45_000

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}\n\n[truncated]`
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

function statusLabel(status: PaneStatus): string {
  switch (status) {
    case 'running':
      return '実行中'
    case 'completed':
      return '完了'
    case 'attention':
      return '入力/確認待ち'
    case 'error':
      return 'エラー'
    default:
      return '待機中'
  }
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'codex' || value === 'copilot' || value === 'gemini'
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

function isAbortLikeMessage(message: string): boolean {
  return /stopped|stop requested|terminated|aborted|cancel|signal/i.test(message)
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

function buildSessionLabel(sessionId: string | null, createdAt: number): string {
  if (sessionId) {
    return `セッション ${sessionId.slice(0, 8)}`
  }

  return `セッション ${new Date(createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
}

function createArchivedSessionRecord(pane: PaneState): PaneSessionRecord {
  const createdAt = pane.lastRunAt ?? pane.lastActivityAt ?? pane.lastFinishedAt ?? Date.now()
  const updatedAt = pane.lastActivityAt ?? pane.lastFinishedAt ?? createdAt

  return {
    key: createId('session'),
    label: buildSessionLabel(pane.sessionId, createdAt),
    sessionId: pane.sessionId,
    createdAt,
    updatedAt,
    status: pane.status,
    logs: pane.logs.slice(-MAX_LOGS),
    streamEntries: pane.streamEntries.slice(-MAX_STREAM_ENTRIES)
  }
}

function appendSessionRecord(history: PaneSessionRecord[], record: PaneSessionRecord): PaneSessionRecord[] {
  return [record, ...history].slice(0, MAX_SESSION_HISTORY)
}

function buildTargetFromPane(pane: PaneState, localWorkspaces: LocalWorkspace[]): WorkspaceTarget | null {
  if (pane.workspaceMode === 'local') {
    if (!pane.localWorkspacePath.trim()) {
      return null
    }

    const workspace = localWorkspaces.find((item) => item.path === pane.localWorkspacePath)
    return {
      kind: 'local',
      path: pane.localWorkspacePath,
      label: workspace?.label ?? pane.localWorkspacePath,
      resourceType: 'folder'
    }
  }

  if (!pane.sshHost.trim() || !pane.remoteWorkspacePath.trim()) {
    return null
  }

  return {
    kind: 'ssh',
    host: pane.sshHost.trim(),
    path: pane.remoteWorkspacePath.trim(),
    label: `${pane.sshHost.trim()}:${pane.remoteWorkspacePath.trim()}`,
    resourceType: 'folder'
  }
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
    provider,
    model,
    reasoningEffort: defaultReasoning,
    autonomyMode: 'balanced',
    status: 'idle',
    statusText: statusLabel('idle'),
    workspaceMode: 'local',
    localWorkspacePath: firstWorkspace?.path ?? '',
    localBrowserPath: '',
    localBrowserEntries: [],
    localBrowserLoading: false,
    sshHost: '',
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
    autoShare: false,
    lastRunAt: null,
    runningSince: null,
    lastActivityAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResponse: null
  }
}

function createSharedContextItem(pane: PaneState, target: WorkspaceTarget | null, response: string): SharedContextItem {
  return {
    id: createId('context'),
    sourcePaneId: pane.id,
    sourcePaneTitle: pane.title,
    provider: pane.provider,
    workspaceLabel: target?.label ?? '未選択',
    summary: summarize(response),
    detail: clipText(response, 16_000),
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

function getShareableText(pane: PaneState): string | null {
  if (pane.selectedSessionKey) {
    const selectedSession = pane.sessionHistory.find((session) => session.key === pane.selectedSessionKey)
    if (selectedSession) {
      const latestAssistant = [...selectedSession.logs].reverse().find((entry) => entry.role === 'assistant')?.text
      if (latestAssistant?.trim()) {
        return latestAssistant
      }

      const combinedLogs = selectedSession.logs.map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`).join('\n\n').trim()
      if (combinedLogs) {
        return combinedLogs
      }

      const combinedStream = selectedSession.streamEntries.map((entry) => `[${entry.kind}] ${entry.text}`).join('\n').trim()
      if (combinedStream) {
        return combinedStream
      }
    }
  }

  return getLatestAssistantText(pane)
}

function resetActiveSessionFields(pane: PaneState): PaneState {
  return {
    ...pane,
    prompt: '',
    status: 'idle',
    statusText: statusLabel('idle'),
    logs: [],
    streamEntries: [],
    selectedSessionKey: null,
    liveOutput: '',
    sessionId: null,
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
    sharedContext: readJsonStorage<SharedContextItem[]>(STORAGE_KEYS.sharedContext, []),
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

function normalizeRemoteDirectoryEntry(rawEntry: Partial<RemoteDirectoryEntry> | null | undefined): RemoteDirectoryEntry | null {
  if (!rawEntry?.label || !rawEntry.path) {
    return null
  }

  return {
    label: rawEntry.label,
    path: rawEntry.path,
    isWorkspace: Boolean(rawEntry.isWorkspace)
  }
}

function normalizeSessionRecord(rawRecord: Partial<PaneSessionRecord> | null | undefined): PaneSessionRecord | null {
  if (!rawRecord?.key || !rawRecord.label) {
    return null
  }

  return {
    key: rawRecord.key,
    label: rawRecord.label,
    sessionId: typeof rawRecord.sessionId === 'string' ? rawRecord.sessionId : null,
    createdAt: typeof rawRecord.createdAt === 'number' ? rawRecord.createdAt : Date.now(),
    updatedAt: typeof rawRecord.updatedAt === 'number' ? rawRecord.updatedAt : null,
    status:
      rawRecord.status === 'completed' || rawRecord.status === 'attention' || rawRecord.status === 'error' || rawRecord.status === 'running'
        ? rawRecord.status
        : 'idle',
    logs: Array.isArray(rawRecord.logs) ? rawRecord.logs.slice(-MAX_LOGS) : [],
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
  const allowedLocalPaths = new Set(localWorkspaces.map((item) => item.path))
  const localWorkspacePath =
    typeof rawPane.localWorkspacePath === 'string' && allowedLocalPaths.has(rawPane.localWorkspacePath)
      ? rawPane.localWorkspacePath
      : localWorkspaces[0]?.path ?? ''
  const rawStatus = rawPane.status ?? 'idle'
  const restoredStatus: PaneStatus =
    rawStatus === 'running'
      ? 'attention'
      : rawStatus === 'completed' || rawStatus === 'attention' || rawStatus === 'error'
        ? rawStatus
        : 'idle'
  const remoteBrowserEntries = Array.isArray(rawPane.remoteBrowserEntries)
    ? rawPane.remoteBrowserEntries
        .map((entry) => normalizeRemoteDirectoryEntry(entry))
        .filter((entry): entry is RemoteDirectoryEntry => Boolean(entry))
    : []
  const statusText =
    rawStatus === 'running' ? '前回の実行は切断されました' : typeof rawPane.statusText === 'string' ? rawPane.statusText : statusLabel(restoredStatus)

  return {
    id: rawPane.id ?? createId('pane'),
    title: typeof rawPane.title === 'string' && rawPane.title.trim() ? rawPane.title : 'Task',
    provider,
    model,
    reasoningEffort,
    autonomyMode: rawPane.autonomyMode === 'max' ? 'max' : 'balanced',
    status: restoredStatus,
    statusText,
    workspaceMode,
    localWorkspacePath,
    localBrowserPath: typeof rawPane.localBrowserPath === 'string' ? rawPane.localBrowserPath : '',
    localBrowserEntries: Array.isArray(rawPane.localBrowserEntries) ? rawPane.localBrowserEntries : [],
    localBrowserLoading: false,
    sshHost: typeof rawPane.sshHost === 'string' ? rawPane.sshHost : '',
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
    autoShare: Boolean(rawPane.autoShare),
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
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const panesRef = useRef<PaneState[]>([])
  const localWorkspacesRef = useRef<LocalWorkspace[]>([])
  const sharedContextRef = useRef<SharedContextItem[]>([])
  const controllersRef = useRef<Record<string, AbortController>>({})
  const stopRequestedRef = useRef<Set<string>>(new Set())
  const streamErroredRef = useRef<Set<string>>(new Set())

  panesRef.current = panes
  localWorkspacesRef.current = localWorkspaces
  sharedContextRef.current = sharedContext

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const controller of Object.values(controllersRef.current)) {
        controller.abort()
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

  const refreshBootstrap = async () => {
    setLoading(true)
    setGlobalError(null)

    try {
      const payload = await fetchBootstrap()
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
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshBootstrap()
  }, [])

  const catalogs = bootstrap?.providers ?? EMPTY_CATALOGS
  const selectedPane = panes.find((pane) => pane.id === focusedPaneId) ?? panes[0] ?? null
  const visiblePanes = layout === 'focus' ? (selectedPane ? [selectedPane] : []) : panes

  const metrics = useMemo(() => {
    const result = {
      running: 0,
      completed: 0,
      attention: 0,
      error: 0,
      stalled: 0
    }

    for (const pane of panes) {
      if (pane.status === 'running') {
        result.running += 1
      } else if (pane.status === 'completed') {
        result.completed += 1
      } else if (pane.status === 'attention') {
        result.attention += 1
      } else if (pane.status === 'error') {
        result.error += 1
      }

      if (pane.status === 'running' && pane.lastActivityAt !== null && now - pane.lastActivityAt > STALL_MS) {
        result.stalled += 1
      }
    }

    return result
  }, [now, panes])

  const updatePane = (paneId: string, updates: Partial<PaneState>) => {
    setPanes((current) => current.map((pane) => (pane.id === paneId ? { ...pane, ...updates } : pane)))
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

  const scrollToPane = (paneId: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`pane-${paneId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })
  }

  const handleSelectPane = (paneId: string, shouldScroll = false) => {
    setFocusedPaneId(paneId)
    if (shouldScroll) {
      scrollToPane(paneId)
    }
  }

  const handleProviderChange = (paneId: string, provider: ProviderId) => {
    if (!bootstrap) {
      return
    }

    const nextModel = bootstrap.providers[provider].models[0]
    updatePane(paneId, {
      provider,
      model: nextModel?.id ?? '',
      reasoningEffort: nextModel?.defaultReasoningEffort ?? 'medium'
    })
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
      reasoningEffort
    })
  }

  const handleToggleContext = (paneId: string, contextId: string) => {
    setPanes((current) =>
      current.map((pane) => {
        if (pane.id !== paneId) {
          return pane
        }

        const attached = pane.attachedContextIds.includes(contextId)
        return {
          ...pane,
          attachedContextIds: attached
            ? pane.attachedContextIds.filter((item) => item !== contextId)
            : [...pane.attachedContextIds, contextId]
        }
      })
    )
  }

  const shareFromPane = (paneId: string, responseOverride?: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const response = responseOverride ?? getShareableText(pane)
    if (!response) {
      return
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current)
    const contextItem = createSharedContextItem(pane, target, response)
    setSharedContext((current) => [contextItem, ...current].slice(0, MAX_SHARED_CONTEXT))
    appendPaneSystemMessage(paneId, '結果を共有へ追加しました')
  }

  const handleStreamEvent = (paneId: string, event: RunStreamEvent) => {
    const eventAt = Date.now()

    if (event.type === 'assistant-delta') {
      startTransition(() => {
        mutatePane(paneId, (pane) => ({
          ...pane,
          liveOutput: appendLiveOutputChunk(pane.liveOutput, event.text),
          lastActivityAt: eventAt,
          statusText: '応答を生成中'
        }))
      })
      return
    }

    if (event.type === 'session') {
      const sessionLine = `[session] ${event.sessionId}`
      mutatePane(paneId, (pane) => ({
        ...pane,
        sessionId: event.sessionId,
        lastActivityAt: eventAt,
        liveOutput: appendLiveOutputLine(pane.liveOutput, sessionLine),
        streamEntries: appendStreamEntry(pane.streamEntries, 'system', `セッション開始: ${event.sessionId}`, eventAt)
      }))
      return
    }

    if (event.type === 'status' || event.type === 'tool' || event.type === 'stderr') {
      const kind = event.type === 'status' ? 'status' : event.type === 'tool' ? 'tool' : 'stderr'
      const normalizedText = sanitizeTerminalText(event.text).trim()
      mutatePane(paneId, (pane) => ({
        ...pane,
        lastActivityAt: eventAt,
        liveOutput: appendLiveOutputLine(pane.liveOutput, `[${kind}] ${normalizedText}`),
        streamEntries: appendStreamEntry(pane.streamEntries, kind, normalizedText, eventAt),
        lastError: event.type === 'stderr' ? normalizedText : pane.lastError
      }))
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

      let shouldShare = false
      mutatePane(paneId, (pane) => {
        const finalPreview = finalText.slice(0, 120)
        const liveOutputHasFinal = Boolean(finalPreview) && pane.liveOutput.includes(finalPreview)
        const nextLiveOutput = finalText
          ? liveOutputHasFinal
            ? clipText(pane.liveOutput, MAX_LIVE_OUTPUT)
            : appendLiveOutputLine(pane.liveOutput, finalText)
          : pane.liveOutput

        shouldShare = pane.autoShare
        return {
          ...pane,
          logs: appendLogEntry(pane.logs, assistantEntry),
          status: event.statusHint,
          statusText: statusLabel(event.statusHint),
          runningSince: null,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: event.statusHint === 'error' ? '応答がエラーで終了しました' : null,
          lastResponse: assistantEntry.text,
          liveOutput: nextLiveOutput,
          sessionId: event.sessionId ?? pane.sessionId,
          streamEntries: appendStreamEntry(pane.streamEntries, 'system', `実行終了: ${statusLabel(event.statusHint)}`, eventAt)
        }
      })

      if (shouldShare) {
        shareFromPane(paneId, assistantEntry.text)
      }
      return
    }

    if (event.type === 'error') {
      const message = sanitizeTerminalText(event.message).trim()
      streamErroredRef.current.add(paneId)
      mutatePane(paneId, (pane) => {
        const systemEntry: PaneLogEntry = {
          id: createId('log'),
          role: 'system',
          text: message,
          createdAt: eventAt
        }

        return {
          ...pane,
          logs: appendLogEntry(pane.logs, systemEntry),
          status: 'error',
          statusText: statusLabel('error'),
          runningSince: null,
          lastActivityAt: eventAt,
          lastFinishedAt: eventAt,
          lastError: message,
          liveOutput: appendLiveOutputLine(pane.liveOutput, `[stderr] ${message}`),
          streamEntries: appendStreamEntry(pane.streamEntries, 'stderr', message, eventAt)
        }
      })
    }
  }

  const handleRun = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || pane.status === 'running') {
      return
    }

    const target = buildTargetFromPane(pane, localWorkspacesRef.current)
    if (!target) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'ワークスペースを選択してください',
        lastError: 'ワークスペース未設定です'
      })
      return
    }

    const prompt = pane.prompt.trim()
    if (!prompt) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '指示文を入力してください',
        lastError: 'プロンプトが空です'
      })
      return
    }

    const startedAt = Date.now()
    const userEntry: PaneLogEntry = {
      id: createId('log'),
      role: 'user',
      text: prompt,
      createdAt: startedAt
    }

    const memory = [...pane.logs, userEntry].slice(-8)
    const attachedContext = sharedContext.filter((item) => pane.attachedContextIds.includes(item.id))
    const controller = new AbortController()

    controllersRef.current[paneId] = controller
    stopRequestedRef.current.delete(paneId)
    streamErroredRef.current.delete(paneId)

    mutatePane(paneId, (currentPane) => ({
      ...currentPane,
      logs: appendLogEntry(currentPane.logs, userEntry),
      status: 'running',
      statusText: 'CLI を実行中',
      lastRunAt: startedAt,
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      selectedSessionKey: null,
      liveOutput: '',
      streamEntries: appendStreamEntry([], 'system', `開始: ${currentPane.provider} / ${target.label}`, startedAt)
    }))

    try {
      await runPaneStream(
        {
          paneId,
          provider: pane.provider,
          model: pane.model,
          reasoningEffort: pane.reasoningEffort,
          autonomyMode: pane.autonomyMode,
          target,
          prompt,
          sessionId: pane.sessionId,
          memory,
          sharedContext: attachedContext
        },
        (event) => handleStreamEvent(paneId, event),
        controller.signal
      )
    } catch (error) {
      const message = sanitizeTerminalText(error instanceof Error ? error.message : String(error)).trim()
      const stopped = controller.signal.aborted || stopRequestedRef.current.has(paneId) || isAbortLikeMessage(message)
      const streamErrored = streamErroredRef.current.delete(paneId)

      if (!stopped && !streamErrored) {
        const failedAt = Date.now()
        mutatePane(paneId, (currentPane) => {
          const systemEntry: PaneLogEntry = {
            id: createId('log'),
            role: 'system',
            text: message,
            createdAt: failedAt
          }

          return {
            ...currentPane,
            logs: appendLogEntry(currentPane.logs, systemEntry),
            status: 'error',
            statusText: statusLabel('error'),
            runningSince: null,
            lastActivityAt: failedAt,
            lastFinishedAt: failedAt,
            lastError: message,
            liveOutput: appendLiveOutputLine(currentPane.liveOutput, `[stderr] ${message}`),
            streamEntries: appendStreamEntry(currentPane.streamEntries, 'stderr', message, failedAt)
          }
        })
      }

      if (stopped) {
        const stoppedAt = Date.now()
        mutatePane(paneId, (currentPane) => ({
          ...currentPane,
          status: 'attention',
          statusText: '停止しました',
          runningSince: null,
          lastActivityAt: stoppedAt,
          lastFinishedAt: stoppedAt,
          lastError: null,
          liveOutput: appendLiveOutputLine(currentPane.liveOutput, '[system] stopped'),
          streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', '実行を停止しました', stoppedAt)
        }))
      }
    } finally {
      delete controllersRef.current[paneId]
      stopRequestedRef.current.delete(paneId)
    }
  }

  const handleStop = async (paneId: string) => {
    stopRequestedRef.current.add(paneId)
    controllersRef.current[paneId]?.abort()

    mutatePane(paneId, (pane) => ({
      ...pane,
      status: 'attention',
      statusText: '停止しています',
      runningSince: null
    }))

    try {
      await stopPaneRun(paneId)
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: '停止に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleAddPane = () => {
    if (!bootstrap) {
      return
    }

    const created = createInitialPane(panesRef.current.length, bootstrap, localWorkspacesRef.current)
    setPanes((current) => [...current, created])
    setFocusedPaneId(created.id)
  }

  const handleDeletePane = (paneId: string) => {
    const removedContextIds = sharedContextRef.current
      .filter((item) => item.sourcePaneId === paneId)
      .map((item) => item.id)

    stopRequestedRef.current.add(paneId)
    controllersRef.current[paneId]?.abort()
    delete controllersRef.current[paneId]
    void stopPaneRun(paneId).catch(() => undefined)

    setSharedContext((current) => current.filter((item) => item.sourcePaneId !== paneId))

    let nextFocusId: string | null = null
    setPanes((current) => {
      const index = current.findIndex((pane) => pane.id === paneId)
      const remaining = current
        .filter((pane) => pane.id !== paneId)
        .map((pane) => ({
          ...pane,
          attachedContextIds: pane.attachedContextIds.filter((item) => !removedContextIds.includes(item))
        }))

      if (remaining.length === 0 && bootstrap) {
        const replacement = createInitialPane(0, bootstrap, localWorkspacesRef.current)
        nextFocusId = replacement.id
        return [replacement]
      }

      nextFocusId = remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id ?? null
      return remaining
    })

    setFocusedPaneId(nextFocusId)
  }

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
      prompt: '',
      logs: [],
      streamEntries: [],
      sessionHistory: [],
      selectedSessionKey: null,
      liveOutput: '',
      sessionId: null,
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

  const handleCopyLatest = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    const text = pane ? getLatestAssistantText(pane) : null
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      const copiedAt = Date.now()
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', '最新出力をクリップボードへコピーしました', copiedAt),
        lastActivityAt: copiedAt
      }))
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: 'コピーに失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleBrowseLocal = async (paneId: string, targetPath: string) => {
    if (!targetPath.trim()) {
      return
    }

    updatePane(paneId, {
      localBrowserLoading: true
    })

    try {
      const payload = await browseLocalDirectory(targetPath)
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
        statusText: 'フォルダ内容の読込に失敗しました',
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
      localBrowserLoading: false
    })

    await handleBrowseLocal(paneId, selectedPath)
  }

  const handleAddLocalWorkspace = async (paneId: string) => {
    try {
      const result = await pickLocalWorkspace()
      const selected = result.paths[0]
      if (!selected) {
        return
      }

      const workspace = buildLocalWorkspaceRecord(selected)
      setLocalWorkspaces((current) => mergeLocalWorkspaces([workspace], current))
      await handleSelectLocalWorkspace(paneId, workspace.path)
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: 'フォルダ選択に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
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
              localBrowserEntries: []
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

    const target = buildTargetFromPane(pane, localWorkspacesRef.current)
    if (!target) {
      return
    }

    try {
      await openWorkspaceInVsCode(target)
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: 'VSCode 起動に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleOpenPathInVsCode = async (paneId: string, path: string, resourceType: 'folder' | 'file') => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !path.trim()) {
      return
    }

    const target: WorkspaceTarget =
      pane.workspaceMode === 'local'
        ? {
            kind: 'local',
            path: path.trim(),
            label: path.trim(),
            resourceType
          }
        : {
            kind: 'ssh',
            host: pane.sshHost.trim(),
            path: path.trim(),
            label: `${pane.sshHost.trim()}:${path.trim()}`,
            resourceType
          }

    try {
      await openWorkspaceInVsCode(target)
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: 'VSCode 起動に失敗しました',
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
        lastError: 'SSH ホスト未設定です'
      })
      return
    }

    const startedAt = Date.now()
    updatePane(paneId, {
      status: 'running',
      statusText: 'SSH を確認中',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null
    })

    try {
      const [workspacePayload, inspectionPayload, browsePayload] = await Promise.all([
        fetchRemoteWorkspaces(pane.sshHost.trim()),
        inspectSshHost(pane.sshHost.trim()),
        browseRemoteDirectory(pane.sshHost.trim(), pane.remoteBrowserPath || pane.remoteWorkspacePath || undefined)
      ])

      setPanes((current) =>
        current.map((item) => {
          if (item.id !== paneId) {
            return item
          }

          const nextProvider =
            inspectionPayload.availableProviders.length > 0 &&
            !inspectionPayload.availableProviders.includes(item.provider)
              ? inspectionPayload.availableProviders[0]
              : item.provider
          const nextModel =
            nextProvider !== item.provider && bootstrap
              ? bootstrap.providers[nextProvider].models[0]?.id ?? item.model
              : item.model
          const updatedAt = Date.now()

          return {
            ...item,
            provider: nextProvider,
            model: nextModel,
            remoteWorkspaces: workspacePayload.workspaces,
            remoteAvailableProviders: inspectionPayload.availableProviders,
            remoteHomeDirectory: inspectionPayload.homeDirectory,
            remoteBrowserLoading: false,
            remoteBrowserPath: browsePayload.path,
            remoteParentPath: browsePayload.parentPath,
            remoteBrowserEntries: browsePayload.entries,
            remoteWorkspacePath:
              item.remoteWorkspacePath || workspacePayload.workspaces[0]?.path || browsePayload.path || item.remoteWorkspacePath,
            status: inspectionPayload.availableProviders.length === 0 ? 'attention' : 'idle',
            statusText: inspectionPayload.availableProviders.length === 0 ? 'CLI 未検出' : 'SSH を更新しました',
            runningSince: null,
            lastActivityAt: updatedAt,
            lastFinishedAt: updatedAt
          }
        })
      )
    } catch (error) {
      updatePane(paneId, {
        status: 'error',
        statusText: 'SSH 接続に失敗しました',
        runningSince: null,
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleBrowseRemote = async (paneId: string, nextPath?: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH ホストを入力してください',
        lastError: 'SSH ホスト未設定です'
      })
      return
    }

    updatePane(paneId, {
      remoteBrowserLoading: true
    })

    try {
      const browsePayload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        nextPath || pane.remoteBrowserPath || pane.remoteHomeDirectory || undefined
      )
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        remoteBrowserLoading: false,
        remoteHomeDirectory: browsePayload.homeDirectory,
        remoteBrowserPath: browsePayload.path,
        remoteParentPath: browsePayload.parentPath,
        remoteBrowserEntries: browsePayload.entries,
        lastError: null
      }))
    } catch (error) {
      updatePane(paneId, {
        remoteBrowserLoading: false,
        status: 'error',
        statusText: 'SSH 参照に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleCreateRemoteDirectory = async (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim() || !pane.remoteBrowserPath.trim() || !pane.remoteNewDirectoryName.trim()) {
      updatePane(paneId, {
        status: 'attention',
        statusText: '作成先とフォルダ名を確認してください',
        lastError: 'リモートフォルダ作成に必要な情報が不足しています'
      })
      return
    }

    updatePane(paneId, {
      remoteBrowserLoading: true
    })

    try {
      const payload = await createRemoteDirectory(
        pane.sshHost.trim(),
        pane.remoteBrowserPath.trim(),
        pane.remoteNewDirectoryName.trim()
      )
      const browsePayload = await browseRemoteDirectory(pane.sshHost.trim(), payload.path)
      mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        remoteBrowserLoading: false,
        remoteWorkspacePath: payload.path,
        remoteBrowserPath: browsePayload.path,
        remoteParentPath: browsePayload.parentPath,
        remoteBrowserEntries: browsePayload.entries,
        remoteNewDirectoryName: '',
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', `フォルダ作成: ${payload.path}`, Date.now())
      }))
    } catch (error) {
      updatePane(paneId, {
        remoteBrowserLoading: false,
        status: 'error',
        statusText: 'フォルダ作成に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  useEffect(() => {
    if (!selectedPane || selectedPane.workspaceMode !== 'local' || !selectedPane.localWorkspacePath) {
      return
    }

    if (selectedPane.localBrowserLoading || selectedPane.localBrowserPath === selectedPane.localWorkspacePath) {
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

  if (loading && !bootstrap) {
    return (
      <div className="loading-screen">
        <div className="loading-panel">
          <Activity size={22} />
          <p>CLI デッキを読み込んでいます。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="background-layer" />

      <header className="topbar compact">
        <div>
          <p className="eyebrow">Multi Turtle CLI Develop Tool</p>
          <h1>Multi Turtle CLI Develop Tool</h1>
          <p className="topbar-copy">複数の CLI とワークスペースを、一画面で切り替えながら進行管理する。</p>
        </div>

        <div className="topbar-actions">
          <button type="button" className="secondary-button" onClick={() => void refreshBootstrap()}>
            <RefreshCcw size={16} />
            再読込
          </button>
          <button type="button" className="primary-button" onClick={handleAddPane}>
            <Plus size={16} />
            ペイン追加
          </button>
        </div>
      </header>

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
            <span>実行中</span>
          </header>
          <strong>{metrics.running}</strong>
        </article>
        <article className="metric-card compact">
          <header>
            <CheckCircle2 size={16} />
            <span>完了</span>
          </header>
          <strong>{metrics.completed}</strong>
          <p>正常終了したタスク</p>
        </article>
        <article className="metric-card compact">
          <header>
            <Bot size={16} />
            <span>入力/確認待ち</span>
          </header>
          <strong>{metrics.attention}</strong>
          <p>選択や確認が必要</p>
        </article>
        <article className="metric-card compact">
          <header>
            <XCircle size={16} />
            <span>停滞 / エラー</span>
          </header>
          <strong>{metrics.error + metrics.stalled}</strong>
        </article>
      </section>

      {sharedContext.length > 0 && (
        <section className="context-dock">
          <div className="panel-header">
            <Wifi size={16} />
            <h2>共有コンテキスト</h2>
          </div>
          <div className="context-dock-list">
            {sharedContext.map((item) => (
              <article key={item.id} className="context-dock-item">
                <strong>{item.sourcePaneTitle}</strong>
                <span>{item.summary}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="main-grid single-column">
        <main className="workspace-stage full-stage">
          <div className="stage-toolbar">
            <div className="toolbar-group">
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
                3列
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

            <div className="toolbar-note">local {localWorkspaces.length} / ssh {bootstrap?.sshHosts.length ?? 0} / shared {sharedContext.length}</div>
          </div>

          <div className="pane-matrix">
            {panes.map((pane, index) => {
              const isFocused = pane.id === focusedPaneId
              const isStalled = pane.status === 'running' && pane.lastActivityAt !== null && now - pane.lastActivityAt > STALL_MS

              return (
                <button
                  key={`matrix-${pane.id}`}
                  type="button"
                  className={`matrix-tile status-${isStalled ? 'attention' : pane.status} ${isFocused ? 'active' : ''}`}
                  onClick={() => handleSelectPane(pane.id, layout !== 'focus')}
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
              <TerminalPane
                key={pane.id}
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
                onRun={(paneId) => void handleRun(paneId)}
                onStop={(paneId) => void handleStop(paneId)}
                onShare={shareFromPane}
                onCopyLatest={(paneId) => void handleCopyLatest(paneId)}
                onDuplicate={handleDuplicatePane}
                onStartNewSession={handleStartNewSession}
                onResetSession={handleResetSession}
                onSelectSession={handleSelectSession}
                onDelete={handleDeletePane}
                onLoadRemote={(paneId) => void handleLoadRemote(paneId)}
                onBrowseRemote={(paneId, path) => void handleBrowseRemote(paneId, path)}
                onCreateRemoteDirectory={(paneId) => void handleCreateRemoteDirectory(paneId)}
                onOpenWorkspace={(paneId) => void handleOpenWorkspace(paneId)}
                onOpenPath={(paneId, path, resourceType) => void handleOpenPathInVsCode(paneId, path, resourceType)}
                onAddLocalWorkspace={(paneId) => void handleAddLocalWorkspace(paneId)}
                onSelectLocalWorkspace={(paneId, workspacePath) => void handleSelectLocalWorkspace(paneId, workspacePath)}
                onRemoveLocalWorkspace={handleRemoveLocalWorkspace}
                onBrowseLocal={(paneId, path) => void handleBrowseLocal(paneId, path)}
                onToggleContext={handleToggleContext}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
