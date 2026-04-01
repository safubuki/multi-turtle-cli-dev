import { ChevronDown, LoaderCircle, Plus, RefreshCcw, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentAvatar } from './AgentAvatar'
import { DISCUSSION_STYLE_METADATA, EXECUTION_MODE_METADATA } from '../config/modeMetadata'
import {
  PERSONALITY_PRESETS,
  PERSONALITY_VALUE_ALIASES,
  PROVIDER_LABELS,
  REASONING_OPTIONS,
  ROLE_LABELS,
  STANCE_PRESETS,
  STANCE_VALUE_ALIASES,
  appendSelectableValue,
  normalizeSelectableValue,
  parseSelectableValue,
  toggleSelectableValue
} from '../config/agentMetadata'
import {
  BUILT_IN_AGENT_ICON_IDS,
  BUILT_IN_AGENT_ICON_LABELS,
  getAgentIconLabel,
  getDefaultBuiltInAgentIcon
} from '../config/iconAssets'
import { apiRequestJson } from '../lib/apiClient'
import { useStore, type AgentProfile, type ProviderCatalog, type ReasoningEffort } from '../store/useStore'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ProviderInstallSpec {
  provider: 'codex' | 'gemini' | 'copilot'
  label: string
  displayCommand: string
}

interface ProviderInstallRuntimeStatus {
  nodeVersion: string | null
  npmCommand: string
  npmVersion: string | null
  npmAvailable: boolean
}

interface SelectionPanelProps {
  title: string
  presets: readonly string[]
  selectedValues: string[]
  customValue: string
  accentColor: 'cyan' | 'amber'
  onToggle: (value: string) => void
  onClear: () => void
  onClose: () => void
  onCustomChange: (value: string) => void
  onCustomCommit: () => void
}

const ALL_PROVIDERS = Object.keys(PROVIDER_LABELS) as AgentProfile['provider'][]

function getProviderFallbackModel(provider: AgentProfile['provider']): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.5-flash'
    case 'copilot':
      return 'gpt-5.2'
    default:
      return 'gpt-5.4'
  }
}

function createNewAgent(
  index: number,
  provider: AgentProfile['provider'] = 'codex',
  catalog?: ProviderCatalog
): AgentProfile {
  const nextLetter = String.fromCharCode(64 + Math.min(index, 26))
  const model = getProviderInitialModel(catalog, getProviderFallbackModel(provider))
  return {
    id: `agent-${Date.now()}`,
    name: `エージェント${nextLetter}`,
    role: 'Participant',
    stance: '中立・合意形成重視',
    personality: '丁寧・堅実',
    avatarPreset: getDefaultBuiltInAgentIcon(Math.max(0, index - 1)),
    avatarCustomDataUrl: null,
    avatarCustomName: null,
    provider,
    model,
    reasoningEffort: getNextReasoningEffort(model, 'medium', catalog),
    runtimeSessionId: null,
    rateLimits: null,
    status: 'idle',
    handRaiseIntensity: 0,
    speakCount: 0
  }
}

function getReasoningOptions(agent: AgentProfile, catalog: ProviderCatalog | undefined) {
  const modelInfo = catalog?.models.find((model) => model.id === agent.model)
  const supported = modelInfo?.supportedReasoningEfforts ?? []
  return REASONING_OPTIONS.filter((option) => supported.includes(option.value))
}

function getNextReasoningEffort(
  nextModelId: string,
  currentEffort: ReasoningEffort,
  catalog: ProviderCatalog | undefined
): ReasoningEffort {
  const modelInfo = catalog?.models.find((model) => model.id === nextModelId)
  const supported = modelInfo?.supportedReasoningEfforts ?? []

  if (supported.length === 0 || supported.includes(currentEffort)) {
    return currentEffort
  }

  return modelInfo?.defaultReasoningEffort ?? supported[0] ?? 'medium'
}

function getProviderInitialModel(catalog: ProviderCatalog | undefined, fallback: string): string {
  return catalog?.models[0]?.id ?? fallback
}

function getCatalogStatusLabel(status: 'idle' | 'loading' | 'ready' | 'error'): string {
  switch (status) {
    case 'loading':
      return '取得中'
    case 'ready':
      return '利用可能'
    case 'error':
      return 'フォールバック'
    default:
      return '待機中'
  }
}

