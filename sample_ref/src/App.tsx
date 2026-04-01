import { useEffect, useRef, useState } from 'react'
import {
  BrainCircuit,
  Download,
  Eye,
  FileText,
  FolderOpen,
  MessageSquarePlus,
  Play,
  Settings,
  Square,
  Upload,
  X
} from 'lucide-react'
import { AgentAvatar } from './components/AgentAvatar'
import { AgentRuntimeMeta } from './components/AgentRuntimeMeta'
import { SettingsModal } from './components/SettingsModal'
import { PROVIDER_LABELS, formatAgentRole } from './config/agentMetadata'
import { TITLE_ICON_SRC } from './config/iconAssets'
import { DISCUSSION_STYLE_METADATA, EXECUTION_MODE_METADATA } from './config/modeMetadata'
import { apiRequestJson } from './lib/apiClient'
import { useStore, type AgentProfile, type Message } from './store/useStore'

interface ConclusionSection {
  title: string
  lines: string[]
}

function extractJsonLineRecords(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line)
        return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : []
      } catch {
        return []
      }
    })
}

function getNestedString(record: unknown, pathSegments: string[]): string | null {
  let current: unknown = record

  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') {
      return null
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' && current.trim().length > 0 ? current : null
}

function extractAssistantContentFromEventLog(text: string): string | null {
  const records = extractJsonLineRecords(text)
  if (records.length === 0) {
    return null
  }

  const assistantMessageEvent = [...records]
    .reverse()
    .find((record) => getNestedString(record, ['type']) === 'assistant.message')

  const assistantMessageContent = getNestedString(assistantMessageEvent, ['data', 'content'])
  if (assistantMessageContent) {
    return assistantMessageContent.trim()
  }

  const lastDeltaEvent = [...records]
    .reverse()
    .find((record) => getNestedString(record, ['type']) === 'assistant.message_delta')
  const lastMessageId = getNestedString(lastDeltaEvent, ['data', 'messageId'])
  if (!lastMessageId) {
    return null
  }

  const deltaContent = records
    .filter(
      (record) =>
        getNestedString(record, ['type']) === 'assistant.message_delta' &&
        getNestedString(record, ['data', 'messageId']) === lastMessageId
    )
    .map((record) => getNestedString(record, ['data', 'deltaContent']) ?? '')
    .join('')
    .trim()

  return deltaContent || null
}

function getRenderableMessageContent(content: string): string {
  return (extractAssistantContentFromEventLog(content) ?? content).trim()
}

