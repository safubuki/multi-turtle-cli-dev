import { fetchBootstrap } from './api'
import { clipText, summarize } from './text'
import type { AutonomyMode, BootstrapPayload, LocalSshKey, LocalWorkspace, PaneLogEntry, PaneSessionRecord, PaneState, PaneStatus, PromptImageAttachmentSource, ProviderCatalogResponse, ProviderId, RunImageAttachment, SharedContextItem, SshConnectionOptions, SshHost, WorkspaceTarget } from '../types'

// App.tsx の React 本体から独立して扱える補助層。
// 純粋なドメインコアではなく、状態復元・正規化・実行補助・ブラウザ依存の小さなユーティリティをまとめる。

export type LayoutMode = 'quad' | 'triple' | 'focus'

export const PROVIDER_ORDER: ProviderId[] = ['codex', 'copilot', 'gemini']
export const EMPTY_CATALOGS = {} as Record<ProviderId, ProviderCatalogResponse>
export const MAX_LOGS = 24
export const MAX_STREAM_ENTRIES = 240
export const MAX_SESSION_HISTORY = 18
export const MAX_SESSION_LABEL_LENGTH = 40
export const MAX_SHARED_CONTEXT = 16
export const BOOTSTRAP_RETRY_DELAY_MS = 500
export const BOOTSTRAP_MAX_ATTEMPTS = 12
export const TITLE_IMAGE_URL = new URL('../../assets/title.png', import.meta.url).href

export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

