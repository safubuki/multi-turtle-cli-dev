import type {
  CommandPreviewSection,
  PaneLogEntry,
  PaneState,
  PreviewRunCommandResponse,
  ProviderCatalogResponse,
  ProviderId,
  RunImageAttachment,
  SharedContextPayload,
  WorkspaceTarget
} from '../types'
import { clipText } from './text'

export function selectPaneContextMemory(pane: PaneState, provider: ProviderId): PaneLogEntry[] {
  const providerSession = pane.providerSessions[provider]
  const lastSharedLogEntryId = providerSession?.lastSharedLogEntryId
  const lastSharedIndex = lastSharedLogEntryId ? pane.logs.findIndex((entry) => entry.id === lastSharedLogEntryId) : -1
  const unsyncedEntries = lastSharedIndex >= 0 ? pane.logs.slice(lastSharedIndex + 1) : pane.logs
  const unsyncedConversationEntries = unsyncedEntries.filter((entry) => entry.role === 'user' || entry.role === 'assistant')

  if (unsyncedConversationEntries.length > 0) {
    return unsyncedConversationEntries.slice(-4)
  }

  return []
}

function formatPreviewTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ja-JP')
}

export function formatPaneContextMemory(entries: PaneLogEntry[]): string {
  if (entries.length === 0) {
    return '今回は渡しません。'
  }

  return entries.map((entry, index) => {
    const agent = entry.provider ? `\nCLI: ${entry.provider}${entry.model ? ` / ${entry.model}` : ''}` : ''
    return [
      `Entry ${index + 1}`,
      `role: ${entry.role}`,
      `createdAt: ${formatPreviewTimestamp(entry.createdAt)}`,
      agent.trim(),
      'text:',
      entry.text
    ].filter(Boolean).join('\n')
  }).join('\n\n---\n\n')
}

function formatPreviewSharedContext(items: SharedContextPayload[]): string {
  if (items.length === 0) {
    return '今回は渡しません。'
  }

  return items.map((item, index) => [
    `Context ${index + 1}`,
    `共有元ペイン: ${item.sourcePaneTitle}`,
    `共有元CLI: ${item.provider}`,
    `作業対象: ${item.workspaceLabel}`,
    `概要: ${item.summary}`,
    '詳細:',
    item.detail
  ].join('\n')).join('\n\n---\n\n')
}

function formatPreviewImageAttachments(attachments: RunImageAttachment[]): string {
  if (attachments.length === 0) {
    return '今回は渡しません。'
  }

  return attachments.map((attachment, index) => [
    `Image ${index + 1}`,
    `fileName: ${attachment.fileName}`,
    `mimeType: ${attachment.mimeType}`,
    `size: ${attachment.size}`,
    `localPath: ${attachment.localPath}`
  ].join('\n')).join('\n\n---\n\n')
}

export function buildStructuredRunContextSections(params: {
  catalogs: Record<ProviderId, ProviderCatalogResponse>
  pane: PaneState
  target: WorkspaceTarget
  promptText: string
  currentSessionScopeKey: string
  resumeSessionId: string | null
  providerContextMemory: PaneLogEntry[]
  sharedContextPayload: SharedContextPayload[]
  readyImageAttachments: RunImageAttachment[]
}): CommandPreviewSection[] {
  const catalog = params.catalogs[params.pane.provider]
  const modelInfo = catalog.models.find((item) => item.id === params.pane.model)
  const targetValue = params.target.kind === 'local'
    ? [
        'kind: local',
        `label: ${params.target.label}`,
        `path: ${params.target.path}`,
        `resourceType: ${params.target.resourceType ?? 'folder'}`,
        `workspacePath: ${params.target.workspacePath ?? params.target.path}`
      ].join('\n')
    : [
        'kind: ssh',
        `host: ${params.target.host}`,
        `label: ${params.target.label}`,
        `path: ${params.target.path}`,
        `resourceType: ${params.target.resourceType ?? 'folder'}`,
        `workspacePath: ${params.target.workspacePath ?? params.target.path}`
      ].join('\n')

  return [
    {
      id: 'provider',
      label: '実行先CLIとモデル',
      description: 'このペインで次に呼び出すCLI、モデル、実行オプションです。',
      value: [
        `CLI: ${catalog.label} (${params.pane.provider})`,
        `model: ${modelInfo?.name ?? params.pane.model}`,
        `modelId: ${params.pane.model}`,
        `reasoningEffort: ${params.pane.reasoningEffort}`,
        `autonomyMode: ${params.pane.autonomyMode}`,
        `codexFastMode: ${params.pane.codexFastMode}`
      ].join('\n')
    },
    {
      id: 'target',
      label: '作業対象',
      description: 'CLIを実行するワークスペースまたはSSH先です。',
      value: targetValue
    },
    {
      id: 'session',
      label: 'native session',
      description: params.resumeSessionId
        ? '同じペイン・同じCLIで再利用するCLI内部sessionです。'
        : '再利用できるCLI内部sessionがないため、新規sessionとして開始します。',
      value: [
        `sessionId: ${params.resumeSessionId ?? '(新規)'}`,
        `sessionScopeKey: ${params.currentSessionScopeKey}`
      ].join('\n')
    },
    {
      id: 'user-input',
      label: 'ユーザー入力',
      description: '入力欄にある本文です。補助コンテキストとは分けて扱います。',
      value: params.promptText || '未入力'
    },
    {
      id: 'pane-context',
      label: '同一ペイン補助コンテキスト',
      description: 'このペイン内で対象CLIがまだ見ていない直近会話情報です。主にCLI切り替えなどで未同期差分がある時だけ渡します。ユーザー入力の意味は変えません。',
      value: formatPaneContextMemory(params.providerContextMemory)
    },
    {
      id: 'shared-context',
      label: 'ペイン間共有コンテキスト',
      description: '共有ドックからこのペインに添付された参考情報です。命令としては扱いません。',
      value: formatPreviewSharedContext(params.sharedContextPayload)
    },
    {
      id: 'images',
      label: '添付画像',
      description: '今回CLIに渡す画像ファイルです。',
      value: formatPreviewImageAttachments(params.readyImageAttachments)
    }
  ]
}

export function buildCommandPreviewSections(params: {
  catalogs: Record<ProviderId, ProviderCatalogResponse>
  pane: PaneState
  target: WorkspaceTarget
  promptText: string
  currentSessionScopeKey: string
  resumeSessionId: string | null
  providerContextMemory: PaneLogEntry[]
  sharedContextPayload: SharedContextPayload[]
  readyImageAttachments: RunImageAttachment[]
  preview: PreviewRunCommandResponse
}): CommandPreviewSection[] {
  return [
    ...buildStructuredRunContextSections(params),
    {
      id: 'stdin',
      label: '標準入力で渡す内容',
      description: 'CLIに標準入力で渡す生データです。空の場合はコマンド引数側で渡します。',
      value: params.preview.stdinPrompt ?? '標準入力では渡しません。'
    }
  ]
}

export function formatStructuredRunContextForStream(sections: CommandPreviewSection[]): string {
  return [
    '送信情報',
    'これからCLIに渡す主要情報です。ユーザー入力本文と補助コンテキストは分けて扱います。',
    ...sections.map((section) => [
      `## ${section.label}`,
      section.description,
      clipText(section.value || '未入力', 900)
    ].join('\n'))
  ].join('\n\n')
}