function splitReadableLines(text: string): string[] {
  const normalized = getRenderableMessageContent(text).replace(/\r/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const multiLines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (multiLines.length > 1) {
    return multiLines
  }

  return normalized
    .replace(/([。！？!?])/g, '$1\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildDigestFromContent(content: string): string {
  const normalized = getRenderableMessageContent(content).replace(/\s+/g, ' ').trim()
  if (normalized.length <= 120) {
    return normalized
  }

  return `${normalized.slice(0, 120).trim()}...`
}

function parseConclusionSections(content: string): ConclusionSection[] {
  const normalized = content.replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }

  const sections: ConclusionSection[] = []
  let currentTitle: string | null = null
  let currentLines: string[] = []

  const flushSection = () => {
    if (!currentTitle) {
      return
    }

    const body = currentLines.join('\n').trim()
    const lines = splitReadableLines(body)
    sections.push({
      title: currentTitle,
      lines: lines.length > 0 ? lines : ['内容なし']
    })
  }

  normalized.split('\n').forEach((rawLine) => {
    const line = rawLine.trim()
    const headingSource = line.replace(/^\*\*|\*\*$/g, '').trim()
    const headingMatch = headingSource.match(/^(\d+\.\s+.+?)(?:\s*[:：]\s*(.*))?$/)

    if (headingMatch) {
      flushSection()
      currentTitle = headingMatch[1].trim()
      currentLines = headingMatch[2] ? [headingMatch[2].trim()] : []
      return
    }

    currentLines.push(rawLine)
  })

  flushSection()

  if (sections.length > 0) {
    return sections
  }

  return [{ title: '結論', lines: splitReadableLines(normalized) }]
}

function getAgentAliases(agent: AgentProfile): string[] {
  const aliases = new Set<string>([agent.name])

  if (agent.role === 'Facilitator') {
    aliases.add('ファシリテータ')
    aliases.add('進行役')
    aliases.add('司会')
  }

  return [...aliases].sort((left, right) => right.length - left.length)
}

function findReferencedMessages(
  content: string,
  currentMessageId: string,
  allMessages: Message[],
  agents: AgentProfile[]
): Array<{ messageId: string; label: string; summary: string }> {
  const currentMessage = allMessages.find((message) => message.id === currentMessageId)
  if (!currentMessage) {
    return []
  }

  const previousMessages = allMessages.filter(
    (message) => message.timestamp <= currentMessage.timestamp && message.id !== currentMessage.id
  )

  const references: Array<{ messageId: string; label: string; summary: string }> = []

  for (const agent of agents) {
    if (agent.id === currentMessage.agentId) {
      continue
    }

    const isMentioned = getAgentAliases(agent).some((alias) => alias.length > 1 && content.includes(alias))
    if (!isMentioned) {
      continue
    }

    const targetMessage = [...previousMessages].reverse().find((message) => message.agentId === agent.id)
    if (!targetMessage) {
      continue
    }

    const localOrder = previousMessages.filter((message) => message.agentId === agent.id).length
    const globalOrder = allMessages.findIndex((message) => message.id === targetMessage.id) + 1
    references.push({
      messageId: targetMessage.id,
      label: `${agent.name} ${localOrder}件目 / 全体${globalOrder}件目`,
      summary: buildDigestFromContent(targetMessage.content)
    })
  }

  return references
}

function scrollToMessage(messageId: string): void {
  const target = document.getElementById(`message-${messageId}`)
  if (!(target instanceof HTMLElement)) {
    return
  }

  target.classList.remove('ring-2', 'ring-cyan-400/90', 'shadow-[0_0_0_1px_rgba(34,211,238,0.55)]')

  target.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  })
  target.focus({ preventScroll: true })
  target.classList.add('ring-2', 'ring-cyan-400/90', 'shadow-[0_0_0_1px_rgba(34,211,238,0.55)]')
  window.setTimeout(() => {
    target.classList.remove('ring-2', 'ring-cyan-400/90', 'shadow-[0_0_0_1px_rgba(34,211,238,0.55)]')
  }, 1800)
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').slice(0, 30)
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function getStatusBadge(agent: AgentProfile) {
  if (agent.status === 'thinking') {
    return {
      label: '思考中',
      className: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
    }
  }

  if (agent.status === 'raising_hand') {
    return {
      label: '挙手中',
      className: 'border-amber-500/40 bg-amber-500/10 text-amber-300'
    }
  }

  if (agent.status === 'speaking') {
    return {
      label: '発言中',
      className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    }
  }

  return {
    label: '待機中',
    className: 'border-slate-700/60 bg-slate-800/70 text-slate-300'
  }
}

function getAgentPanelTone(agent: AgentProfile) {
  if (agent.role === 'Facilitator') {
    return {
      card: 'border-amber-500/30',
      header: 'bg-amber-900/20',
      icon: 'bg-amber-500/20 text-amber-400',
      accentText: 'text-amber-300',
      message: 'border-amber-700/30 bg-amber-900/10',
      bar: 'bg-amber-400'
    }
  }

  return {
    card: 'border-slate-700/60',
    header: 'bg-slate-800/80',
    icon: 'bg-cyan-500/20 text-cyan-400',
    accentText: 'text-cyan-300',
    message: 'border-slate-600/40 bg-slate-700/30',
    bar: 'bg-cyan-400'
  }
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)))
}

function getPathName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? filePath
}

async function requestSelectedPaths(endpoint: string): Promise<string[]> {
  const data = await apiRequestJson<{ success?: boolean; paths?: unknown[]; details?: string; error?: string }>(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!data?.success) {
    throw new Error(data?.details || data?.error || '入力ファイル / フォルダの選択に失敗しました。')
  }

  return Array.isArray(data.paths) ? data.paths.filter((entry: unknown): entry is string => typeof entry === 'string') : []
}