export function extensionFromMimeType(mimeType: string): string {
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

export function inferImageMimeType(fileName: string): string | null {
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

export function normalizePromptImageFile(file: File, source: PromptImageAttachmentSource): { file: File; fileName: string; mimeType: string } | null {
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

export function readFileAsBase64(file: File): Promise<string> {
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

export function buildPromptWithImageSummary(prompt: string, imageAttachments: Pick<RunImageAttachment, 'fileName'>[]): string {
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

export function reorderPanesById(panes: PaneState[], sourcePaneId: string, targetPaneId: string): PaneState[] {
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

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function isRetryableBootstrapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Request failed: 502|Request failed: 503|Request failed: 504|ECONNREFUSED|fetch failed|Failed to fetch/i.test(message)
}

export async function fetchBootstrapWithRetry(): Promise<BootstrapPayload> {
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

export function buildShellPromptLabel(pane: PaneState, cwd?: string | null): string {
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

export function appendLogEntry(entries: PaneLogEntry[], entry: PaneLogEntry): PaneLogEntry[] {
  return [...entries, { ...entry, text: clipText(entry.text, 32_000) }].slice(-MAX_LOGS)
}

export function appendStreamEntry(
  entries: PaneState['streamEntries'],
  kind: PaneState['streamEntries'][number]['kind'],
  text: string,
  createdAt: number,
  provider?: ProviderId,
  model?: string
): PaneState['streamEntries'] {
  const normalized = text.trim()
  if (!normalized) {
    return entries
  }

  const clipped = clipText(normalized, 4_000)
  const lastEntry = entries.at(-1)
  if (
    lastEntry &&
    lastEntry.kind === kind &&
    lastEntry.provider === provider &&
    lastEntry.model === model &&
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

  return [...entries, { id: createId('stream'), kind, text: clipped, createdAt, provider, model }].slice(-MAX_STREAM_ENTRIES)
}

export function hasSessionContent(pane: Pick<PaneState, 'logs' | 'streamEntries' | 'sessionId' | 'liveOutput' | 'lastResponse'>): boolean {
  return (
    pane.logs.length > 0 ||
    pane.streamEntries.length > 0 ||
    Boolean(pane.sessionId) ||
    Boolean(pane.liveOutput.trim()) ||
    Boolean(pane.lastResponse?.trim())
  )
}

export function clipSessionLabelText(text: string): string {
  if (text.length <= MAX_SESSION_LABEL_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_SESSION_LABEL_LENGTH - 1).trimEnd()}...`
}

export function getSessionTopicCandidate(logs: PaneLogEntry[]): string | null {
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

export function buildSessionLabel(sessionId: string | null, createdAt: number, logs: PaneLogEntry[]): string {
  const topicCandidate = getSessionTopicCandidate(logs)
  if (topicCandidate) {
    return topicCandidate
  }

  if (sessionId) {
    return `\u30bb\u30c3\u30b7\u30e7\u30f3 ${sessionId.slice(0, 8)}`
  }

  return `\u30bb\u30c3\u30b7\u30e7\u30f3 ${new Date(createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
}

export function createArchivedSessionRecord(pane: PaneState): PaneSessionRecord {
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

export function appendSessionRecord(history: PaneSessionRecord[], record: PaneSessionRecord): PaneSessionRecord[] {
  return [record, ...history].slice(0, MAX_SESSION_HISTORY)
}

export function extractGeminiQuotaResetWindow(message: string): string | null {
  const match = message.match(/quota will reset after\s+([^.!\n]+)/i)
  return match?.[1]?.trim() || null
}

export function getProviderIssueSummary(provider: ProviderId, message: string, autonomyMode?: AutonomyMode): { displayMessage: string; status: PaneStatus; statusText: string } | null {
  const codexCanEscalate = provider === 'codex' && autonomyMode !== 'max'

  if (
    /fatal:\s*detected dubious ownership in repository/i.test(message)
  ) {
    return {
      displayMessage: 'Git が safe.directory 未設定のため対象リポジトリを拒否しました。対象ワークスペースで git を使うには、そのパスを safe.directory に追加する必要があります。今回の修正で TAKO 自身のリポジトリ配下の一時ファイルは使わないようにしましたが、対象ワークスペース自体の所有者が現在ユーザーと違う場合は別途 Git 設定が必要です。',
      status: 'attention',
      statusText: 'Git の安全設定が必要です'
    }
  }

  if (
    /fatal:\s*not a git repository/i.test(message)
  ) {
    return {
      displayMessage: 'CLI 内で git を実行しましたが、現在の作業ディレクトリに .git が見つかりませんでした。今回の修正で CLI の作業ディレクトリは選択中ワークスペースへ明示固定されます。なお、そのワークスペース自体が Git 管理外ならこのエラーは残ります。',
      status: 'attention',
      statusText: 'Git リポジトリではありません'
    }
  }

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

  if (
    provider === 'codex' &&
    /writing outside of the project; rejected by user approval settings|writing is blocked by read-only sandbox; rejected by user approval settings|patch rejected:\s*writing outside of the project/i.test(message)
  ) {
    return {
      displayMessage: codexCanEscalate
        ? 'Codex の標準モードでは workspace 直下の .agents / .codex / .git が保護されます。この種の編集は VS Code で対象ワークスペースを開いて進めてください。'
        : 'Codex は workspace 外か保護対象ディレクトリへの書き込みを拒否しました。.agents / .codex / .git の編集は VS Code へ切り替え、制限なしでも失敗する場合は対象パスや OS 権限を確認してください。',
      status: 'attention',
      statusText: 'Codex が保護パスを書き込めません'
    }
  }

  if (
    provider === 'codex' &&
    /access is denied|unauthorizedaccessexception|アクセスが拒否されました/i.test(message) &&
    /\.agents|\.codex|\.git/i.test(message)
  ) {
    return {
      displayMessage: codexCanEscalate
        ? 'Windows 上の Codex 標準モードでは .agents / .codex / .git が保護され、Access is denied と見えることがあります。この種の編集は VS Code で対象ワークスペースを開いて進めてください。'
        : 'Windows が対象パスへの書き込みを拒否しました。.agents / .codex / .git の編集は VS Code に切り替え、なお失敗する場合は ACL や属性を確認してください。',
      status: 'attention',
      statusText: 'Windows が書き込みを拒否しました'
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

export function normalizeSshHostKey(host: string): string {
  return host.trim().toLowerCase()
}

export function mergeLocalSshKeys(...collections: LocalSshKey[][]): LocalSshKey[] {
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

export function getPaneRecentActivity(pane: PaneState): number {
  return Math.max(
    pane.lastActivityAt ?? 0,
    pane.lastFinishedAt ?? 0,
    pane.lastRunAt ?? 0,
    pane.shellLastRunAt ?? 0
  )
}

export function findReusableSshPane(paneId: string, host: string, panes: PaneState[]): PaneState | null {
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

export function getPreferredLocalSshKey(pane: PaneState, localKeys: LocalSshKey[], panes: PaneState[]): LocalSshKey | null {
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

export function buildSshConnectionFromPane(pane: PaneState, sshHosts: SshHost[] = [], panes: PaneState[] = []): SshConnectionOptions {
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

export function buildSshLabel(host: string, remotePath: string, connection?: SshConnectionOptions): string {
  const userPrefix = connection?.username?.trim() ? `${connection.username.trim()}@` : ''
  return `${userPrefix}${host}:${remotePath}`
}

export function buildTargetFromPane(pane: PaneState, localWorkspaces: LocalWorkspace[], sshHosts: SshHost[] = [], panes: PaneState[] = []): WorkspaceTarget | null {
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

export function createSharedContextItem(
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

export function getLatestAssistantText(pane: PaneState): string | null {
  if (pane.lastResponse?.trim()) {
    return pane.lastResponse
  }

  const latestAssistant = [...pane.logs].reverse().find((entry) => entry.role === 'assistant')
  return latestAssistant?.text ?? null
}

export function getPaneOutputText(pane: Pick<PaneState, 'liveOutput' | 'lastResponse'>): string | null {
  if (pane.liveOutput.trim()) {
    return pane.liveOutput
  }

  if (pane.lastResponse?.trim()) {
    return pane.lastResponse
  }

  return null
}

export function getShareablePayload(pane: PaneState): { text: string | null; contentLabel: string } {
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