function getProviderInstallCardMessage(
  isAvailable: boolean,
  hasInstallSpec: boolean,
  canAutoInstall: boolean
): string {
  if (isAvailable) {
    return '利用可能な CLI です。'
  }

  if (!canAutoInstall) {
    return 'この環境では npm が使えないため、先に Node.js のセットアップが必要です。'
  }

  if (hasInstallSpec) {
    return 'CLI は未インストールです。下のボタンかコマンドからインストールできます。'
  }

  return 'CLI は未インストールです。'
}

function getProviderSelectionHelpMessage(
  isProviderSelectionReady: boolean,
  isCurrentProviderInstalled: boolean,
  canAutoInstall: boolean
): string {
  if (!isProviderSelectionReady) {
    return 'CLI 状態を確認中です。確認後に切り替えできます。'
  }

  if (isCurrentProviderInstalled) {
    return 'インストール済みの CLI です。'
  }

  if (!canAutoInstall) {
    return 'npm が見つからないため、自動インストール前に Node.js のセットアップが必要です。'
  }

  return '現在の CLI は未インストールです。上部の CLI 状態からインストールできます。'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('画像データの読み込みに失敗しました。'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('画像データの読み込みに失敗しました。'))
    reader.readAsDataURL(file)
  })
}

function SelectionPanel({
  title,
  presets,
  selectedValues,
  customValue,
  accentColor,
  onToggle,
  onClear,
  onClose,
  onCustomChange,
  onCustomCommit
}: SelectionPanelProps) {
  const selectedClass =
    accentColor === 'amber'
      ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
      : 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'

  return (
    <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-950/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-200">{title}（複数選択可）</p>
          <p className="mt-1 text-xs text-slate-500">選択中の要素に加えるニュアンスを複数選べます。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
          >
            クリア
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-[56px] rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-3">
        {selectedValues.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedValues.map((item) => (
              <span key={item} className={`rounded-full border px-2.5 py-1 text-xs ${selectedClass}`}>
                {item}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">まだ選択されていません。</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {presets.map((preset) => {
          const isSelected = selectedValues.includes(preset)
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onToggle(preset)}
              className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all ${
                isSelected
                  ? selectedClass
                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-500 hover:text-white'
              }`}
            >
              {preset}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={customValue}
          onChange={(event) => onCustomChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onCustomCommit()
            }
          }}
          placeholder="追加ニュアンス（任意）例: 少し皮肉を交えて"
          className="flex-1 rounded-xl border border-slate-600/60 bg-slate-900/50 px-4 py-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-500"
        />
        <button
          type="button"
          onClick={onCustomCommit}
          disabled={!customValue.trim()}
          className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-300 transition-colors hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/50 disabled:text-slate-500"
        >
          追加
        </button>
      </div>
    </div>
  )
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    agents,
    addAgent,
    updateAgent,
    removeAgent,
    resetAgentsToDefault,
    resetAgentToDefault,
    saveSettings,
    clearSavedSettings,
    turnLimit,
    setTurnLimit,
    environment,
    executionMode,
    setExecutionMode,
    discussionStyle,
    setDiscussionStyle,
    providerCatalogs,
    providerCatalogStatus,
    providerCatalogError,
    refreshProviderCatalogs
  } = useStore()

  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [openPanel, setOpenPanel] = useState<{ agentId: string; type: 'stance' | 'personality' } | null>(null)
  const [installSpecs, setInstallSpecs] = useState<Record<'codex' | 'gemini' | 'copilot', ProviderInstallSpec> | null>(null)
  const [installRuntime, setInstallRuntime] = useState<ProviderInstallRuntimeStatus | null>(null)
  const [installBusyProvider, setInstallBusyProvider] = useState<'codex' | 'gemini' | 'copilot' | null>(null)
  const [installFeedback, setInstallFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    agents.forEach((agent) => {
      const normalizedStance = normalizeSelectableValue(agent.stance, STANCE_PRESETS, STANCE_VALUE_ALIASES)
      const normalizedPersonality = normalizeSelectableValue(
        agent.personality,
        PERSONALITY_PRESETS,
        PERSONALITY_VALUE_ALIASES
      )

      if (normalizedStance !== agent.stance || normalizedPersonality !== agent.personality) {
        updateAgent(agent.id, {
          stance: normalizedStance,
          personality: normalizedPersonality
        })
      }
    })
  }, [agents, isOpen, updateAgent])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    void refreshProviderCatalogs(true)
    void (async () => {
      try {
        const data = await apiRequestJson<{
          success?: boolean
          providers?: Record<'codex' | 'gemini' | 'copilot', ProviderInstallSpec>
          runtime?: ProviderInstallRuntimeStatus
        }>('/api/providers/install-info')

        if (data.success && data.providers) {
          setInstallSpecs(data.providers)
          setInstallRuntime(data.runtime ?? null)
        }
      } catch (error) {
        console.error('Failed to load provider install info:', error)
        setInstallRuntime(null)
      }
    })()
  }, [isOpen, refreshProviderCatalogs])

  if (!isOpen) {
    return null
  }

  const isConversationMode = discussionStyle === 'conversation'
  const executionModeInfo = EXECUTION_MODE_METADATA[executionMode]
  const discussionStyleInfo = DISCUSSION_STYLE_METADATA[discussionStyle]
  const isProviderSelectionReady = providerCatalogStatus === 'ready'
  const availableProviders = isProviderSelectionReady
    ? ALL_PROVIDERS.filter((provider) => providerCatalogs[provider]?.available)
    : []
  const canAutoInstall = installRuntime?.npmAvailable ?? true
  const shouldShowBaseSetupGuide = isProviderSelectionReady && availableProviders.length === 0 && !canAutoInstall
  const getCustomKey = (agentId: string, field: 'stance' | 'personality') => `${agentId}:${field}`
  const setCustomValue = (agentId: string, field: 'stance' | 'personality', value: string) => {
    setCustomInputs((current) => ({ ...current, [getCustomKey(agentId, field)]: value }))
  }
  const clearCustomValue = (agentId: string, field: 'stance' | 'personality') => {
    setCustomInputs((current) => ({ ...current, [getCustomKey(agentId, field)]: '' }))
  }
  const handleCustomAvatarSelected = async (agentId: string, file: File | null) => {
    if (!file) {
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    updateAgent(agentId, {
      avatarCustomDataUrl: dataUrl,
      avatarCustomName: file.name
    })
  }
  const handleInstallProvider = async (provider: 'codex' | 'gemini' | 'copilot') => {
    const spec = installSpecs?.[provider]
    if (!spec) {
      return
    }

    if (!canAutoInstall) {
      setInstallFeedback('Node.js のセットアップが必要です。上部の案内を確認してから再試行してください。')
      return
    }

    const approved = window.confirm(
      `${spec.label} をインストールします。\n\n実行コマンド:\n${spec.displayCommand}\n\n続行しますか？`
    )
    if (!approved) {
      return
    }

    setInstallBusyProvider(provider)
    setInstallFeedback(null)

    try {
      const data = await apiRequestJson<{
        success?: boolean
        command?: string
        details?: string
        error?: string
      }>('/api/providers/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      })

      if (!data.success) {
        throw new Error(data.details || data.error || 'CLI のインストールに失敗しました。')
      }

      setInstallFeedback(`${spec.label} をインストールしました。`)
      await refreshProviderCatalogs(true)
    } catch (error) {
      console.error(`Failed to install ${provider}:`, error)
      if (error instanceof Error && /NODE_SETUP_REQUIRED/i.test(error.message)) {
        setInstallFeedback('Node.js のセットアップが必要です。上部の案内を確認してから再試行してください。')
      } else {
        setInstallFeedback(`${spec.label} のインストールに失敗しました。表示コマンドを手動で実行してください。`)
      }
    } finally {
      setInstallBusyProvider(null)
    }
  }

  const handleSave = () => {
    saveSettings()
    onClose()
  }

  const handleClearSavedSettings = () => {
    const approved = window.confirm(
      '保存済みの設定を削除して、画面をデフォルト値に戻します。\n\n続行しますか？'
    )

    if (!approved) {
      return
    }

    clearSavedSettings()
    setOpenPanel(null)
    setCustomInputs({})
    setInstallFeedback('保存済み設定をクリアしました。デフォルト値を表示しています。')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700/60 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-slate-100">設定・エージェント管理</h2>
            <p className="mt-1 text-sm text-slate-400">スタンスと性格はパネル選択を中心に調整できます。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshProviderCatalogs(true)}
              disabled={providerCatalogStatus === 'loading'}
              className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {providerCatalogStatus === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
              モデル候補を再取得
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-400">CLI 状態</h3>
              <div className="rounded-full border border-slate-700/60 bg-slate-900/40 px-3 py-1 text-xs text-slate-400">
                緑=導入済み / 赤=未導入
              </div>
            </div>

            {shouldShowBaseSetupGuide && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                <p className="font-semibold text-amber-200">先に Node.js のセットアップが必要です</p>
                <p className="mt-2 text-xs leading-6 text-amber-100/90">
                  この環境では <span className="font-mono">{installRuntime?.npmCommand ?? 'npm'}</span> が使えないため、CLI の自動インストールをまだ実行できません。
                </p>
                <p className="mt-2 text-xs leading-6 text-amber-100/90">
                  1. Node.js をインストールしてください（npm 同梱）
                  <br />
                  2. 設定画面を開き直すか、CLI 状態を再読み込みしてください
                  <br />
                  3. その後に下の CLI インストールを実行してください
                </p>
                <a
                  href="https://nodejs.org/ja"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-xs font-medium text-amber-200 underline underline-offset-2 hover:text-white"
                >
                  Node.js 公式サイトを開く
                </a>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {(['codex', 'gemini', 'copilot'] as const).map((provider) => {
                const catalog = providerCatalogs[provider]
                const isAvailable = catalog?.available ?? false
                const statusClass = isAvailable
                  ? 'bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.75)]'
                  : 'bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.75)]'
                const spec = installSpecs?.[provider] ?? null

                return (
                  <div key={provider} className="rounded-2xl border border-slate-700/60 bg-slate-900/35 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className={`mt-1 inline-block h-3 w-3 rounded-full ${statusClass}`} />
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{PROVIDER_LABELS[provider]}</p>
                          <p className="mt-1 text-xs text-slate-400">{isAvailable ? 'インストール済み' : '未インストール'}</p>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      {catalog?.source ? `検出元: ${catalog.source}` : '検出情報なし'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {getProviderInstallCardMessage(isAvailable, Boolean(spec), canAutoInstall)}
                    </p>

                    {!isAvailable && spec && (
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => void handleInstallProvider(provider)}
                          disabled={installBusyProvider !== null || !canAutoInstall}
                          className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-300 transition-colors hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {installBusyProvider === provider ? 'インストール中...' : canAutoInstall ? 'インストール' : 'Node.js が必要'}
                        </button>
                        <p className="break-all whitespace-pre-wrap rounded-lg border border-slate-700/50 bg-slate-950/40 px-3 py-2 font-mono text-[11px] leading-5 text-slate-400">
                          {spec.displayCommand}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {installFeedback && (
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
                {installFeedback}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-400">セッション設定</h3>
              <div className="rounded-full border border-slate-700/60 bg-slate-900/40 px-3 py-1 text-xs text-slate-400">
                CLI モデル同期: {getCatalogStatusLabel(providerCatalogStatus)}
              </div>
            </div>

            {providerCatalogError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                モデル候補の取得に失敗したため、一部はフォールバック表示です: {providerCatalogError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setExecutionMode('orchestration')}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  executionMode === 'orchestration'
                    ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                }`}
              >
                <p className="font-semibold">{EXECUTION_MODE_METADATA.orchestration.label}</p>
                <p className="mt-1 text-xs opacity-80">{EXECUTION_MODE_METADATA.orchestration.shortDescription}</p>
              </button>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-left text-slate-500 opacity-60"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{EXECUTION_MODE_METADATA.autonomous.label}</p>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] tracking-wider text-slate-500">
                    {EXECUTION_MODE_METADATA.autonomous.badge}
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-80">{EXECUTION_MODE_METADATA.autonomous.shortDescription}</p>
              </button>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-slate-300">
              {executionModeInfo.longDescription}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpenPanel(null)
                  setDiscussionStyle('conversation')
                }}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  discussionStyle === 'conversation'
                    ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300'
                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                }`}
              >
                <p className="font-semibold">{DISCUSSION_STYLE_METADATA.conversation.label}</p>
                <p className="mt-1 text-xs opacity-80">{DISCUSSION_STYLE_METADATA.conversation.shortDescription}</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenPanel(null)
                  setDiscussionStyle('meeting')
                }}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  discussionStyle === 'meeting'
                    ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                }`}
              >
                <p className="font-semibold">{DISCUSSION_STYLE_METADATA.meeting.label}</p>
                <p className="mt-1 text-xs opacity-80">{DISCUSSION_STYLE_METADATA.meeting.shortDescription}</p>
              </button>
            </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
              {discussionStyleInfo.longDescription}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-slate-400">実行環境</label>
                <select
                  value={environment}
                  disabled
                  className="w-full cursor-not-allowed rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-400 opacity-70"
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="full">Full Access</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-slate-400">ターン数</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={turnLimit}
                  onChange={(event) => setTurnLimit(Number(event.target.value) || 1)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-200 outline-none focus:border-cyan-500"
                />
              </div>
            </div>

          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-400">
                エージェント設定 ({isConversationMode ? '2名固定' : `${agents.length}名`})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpenPanel(null)
                    resetAgentsToDefault()
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
                >
                  <RotateCcw size={14} />
                  リセット
                </button>
                {!isConversationMode && (
                  <button
                    type="button"
                    onClick={() => {
                      const provider = availableProviders[0] ?? 'codex'
                      addAgent(createNewAgent(agents.length + 1, provider, providerCatalogs[provider]))
                    }}
                    disabled={agents.length >= 6}
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    <Plus size={16} />
                    追加
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {agents.map((agent) => {
                const isFacilitator = agent.role === 'Facilitator'
                const providerCatalog = providerCatalogs[agent.provider]
                const isCurrentProviderInstalled = providerCatalog?.available ?? false
                const providerSelectDisabled = !isProviderSelectionReady || availableProviders.length === 0
                const modelOptions = providerCatalog?.models ?? []
                const fallbackModelOption =
                  modelOptions.length === 0 && agent.model
                    ? [
                        {
                          id: agent.model,
                          name: `${agent.model} (現在値)`
                        }
                      ]
                    : []
                const displayModelOptions = modelOptions.length > 0 ? modelOptions : fallbackModelOption
                const hasCurrentModel = displayModelOptions.some((model) => model.id === agent.model)
                const reasoningOptions = getReasoningOptions(agent, providerCatalog)
                const showReasoning = reasoningOptions.length > 0
                const isStanceOpen = openPanel?.agentId === agent.id && openPanel.type === 'stance'
                const isPersonalityOpen = openPanel?.agentId === agent.id && openPanel.type === 'personality'
                const accentColor = isFacilitator ? 'amber' : 'cyan'
                const normalizedStance = normalizeSelectableValue(agent.stance, STANCE_PRESETS, STANCE_VALUE_ALIASES)
                const normalizedPersonality = normalizeSelectableValue(
                  agent.personality,
                  PERSONALITY_PRESETS,
                  PERSONALITY_VALUE_ALIASES
                )
                const stanceDisplay = normalizedStance || '未設定'
                const personalityDisplay = normalizedPersonality || '未設定'
                const selectedAvatarLabel = getAgentIconLabel(agent.avatarPreset, agent.avatarCustomName)
                const selectedButtonClass = isFacilitator
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                  : 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'

                return (
                  <div
                    key={agent.id}
                    className={`rounded-2xl border p-4 ${
                      isFacilitator
                        ? 'border-amber-500/30 bg-amber-500/10'
                        : 'border-slate-700/70 bg-slate-900/45'
                    }`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-slate-100">{agent.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {ROLE_LABELS[agent.role]} ・ {PROVIDER_LABELS[agent.provider]}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenPanel((current) => (current?.agentId === agent.id ? null : current))
                            resetAgentToDefault(agent.id)
                          }}
                          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-amber-300"
                        >
                          <RotateCcw size={14} />
                        </button>
                        {!isConversationMode && agents.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeAgent(agent.id)}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-400"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-900/25 p-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                        <div className="flex min-w-0 items-center gap-4">
                          <AgentAvatar
                            size={72}
                            avatarPreset={agent.avatarPreset}
                            avatarCustomDataUrl={agent.avatarCustomDataUrl}
                            alt={`${agent.name} アイコン`}
                            className="rounded-2xl border border-slate-700/60"
                            fallbackClassName={
                              isFacilitator
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-cyan-500/20 text-cyan-400'
                            }
                            iconClassName={isFacilitator ? 'text-amber-400' : 'text-cyan-400'}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-300">アイコン</p>
                            <p className="mt-1 break-words text-sm text-slate-100">{selectedAvatarLabel}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              `未選択` は標準アイコン、`画像を選択` はその場でカスタム画像に切り替わります。
                            </p>
                          </div>
                        </div>

                        <div className="flex-1 space-y-3">
                          <div className="grid grid-cols-[repeat(5,minmax(0,64px))] gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateAgent(agent.id, {
                                  avatarPreset: null,
                                  avatarCustomDataUrl: null,
                                  avatarCustomName: null
                                })
                              }
                              className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all ${
                                agent.avatarPreset === null && !agent.avatarCustomDataUrl
                                  ? selectedButtonClass
                                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-500 hover:text-white'
                              }`}
                            >
                              未選択
                            </button>

                            {BUILT_IN_AGENT_ICON_IDS.map((iconId) => (
                              <button
                                key={iconId}
                                title={BUILT_IN_AGENT_ICON_LABELS[iconId]}
                                type="button"
                                onClick={() =>
                                  updateAgent(agent.id, {
                                    avatarPreset: iconId,
                                    avatarCustomDataUrl: null,
                                    avatarCustomName: null
                                  })
                                }
                                className={`flex h-16 w-16 items-center justify-center rounded-xl border p-2 transition-all ${
                                  agent.avatarPreset === iconId && !agent.avatarCustomDataUrl
                                    ? selectedButtonClass
                                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-500 hover:text-white'
                                }`}
                              >
                                <AgentAvatar
                                  size={40}
                                  avatarPreset={iconId}
                                  avatarCustomDataUrl={null}
                                  alt={BUILT_IN_AGENT_ICON_LABELS[iconId]}
                                  className="rounded-lg border border-slate-700/60"
                                />
                              </button>
                            ))}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-slate-800 hover:text-white">
                              画像を選択
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => {
                                  const file = event.target.files?.[0] ?? null
                                  void handleCustomAvatarSelected(agent.id, file)
                                  event.currentTarget.value = ''
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={!agent.avatarCustomDataUrl}
                              onClick={() =>
                                updateAgent(agent.id, {
                                  avatarCustomDataUrl: null,
                                  avatarCustomName: null
                                })
                              }
                              className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              カスタム解除
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-400">エージェント名</label>
                        <input
                          type="text"
                          value={agent.name}
                          onChange={(event) => updateAgent(agent.id, { name: event.target.value })}
                          className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-base font-medium text-slate-100 outline-none focus:border-cyan-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-400">ロール</label>
                        <select
                          value={agent.role}
                          onChange={(event) => updateAgent(agent.id, { role: event.target.value as AgentProfile['role'] })}
                          disabled={isConversationMode}
                          className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="Participant">参加者</option>
                          <option value="Facilitator">ファシリテータ</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-400">スタンス（意見の方向性）</label>
                        <button
                          type="button"
                          onClick={() => setOpenPanel(isStanceOpen ? null : { agentId: agent.id, type: 'stance' })}
                          className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-left text-base text-slate-100 transition-colors hover:border-cyan-500/50"
                        >
                          <span className="min-w-0 whitespace-normal break-words text-sm leading-6">{stanceDisplay}</span>
                          <ChevronDown size={14} className={`ml-2 shrink-0 text-slate-500 transition-transform ${isStanceOpen ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-400">性格（パーソナリティ）</label>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPanel(isPersonalityOpen ? null : { agentId: agent.id, type: 'personality' })
                          }
                          className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-left text-base text-slate-100 transition-colors hover:border-cyan-500/50"
                        >
                          <span className="min-w-0 whitespace-normal break-words text-sm leading-6">{personalityDisplay}</span>
                          <ChevronDown
                            size={14}
                            className={`ml-2 shrink-0 text-slate-500 transition-transform ${isPersonalityOpen ? 'rotate-180' : ''}`}
                          />
                        </button>
                      </div>
                    </div>

                    {isStanceOpen && (
                      <div className="mt-4 space-y-4 rounded-2xl border border-slate-700/50 bg-slate-900/25 p-4">
                        <SelectionPanel
                          title="スタンス"
                          presets={STANCE_PRESETS}
                          selectedValues={parseSelectableValue(normalizedStance)}
                          customValue={customInputs[getCustomKey(agent.id, 'stance')] ?? ''}
                          accentColor={accentColor}
                          onToggle={(value) => updateAgent(agent.id, { stance: toggleSelectableValue(normalizedStance, value) })}
                          onClear={() => updateAgent(agent.id, { stance: '' })}
                          onClose={() => setOpenPanel(null)}
                          onCustomChange={(value) => setCustomValue(agent.id, 'stance', value)}
                          onCustomCommit={() => {
                            const nextValue = customInputs[getCustomKey(agent.id, 'stance')] ?? ''
                            if (!nextValue.trim()) return
                            updateAgent(agent.id, { stance: appendSelectableValue(normalizedStance, nextValue) })
                            clearCustomValue(agent.id, 'stance')
                          }}
                        />
                      </div>
                    )}

                    {isPersonalityOpen && (
                      <div className="mt-4 space-y-4 rounded-2xl border border-slate-700/50 bg-slate-900/25 p-4">
                        <SelectionPanel
                          title="性格"
                          presets={PERSONALITY_PRESETS}
                          selectedValues={parseSelectableValue(normalizedPersonality)}
                          customValue={customInputs[getCustomKey(agent.id, 'personality')] ?? ''}
                          accentColor={accentColor}
                          onToggle={(value) =>
                            updateAgent(agent.id, { personality: toggleSelectableValue(normalizedPersonality, value) })
                          }
                          onClear={() => updateAgent(agent.id, { personality: '' })}
                          onClose={() => setOpenPanel(null)}
                          onCustomChange={(value) => setCustomValue(agent.id, 'personality', value)}
                          onCustomCommit={() => {
                            const nextValue = customInputs[getCustomKey(agent.id, 'personality')] ?? ''
                            if (!nextValue.trim()) return
                            updateAgent(agent.id, { personality: appendSelectableValue(normalizedPersonality, nextValue) })
                            clearCustomValue(agent.id, 'personality')
                          }}
                        />
                      </div>
                    )}

                    <div className="mt-4 grid gap-4 xl:grid-cols-3">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-400">CLI</label>
                        <select
                          value={agent.provider}
                          onChange={(event) => {
                            const provider = event.target.value as AgentProfile['provider']
                            const nextCatalog = providerCatalogs[provider]
                            if (!nextCatalog?.available) {
                              return
                            }
                            const nextModel = getProviderInitialModel(nextCatalog, agent.model)
                            updateAgent(agent.id, {
                              provider,
                              model: nextModel,
                              reasoningEffort: getNextReasoningEffort(nextModel, agent.reasoningEffort, nextCatalog)
                            })
                          }}
                          disabled={providerSelectDisabled}
                          className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-cyan-500"
                        >
                          {ALL_PROVIDERS.map((provider) => {
                            const catalog = providerCatalogs[provider]
                            const isAvailable = catalog?.available ?? false
                            return (
                              <option
                                key={provider}
                                value={provider}
                                disabled={isProviderSelectionReady ? !isAvailable : provider !== agent.provider}
                              >
                                {isAvailable ? PROVIDER_LABELS[provider] : `${PROVIDER_LABELS[provider]} (未インストール)`}
                              </option>
                            )
                          })}
                        </select>
                        <p className={`text-xs ${isCurrentProviderInstalled ? 'text-slate-500' : 'text-amber-300'}`}>
                          {getProviderSelectionHelpMessage(
                            isProviderSelectionReady,
                            isCurrentProviderInstalled,
                            canAutoInstall
                          )}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-400">Model</label>
                        <select
                          value={agent.model}
                          onChange={(event) => {
                            const nextModel = event.target.value
                            updateAgent(agent.id, {
                              model: nextModel,
                              reasoningEffort: getNextReasoningEffort(nextModel, agent.reasoningEffort, providerCatalog)
                            })
                          }}
                          className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-cyan-500"
                        >
                          {!hasCurrentModel && <option value={agent.model}>{agent.model} (現在値)</option>}
                          {displayModelOptions.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-slate-500">取得元: {providerCatalog?.source ?? 'fallback'}</p>
                      </div>
                      {showReasoning && (
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-slate-400">Reasoning</label>
                          <select
                            value={agent.reasoningEffort}
                            onChange={(event) =>
                              updateAgent(agent.id, {
                                reasoningEffort: event.target.value as AgentProfile['reasoningEffort']
                              })
                            }
                            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-base text-slate-100 outline-none focus:border-cyan-500"
                          >
                            {reasoningOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label} - {option.description}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                  </div>
                )
              })}
            </div>
          </section>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-700/50 px-6 py-5">
          <button
            type="button"
            onClick={handleClearSavedSettings}
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-2.5 font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
          >
            設定をクリア
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 font-medium text-white shadow-lg transition-all hover:from-cyan-400 hover:to-blue-500"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