function App() {
  const {
    agents,
    topic,
    inputPaths,
    sessionStatus,
    startSession,
    stopSession,
    resetSession,
    messages,
    currentTurn,
    processNextTurn,
    finalConclusion,
    executionMode,
    discussionStyle,
    sessionError,
    clearSessionError,
    orchestrationDebug,
    backendSessionId,
    refreshProviderCatalogs
  } = useStore()

  const executionModeInfo = EXECUTION_MODE_METADATA[executionMode]
  const discussionStyleInfo = DISCUSSION_STYLE_METADATA[discussionStyle]

  const [localTopic, setLocalTopic] = useState(topic)
  const [localInputPaths, setLocalInputPaths] = useState<string[]>(inputPaths)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDebugOpen, setIsDebugOpen] = useState(false)
  const [summaryModal, setSummaryModal] = useState<{ agentName: string; content: string } | null>(null)
  const [pathDialogBusy, setPathDialogBusy] = useState<'files' | 'folder' | null>(null)
  const [inputPathError, setInputPathError] = useState<string | null>(null)
  const requestedTurnRef = useRef<string | null>(null)

  const orderedMessages = [...messages].sort((left, right) => left.timestamp - right.timestamp)
  const conclusionSections = finalConclusion ? parseConclusionSections(finalConclusion) : []
  const pendingInputPaths = dedupePaths(localInputPaths)

  useEffect(() => {
    void refreshProviderCatalogs()
  }, [refreshProviderCatalogs])

  useEffect(() => {
    setLocalTopic(topic)
  }, [topic])

  useEffect(() => {
    setLocalInputPaths(inputPaths)
  }, [inputPaths])

  useEffect(() => {
    if (sessionStatus !== 'running') {
      requestedTurnRef.current = null
      return
    }

    const requestKey = `${backendSessionId ?? 'new'}:${currentTurn}`
    if (requestedTurnRef.current === requestKey) {
      return
    }

    requestedTurnRef.current = requestKey
    void processNextTurn()
  }, [backendSessionId, currentTurn, processNextTurn, sessionStatus])

  const handleStart = () => {
    const trimmedTopic = localTopic.trim()
    if (!trimmedTopic) {
      return
    }

    startSession(trimmedTopic, pendingInputPaths)
  }

  const handleNewSession = () => {
    resetSession()
    setLocalTopic('')
    setLocalInputPaths([])
    setInputPathError(null)
    setSummaryModal(null)
    setIsDebugOpen(false)
  }

  const handleDownloadMd = () => {
    const now = new Date()
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const sessionTopic = topic || localTopic || 'untitled-session'

    let md = '# Turtle Brain 議事録\n\n'
    md += '## セッション概要\n\n'
    md += `- テーマ: ${sessionTopic}\n`
    md += `- 日付: ${dateStr}\n`
    md += `- 議論スタイル: ${discussionStyleInfo.label}\n`
    md += `- 実行モード: ${executionModeInfo.label}\n`

    if (inputPaths.length > 0) {
      md += '- 入力ファイル / フォルダ:\n'
      inputPaths.forEach((filePath) => {
        md += `  - ${filePath}\n`
      })
    }

    md += '\n## 参加エージェント\n\n'
    agents.forEach((agent) => {
      md += `### ${agent.name}\n`
      md += `- ロール: ${formatAgentRole(agent.role)}\n`
      md += `- スタンス: ${agent.stance}\n`
      md += `- 性格: ${agent.personality}\n`
      md += `- CLI: ${PROVIDER_LABELS[agent.provider]}\n`
      md += `- モデル: ${agent.model}\n`
      md += `- Reasoning: ${agent.reasoningEffort}\n\n`
    })

    if (finalConclusion) {
      md += '## 最終結論\n\n'
      if (conclusionSections.length > 0) {
        conclusionSections.forEach((section) => {
          md += `### ${section.title}\n`
          section.lines.forEach((line) => {
            md += `${line}\n`
          })
          md += '\n'
        })
      } else {
        md += `${finalConclusion}\n\n`
      }
    }

    md += '## 発言ログ\n\n'
    orderedMessages.forEach((message, index) => {
      const agent = agents.find((entry) => entry.id === message.agentId)
      md += `### ${index + 1}. ${agent?.name ?? message.agentId}\n`
      md += `${getRenderableMessageContent(message.content)}\n\n`
    })

    md += '## エージェント別現在の主張\n\n'
    agents.forEach((agent) => {
      const agentMessages = orderedMessages.filter((message) => message.agentId === agent.id)
      const latest = agentMessages[agentMessages.length - 1]
      const latestSummary = latest ? buildDigestFromContent(latest.content) : '発言なし'
      md += `### ${agent.name}\n`
      md += `${latestSummary}\n\n`
    })

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `turtle-brain-${dateStr}-${sanitizeFilename(sessionTopic)}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleAddFiles = async () => {
    setPathDialogBusy('files')
    setInputPathError(null)

    try {
      const selectedPaths = await requestSelectedPaths('/api/system/pick-files')
      if (selectedPaths.length > 0) {
        setLocalInputPaths((current) => dedupePaths([...current, ...selectedPaths]))
      }
    } catch (error) {
      setInputPathError(error instanceof Error ? error.message : String(error))
    } finally {
      setPathDialogBusy(null)
    }
  }

  const handleAddFolder = async () => {
    setPathDialogBusy('folder')
    setInputPathError(null)

    try {
      const selectedPaths = await requestSelectedPaths('/api/system/pick-folder')
      if (selectedPaths.length > 0) {
        setLocalInputPaths((current) => dedupePaths([...current, ...selectedPaths]))
      }
    } catch (error) {
      setInputPathError(error instanceof Error ? error.message : String(error))
    } finally {
      setPathDialogBusy(null)
    }
  }

  const handleRemoveInputPath = (targetPath: string) => {
    setLocalInputPaths((current) => current.filter((filePath) => filePath !== targetPath))
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-900 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {summaryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setSummaryModal(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
              <h3 className="text-lg font-bold text-cyan-400">{summaryModal.agentName} の最新発言</h3>
              <button
                onClick={() => setSummaryModal(null)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
              <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
                {getRenderableMessageContent(summaryModal.content)}
              </p>
            </div>
          </div>
        </div>
      )}

      <aside className="glass-panel z-20 flex w-80 shrink-0 flex-col border-r border-slate-700/50">
        <div className="flex items-center gap-3 border-b border-slate-700/50 p-6">
          <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
            <img src={TITLE_ICON_SRC} alt="Turtle Brain" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-xl font-bold text-transparent">
              Turtle Brain
            </h1>
            <p className="text-xs text-slate-400">Multi CLI Discussion Workspace</p>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">操作</h2>
            <button
              onClick={handleNewSession}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-medium text-white shadow-lg shadow-cyan-500/20 transition-all hover:from-cyan-400 hover:to-blue-500"
            >
              <MessageSquarePlus size={18} />
              新規セッション
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/50 px-4 py-3 font-medium text-slate-300 transition-all hover:bg-slate-800"
            >
              <Settings size={18} />
              エージェント設定
            </button>
          </section>

          <section className="space-y-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
              <p className="text-xs font-semibold tracking-wider text-emerald-400">実行モード</p>
              <p className="mt-2 text-sm font-medium text-slate-100">{executionModeInfo.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{executionModeInfo.shortDescription}</p>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold tracking-wider text-cyan-400">議論スタイル</p>
                <button
                  onClick={() => setIsDebugOpen((open) => !open)}
                  className="rounded-md border border-slate-700/60 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                >
                  {isDebugOpen ? 'デバッグを閉じる' : 'デバッグ'}
                </button>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-100">{discussionStyleInfo.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{discussionStyleInfo.shortDescription}</p>
            </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs font-semibold tracking-wider text-slate-400">入力コンテキスト</p>
              <p className="mt-2 text-sm text-slate-200">
                {sessionStatus === 'running' || sessionStatus === 'finished'
                  ? `${inputPaths.length} 件`
                  : `${pendingInputPaths.length} 件`}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                指定したファイルやフォルダの内容を、議論の入力コンテキストとして参照します。
              </p>
            </div>

            {isDebugOpen && (
              <div className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/40 p-4 text-sm text-slate-300">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-100">オーケストレーション Session ID</p>
                  <p className="break-all font-mono text-xs text-slate-400">{backendSessionId ?? '未生成'}</p>
                  <p className="text-xs text-slate-500">会話全体の管理用 ID です。各エージェントの CLI セッションは下に表示します。</p>
                </div>

                {orchestrationDebug ? (
                  <>
                    <div className="space-y-2">
                      <p className="font-semibold text-slate-100">エージェント別 CLI セッション</p>
                      {orchestrationDebug.agentSessions.length > 0 ? (
                        orchestrationDebug.agentSessions.map((agentSession) => {
                          const agent = agents.find((entry) => entry.id === agentSession.agentId)
                          return (
                            <div
                              key={agentSession.agentId}
                              className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2"
                            >
                              <p className="text-slate-100">
                                {agent?.name ?? agentSession.agentId}
                                {' / '}
                                {agent ? PROVIDER_LABELS[agent.provider] : agentSession.agentId}
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
                                {agentSession.runtimeSessionId ?? '未開始'}
                              </p>
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-xs text-slate-500">まだエージェントの CLI セッションは開始されていません。</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className="font-semibold text-slate-100">最新ディスパッチ理由</p>
                      <p className="leading-6 text-slate-300">{orchestrationDebug.dispatchReason}</p>
                    </div>

                    {orchestrationDebug.facilitator && (
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-100">ファシリテータ判断</p>
                        <p className="text-slate-300">概要: {orchestrationDebug.facilitator.overview}</p>
                        <p className="text-slate-300">理由: {orchestrationDebug.facilitator.rationale}</p>
                        <p className="text-slate-300">次の焦点: {orchestrationDebug.facilitator.nextFocus}</p>
                        <p className="text-slate-300">
                          並列実行: {orchestrationDebug.facilitator.parallelDispatch ? '有効' : '無効'}
                        </p>
                        <p className="text-slate-300">
                          指名対象:{' '}
                          {orchestrationDebug.facilitator.selectedAgentIds.length > 0
                            ? orchestrationDebug.facilitator.selectedAgentIds
                                .map((id) => agents.find((agent) => agent.id === id)?.name ?? id)
                                .join(', ')
                            : 'なし'}
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="font-semibold text-slate-100">発話スコア</p>
                      {orchestrationDebug.scores.length > 0 ? (
                        orchestrationDebug.scores.map((score) => {
                          const agent = agents.find((entry) => entry.id === score.agentId)
                          return (
                            <div key={score.agentId} className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2">
                              <p className="text-slate-100">
                                {agent?.name ?? score.agentId}: {score.score} / conf {score.confidence}
                              </p>
                              <p className="text-xs leading-5 text-slate-400">
                                {score.desiredAction} - {score.reason}
                              </p>
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-xs text-slate-500">まだスコアログはありません。</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="font-semibold text-slate-100">Worker ログ</p>
                      {orchestrationDebug.workers.length > 0 ? (
                        orchestrationDebug.workers.map((worker) => (
                          <p key={worker.workerId} className="text-xs text-slate-400">
                            {worker.kind} / {agents.find((agent) => agent.id === worker.targetAgentId)?.name ?? worker.targetAgentId ?? 'system'} /{' '}
                            {worker.durationMs}ms
                          </p>
                        ))
                      ) : (
                        <p className="text-xs text-slate-500">まだ worker ログはありません。</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs leading-5 text-slate-500">
                    セッション開始後にオーケストレーションの内部ログが表示されます。
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">エージェント一覧 ({agents.length})</h2>
            <div className="space-y-3">
              {agents.map((agent) => (
                <div key={agent.id} className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3.5">
                  <div className="flex items-start gap-3">
                    <AgentAvatar
                      size={48}
                      avatarPreset={agent.avatarPreset}
                      avatarCustomDataUrl={agent.avatarCustomDataUrl}
                      alt={`${agent.name} アイコン`}
                      className="rounded-lg border border-slate-700/60"
                      fallbackClassName={
                        agent.role === 'Facilitator'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-cyan-500/20 text-cyan-400'
                      }
                      iconClassName={agent.role === 'Facilitator' ? 'text-amber-400' : 'text-cyan-400'}
                    />

                    <div className="min-w-0 flex-1" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                      <p className="truncate text-sm font-semibold text-slate-100">{agent.name}</p>
                      <p className="text-xs text-slate-400">{formatAgentRole(agent.role)}</p>
                      <p className="mt-2 text-xs text-slate-300">スタンス: {agent.stance}</p>
                      <p className="mt-1 text-xs text-slate-300">性格: {agent.personality}</p>
                      <p
                        className="mt-2 min-h-[40px] text-xs leading-5 text-slate-500"
                        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      >
                        {agent.provider === 'codex' ? 'Codex CLI' : agent.provider === 'gemini' ? 'Gemini CLI' : 'GitHub Copilot CLI'} / {agent.model}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>

      <main className="relative z-0 flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px]" />

        <header className="glass-panel relative z-10 shrink-0 border-b border-slate-700/50 px-6 py-4">
          <div className="mx-auto max-w-7xl space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,1fr)_220px]">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">議題 / 指示</label>
                <textarea
                  rows={6}
                  value={localTopic}
                  onChange={(event) => setLocalTopic(event.target.value)}
                  disabled={sessionStatus === 'running'}
                  placeholder="複数行で入力できます。例: この提案について、コスト、開発速度、運用性、ユーザー影響の観点で議論してください。"
                  className="h-[176px] w-full resize-none rounded-2xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-base leading-7 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-60"
                />
                <p className="text-xs text-slate-500">複数行の自然言語をそのまま議題として扱います。</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">入力ファイル / フォルダ</label>
                <div className="flex h-[176px] flex-col rounded-2xl border border-slate-700 bg-slate-900/50 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={sessionStatus === 'running' || pathDialogBusy !== null}
                      onClick={() => void handleAddFiles()}
                      className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-cyan-500/50 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Upload size={16} />
                      {pathDialogBusy === 'files' ? '選択中...' : 'ファイルを追加'}
                    </button>

                    <button
                      type="button"
                      disabled={sessionStatus === 'running' || pathDialogBusy !== null}
                      onClick={() => void handleAddFolder()}
                      className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-cyan-500/50 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FolderOpen size={16} />
                      {pathDialogBusy === 'folder' ? '選択中...' : 'フォルダを追加'}
                    </button>
                  </div>

                  <div className="mt-3 flex-1 overflow-y-auto">
                    {pendingInputPaths.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {pendingInputPaths.map((filePath) => (
                          <div
                            key={filePath}
                            className="flex max-w-full items-start gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-left"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-cyan-100">{getPathName(filePath)}</p>
                              <p className="truncate text-xs text-cyan-200/70">{filePath}</p>
                            </div>
                            <button
                              type="button"
                              disabled={sessionStatus === 'running'}
                              onClick={() => handleRemoveInputPath(filePath)}
                              className="rounded-full border border-cyan-400/20 p-1 text-cyan-100/70 transition-colors hover:bg-cyan-500/20 hover:text-white"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-700/60 text-center text-sm text-slate-500">
                        ファイルまたはフォルダを追加すると、内容を議論の入力コンテキストに含めます。
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500">複数ファイルを一括追加でき、カードの × で個別に外せます。</p>
                {inputPathError && <p className="text-xs text-rose-300">{inputPathError}</p>}
              </div>

              <div className="flex flex-col justify-end gap-3">
                {sessionStatus !== 'running' ? (
                  <button
                    onClick={handleStart}
                    disabled={!localTopic.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-4 font-bold text-white shadow-lg shadow-cyan-500/20 transition-all hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play size={18} fill="currentColor" />
                    議論を開始
                  </button>
                ) : (
                  <button
                    onClick={stopSession}
                    className="flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-6 py-4 font-bold text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    <Square size={18} fill="currentColor" />
                    停止
                  </button>
                )}
              </div>
            </div>

            {sessionError && (
              <div className="flex items-start justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                <p>{sessionError}</p>
                <button
                  onClick={clearSessionError}
                  className="shrink-0 rounded-lg border border-red-400/20 px-3 py-1 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/10"
                >
                  閉じる
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="relative z-10 min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {sessionStatus === 'idle' && messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-slate-700/50 bg-slate-800/30">
              <div className="space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-slate-500">
                  <BrainCircuit size={30} />
                </div>
                <div>
                  <p className="text-xl font-medium text-slate-300">議題を入力してマルチ CLI 会話を開始してください。</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Codex CLI / Gemini CLI / GitHub Copilot CLI を混在させて議論できます。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-start gap-6 overflow-x-auto overflow-y-visible pb-2 pr-2">
              {agents.map((agent) => {
                const tone = getAgentPanelTone(agent)
                const statusBadge = getStatusBadge(agent)
                const agentMessages = orderedMessages.filter((message) => message.agentId === agent.id)
                const latestMessage = agentMessages[agentMessages.length - 1] ?? null

                return (
                  <section
                    key={agent.id}
                    className={`glass-panel flex min-w-[420px] max-w-[520px] basis-[460px] shrink-0 flex-col self-start overflow-hidden rounded-2xl border min-h-[640px] min-w-0 ${tone.card}`}
                  >
                    <div className={`border-b border-slate-700/50 p-4 ${tone.header}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <AgentAvatar
                            size={64}
                            avatarPreset={agent.avatarPreset}
                            avatarCustomDataUrl={agent.avatarCustomDataUrl}
                            alt={`${agent.name} アイコン`}
                            className="rounded-xl border border-slate-700/60"
                            fallbackClassName={tone.icon}
                            iconClassName={agent.role === 'Facilitator' ? 'text-amber-400' : 'text-cyan-400'}
                          />
                          <div className="min-w-0">
                            <h3 className="truncate text-lg font-bold text-slate-100">{agent.name}</h3>
                            <p className="text-sm text-slate-400">{formatAgentRole(agent.role)}</p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusBadge.className}`}>
                            {statusBadge.label}
                          </span>
                          <span className="rounded-md border border-slate-700/60 bg-slate-900/40 px-2.5 py-1 text-xs text-slate-300">
                            発言 {agent.speakCount}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="flex min-h-[92px] min-w-0 flex-col rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wider text-slate-500">スタンス</p>
                          <p
                            className="mt-1 overflow-hidden break-words text-sm leading-6 text-slate-200"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word'
                          }}
                          >
                            {agent.stance}
                          </p>
                        </div>
                        <div className="flex min-h-[92px] min-w-0 flex-col rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wider text-slate-500">性格</p>
                          <p
                            className="mt-1 overflow-hidden break-words text-sm leading-6 text-slate-200"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word'
                          }}
                          >
                            {agent.personality}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <AgentRuntimeMeta agent={agent} compact />
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/30 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-400">挙手強度</span>
                          <span className="font-mono text-slate-200">{agent.handRaiseIntensity}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-700/60">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                            style={{ width: `${Math.max(0, Math.min(agent.handRaiseIntensity, 100))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="border-b border-slate-700/40 bg-gradient-to-r from-cyan-900/20 to-blue-900/20 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className={`text-xs font-semibold uppercase tracking-wider ${tone.accentText}`}>現在の主張</p>
                        <button
                          onClick={() => latestMessage && setSummaryModal({ agentName: agent.name, content: latestMessage.content })}
                          disabled={!latestMessage}
                          className="group rounded-lg border border-slate-700/60 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-cyan-500/60 hover:text-cyan-300 disabled:cursor-default disabled:opacity-50"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Eye size={14} className="transition-colors group-hover:text-cyan-300" />
                            詳細
                          </span>
                        </button>
                      </div>
                      <div className="mt-3 h-[104px] overflow-hidden rounded-xl border border-slate-700/50 bg-slate-950/20 p-3">
                        <p
                          className="break-words text-sm leading-7 text-slate-200"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word'
                          }}
                        >
                          {latestMessage
                            ? buildDigestFromContent(latestMessage.content)
                            : 'まだ発言はありません。議論が始まるとここに現在の主張が表示されます。'}
                        </p>
                      </div>
                    </div>

                    <div className="border-b border-slate-700/40 bg-slate-900/20 px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-300">発言履歴</p>
                        {agentMessages.length > 0 ? (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {agentMessages.map((message, index) => (
                              <button
                                key={`${message.id}-jump`}
                                onClick={() => scrollToMessage(message.id)}
                                className="rounded-md border border-slate-700/60 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-cyan-500/60 hover:text-cyan-300"
                              >
                                {index + 1}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">発言なし</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 p-3">
                      {agentMessages.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-700/50 p-4 text-sm text-slate-500">
                          このエージェントの発言はまだありません。
                        </div>
                      ) : (
                        agentMessages.map((message, index) => {
                          const globalOrder = orderedMessages.findIndex((entry) => entry.id === message.id) + 1
                          const references = findReferencedMessages(
                            getRenderableMessageContent(message.content),
                            message.id,
                            orderedMessages,
                            agents
                          )

                          return (
                            <article
                              id={`message-${message.id}`}
                              key={message.id}
                              tabIndex={-1}
                              className={`min-w-0 max-w-full overflow-hidden rounded-xl border p-3 outline-none transition-shadow focus:ring-2 focus:ring-cyan-400 ${tone.message}`}
                            >
                              <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
                                <p className={`min-w-0 break-words text-sm font-semibold ${tone.accentText}`}>
                                  {agent.role === 'Facilitator' ? `${index + 1}件目の進行` : `${index + 1}件目の発言`}
                                </p>
                                <div className="shrink-0 text-right text-xs text-slate-400">
                                  <p>全体 {globalOrder} 件目</p>
                                  <p>{formatClock(message.timestamp)}</p>
                                </div>
                              </div>

                              <p
                                className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-200"
                                style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                              >
                                {getRenderableMessageContent(message.content)}
                              </p>

                              {references.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  <p className="text-xs font-medium text-slate-400">参照された発言</p>
                                  <div className="flex flex-wrap gap-2">
                                    {references.map((reference) => (
                                      <button
                                        key={reference.messageId}
                                        onClick={() => scrollToMessage(reference.messageId)}
                                        title={reference.summary}
                                        className="rounded-lg border border-cyan-700/40 bg-cyan-900/20 px-2.5 py-1.5 text-xs font-medium text-cyan-200 transition-all hover:border-cyan-400/70 hover:bg-cyan-800/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                                      >
                                        {reference.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </article>
                          )
                        })
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          {finalConclusion && (
            <section className="glass-panel mt-5 mb-1 shrink-0 rounded-2xl border-t-4 border-cyan-500 bg-slate-800/80 p-6 shadow-2xl shadow-cyan-900/20">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-cyan-500/15 p-2 text-cyan-400">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-cyan-400">最終結論</h3>
                    <p className="text-sm text-slate-400">議論全体を統合した最終出力です。</p>
                  </div>
                </div>

                <button
                  onClick={handleDownloadMd}
                  className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
                >
                  <Download size={16} />
                  MDダウンロード
                </button>
              </div>

              <div className="space-y-5">
                {conclusionSections.map((section) => (
                  <section
                    key={section.title}
                    className="rounded-2xl border border-slate-700/50 bg-slate-900/30 p-5 shadow-lg shadow-slate-950/20"
                  >
                    <h4 className="text-lg font-semibold text-slate-100">{section.title}</h4>
                    <div className="mt-3 space-y-2">
                      {section.lines.map((line, index) => (
                        <p key={`${section.title}-${index}`} className="text-base leading-7 text-slate-200">
                          {line}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
