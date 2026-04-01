import { create } from 'zustand'
import {
  PERSONALITY_PRESETS,
  PERSONALITY_VALUE_ALIASES,
  STANCE_PRESETS,
  STANCE_VALUE_ALIASES,
  normalizeSelectableValue
} from '../config/agentMetadata'
import { getDefaultBuiltInAgentIcon, type BuiltInAgentIconId } from '../config/iconAssets'
import { apiRequestJson } from '../lib/apiClient'

export type AgentRole = 'Participant' | 'Facilitator'
export type HandRaiseMode = 'rule-based' | 'ai-evaluation'
export type ExecutionMode = 'orchestration' | 'autonomous'
export type DiscussionStyle = 'conversation' | 'meeting'
export type AgentCliProvider = 'codex' | 'gemini' | 'copilot'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export interface RateLimitWindow {
  remaining: number | null
  limit: number | null
  resetAt: string | null
}

export interface AgentRateLimits {
  daily: RateLimitWindow | null
  weekly: RateLimitWindow | null
  source: string | null
}

export interface ProviderModelInfo {
  id: string
  name: string
  description?: string
  supportedReasoningEfforts: ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort | null
  billingMultiplier: number | null
}

export interface ProviderCatalog {
  provider: AgentCliProvider
  label: string
  source: string
  fetchedAt: string | null
  available: boolean
  models: ProviderModelInfo[]
  error: string | null
}

export type ProviderCatalogMap = Record<AgentCliProvider, ProviderCatalog>

export interface AgentProfile {
  id: string
  name: string
  role: AgentRole
  stance: string
  personality: string
  avatarPreset: BuiltInAgentIconId | null
  avatarCustomDataUrl: string | null
  avatarCustomName: string | null
  provider: AgentCliProvider
  model: string
  reasoningEffort: ReasoningEffort
  runtimeSessionId: string | null
  rateLimits: AgentRateLimits | null
  status: 'idle' | 'thinking' | 'speaking' | 'raising_hand'
  handRaiseIntensity: number
  speakCount: number
}

export interface Message {
  id: string
  agentId: string
  content: string
  summary: string
  timestamp: number
}

export interface OrchestrationDebug {
  sessionId: string
  turn: number
  selectedSpeakerId: string | null
  dispatchReason: string
  facilitator: {
    agentId: string
    runtimeSessionId: string | null
    overview: string
    rationale: string
    nextFocus: string
    selectedAgentId: string | null
    selectedAgentIds: string[]
    inviteAgentIds: string[]
    interventionPriority: number
    shouldIntervene: boolean
    parallelDispatch: boolean
  } | null
  scores: Array<{
    agentId: string
    runtimeSessionId: string | null
    score: number
    confidence: number
    desiredAction: string
    reason: string
  }>
  workers: Array<{
    workerId: string
    kind: 'score' | 'moderation' | 'speech' | 'synthesis'
    targetAgentId?: string
    startedAt: number
    finishedAt: number
    durationMs: number
  }>
  agentSessions: Array<{
    agentId: string
    runtimeSessionId: string | null
    inboxCount: number
    outboxCount: number
  }>
  log: Array<{
    turn: number
    kind: 'message' | 'moderation' | 'synthesis'
    summary: string
    timestamp: number
  }>
}

interface TurtleBrainState {
  agents: AgentProfile[]
  topic: string
  inputPaths: string[]
  turnLimit: number
  currentTurn: number
  environment: 'sandbox' | 'full'
  handRaiseMode: HandRaiseMode
  executionMode: ExecutionMode
  discussionStyle: DiscussionStyle
  messages: Message[]
  sessionStatus: 'idle' | 'running' | 'finished'
  finalConclusion: string | null
  sessionError: string | null
  backendSessionId: string | null
  sessionRunNonce: number
  orchestrationDebug: OrchestrationDebug | null
  providerCatalogs: ProviderCatalogMap
  providerCatalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  providerCatalogError: string | null
  setTopic: (topic: string) => void
  setInputPaths: (paths: string[]) => void
  setExecutionMode: (mode: ExecutionMode) => void
  setDiscussionStyle: (style: DiscussionStyle) => void
  setTurnLimit: (limit: number) => void
  addAgent: (agent: AgentProfile) => void
  updateAgent: (id: string, updates: Partial<AgentProfile>) => void
  removeAgent: (id: string) => void
  resetAgentsToDefault: () => void
  resetAgentToDefault: (id: string) => void
  saveSettings: () => void
  clearSavedSettings: () => void
  refreshProviderCatalogs: (force?: boolean) => Promise<void>
  startSession: (topic: string, inputPaths?: string[]) => void
  stopSession: () => void
  clearSessionError: () => void
  resetSession: () => void
  processNextTurn: () => Promise<void>
}

function createEmptyRateLimits(): AgentRateLimits {
  return {
    daily: null,
    weekly: null,
    source: null
  }
}

function createProviderModel(
  id: string,
  name: string,
  options?: {
    description?: string
    supportedReasoningEfforts?: ReasoningEffort[]
    defaultReasoningEffort?: ReasoningEffort | null
    billingMultiplier?: number | null
  }
): ProviderModelInfo {
  return {
    id,
    name,
    description: options?.description,
    supportedReasoningEfforts: options?.supportedReasoningEfforts ?? [],
    defaultReasoningEffort: options?.defaultReasoningEffort ?? null,
    billingMultiplier: options?.billingMultiplier ?? null
  }
}

function createFallbackProviderCatalogs(): ProviderCatalogMap {
  return {
    codex: {
      provider: 'codex',
      label: 'Codex CLI',
      source: 'fallback',
      fetchedAt: null,
      available: true,
      error: null,
      models: [
        createProviderModel('gpt-5.4', 'gpt-5.4', {
          description: 'Latest frontier agentic coding model.',
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.4-mini', 'gpt-5.4-mini', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.3-codex', 'gpt-5.3-codex', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.2-codex', 'gpt-5.2-codex', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.2', 'gpt-5.2', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.1-codex-max', 'gpt-5.1-codex-max', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.1-codex', 'gpt-5.1-codex', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.1', 'gpt-5.1', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium'
        }),
        createProviderModel('gpt-5.1-codex-mini', 'gpt-5.1-codex-mini', {
          supportedReasoningEfforts: ['medium', 'high'],
          defaultReasoningEffort: 'medium'
        })
      ]
    },
    gemini: {
      provider: 'gemini',
      label: 'Gemini CLI',
      source: 'fallback',
      fetchedAt: null,
      available: true,
      error: null,
      models: [
        createProviderModel('auto-gemini-3', 'Auto (Gemini 3)'),
        createProviderModel('auto-gemini-2.5', 'Auto (Gemini 2.5)'),
        createProviderModel('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
        createProviderModel('gemini-3.1-pro-preview-customtools', 'Gemini 3.1 Pro Preview Custom Tools'),
        createProviderModel('gemini-3-flash-preview', 'Gemini 3 Flash Preview'),
        createProviderModel('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview'),
        createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
        createProviderModel('gemini-2.5-flash', 'Gemini 2.5 Flash'),
        createProviderModel('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite')
      ]
    },
    copilot: {
      provider: 'copilot',
      label: 'GitHub Copilot CLI',
      source: 'fallback',
      fetchedAt: null,
      available: true,
      error: null,
      models: [
        createProviderModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('claude-opus-4.6', 'Claude Opus 4.6', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'high',
          billingMultiplier: 3
        }),
        createProviderModel('gemini-3-pro-preview', 'Gemini 3 Pro (Preview)', {
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.4', 'GPT-5.4', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.3-codex', 'GPT-5.3-Codex', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.2-codex', 'GPT-5.2-Codex', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'high',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.2', 'GPT-5.2', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.1-codex-max', 'GPT-5.1-Codex-Max', {
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.1-codex', 'GPT-5.1-Codex', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.1', 'GPT-5.1', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 1
        }),
        createProviderModel('gpt-5.1-codex-mini', 'GPT-5.1-Codex-Mini', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 0.33
        }),
        createProviderModel('gpt-5-mini', 'GPT-5 mini', {
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          billingMultiplier: 0
        })
      ]
    }
  }
}

function getDefaultCatalogs(): ProviderCatalogMap {
  return createFallbackProviderCatalogs()
}

function cloneCatalogs(catalogs: ProviderCatalogMap): ProviderCatalogMap {
  return {
    codex: { ...catalogs.codex, models: catalogs.codex.models.map((model) => ({ ...model })) },
    gemini: { ...catalogs.gemini, models: catalogs.gemini.models.map((model) => ({ ...model })) },
    copilot: { ...catalogs.copilot, models: catalogs.copilot.models.map((model) => ({ ...model })) }
  }
}

function normalizeAgentSelections<T extends { stance: string; personality: string }>(agent: T): T {
  return {
    ...agent,
    stance: normalizeSelectableValue(agent.stance, STANCE_PRESETS, STANCE_VALUE_ALIASES),
    personality: normalizeSelectableValue(agent.personality, PERSONALITY_PRESETS, PERSONALITY_VALUE_ALIASES)
  }
}

function ensureAgentAvatarState(agent: AgentProfile, index = 0): AgentProfile {
  const rawAgent = agent as AgentProfile & {
    avatarPreset?: BuiltInAgentIconId | null
    avatarCustomDataUrl?: string | null
    avatarCustomName?: string | null
  }

  return {
    ...agent,
    avatarPreset:
      rawAgent.avatarPreset === undefined ? getDefaultBuiltInAgentIcon(index) : (rawAgent.avatarPreset ?? null),
    avatarCustomDataUrl: rawAgent.avatarCustomDataUrl ?? null,
    avatarCustomName: rawAgent.avatarCustomName ?? null
  }
}

function createAgent(
  partial: Pick<AgentProfile, 'id' | 'name' | 'role' | 'stance' | 'personality'> &
    Partial<Pick<AgentProfile, 'provider' | 'model' | 'reasoningEffort' | 'avatarPreset' | 'avatarCustomDataUrl' | 'avatarCustomName'>>
): AgentProfile {
  const baseAgent: AgentProfile = {
    provider: partial.provider ?? 'codex',
    model: partial.model ?? 'gpt-5.4',
    reasoningEffort: partial.reasoningEffort ?? 'medium',
    avatarPreset: partial.avatarPreset ?? null,
    avatarCustomDataUrl: partial.avatarCustomDataUrl ?? null,
    avatarCustomName: partial.avatarCustomName ?? null,
    runtimeSessionId: null,
    rateLimits: createEmptyRateLimits(),
    status: 'idle',
    handRaiseIntensity: 0,
    speakCount: 0,
    ...partial
  }

  return ensureAgentAvatarState(normalizeAgentSelections(baseAgent))
}

const conversationDefaultAgents: AgentProfile[] = [
  createAgent({
    id: 'agent-1',
    name: 'エージェントA',
    role: 'Participant',
    stance: 'アイデア出し・新規性重視',
    personality: '率直・論理的',
    avatarPreset: 'user_icon1',
    provider: 'codex',
    model: 'gpt-5.4'
  }),
  createAgent({
    id: 'agent-2',
    name: 'エージェントB',
    role: 'Participant',
    stance: '批判的・データ重視',
    personality: '丁寧・堅実',
    avatarPreset: 'user_icon2',
    provider: 'copilot',
    model: 'gpt-5.2'
  })
]

const meetingDefaultAgents: AgentProfile[] = [
  createAgent({
    id: 'agent-1',
    name: 'エージェントA',
    role: 'Participant',
    stance: 'アイデア出し・新規性重視',
    personality: '率直・論理的',
    avatarPreset: 'user_icon1',
    provider: 'codex',
    model: 'gpt-5.4'
  }),
  createAgent({
    id: 'agent-2',
    name: 'エージェントB',
    role: 'Participant',
    stance: '品質重視・リスク分析',
    personality: '慎重・分析的',
    avatarPreset: 'user_icon2',
    provider: 'copilot',
    model: 'gpt-5.2'
  }),
  createAgent({
    id: 'agent-3',
    name: 'エージェントC',
    role: 'Participant',
    stance: 'ユーザー目線',
    personality: '前向き・協調的',
    avatarPreset: 'user_icon3',
    provider: 'gemini',
    model: 'gemini-2.5-flash'
  }),
  createAgent({
    id: 'moderator',
    name: 'ファシリテータ',
    role: 'Facilitator',
    stance: '中立・合意形成重視',
    personality: '丁寧・俯瞰的',
    avatarPreset: 'user_icon4',
    provider: 'codex',
    model: 'gpt-5.4'
  })
]

function cloneAgents(agents: AgentProfile[]): AgentProfile[] {
  return agents.map((agent, index) => ({
    ...ensureAgentAvatarState(normalizeAgentSelections(agent), index),
    rateLimits: agent.rateLimits
      ? {
          source: agent.rateLimits.source,
          daily: agent.rateLimits.daily ? { ...agent.rateLimits.daily } : null,
          weekly: agent.rateLimits.weekly ? { ...agent.rateLimits.weekly } : null
        }
      : createEmptyRateLimits()
  }))
}

function getDiscussionStyleDefaults(style: DiscussionStyle): {
  agents: AgentProfile[]
  turnLimit: number
  handRaiseMode: HandRaiseMode
} {
  if (style === 'conversation') {
    return {
      agents: cloneAgents(conversationDefaultAgents),
      turnLimit: 3,
      handRaiseMode: 'rule-based'
    }
  }

  return {
    agents: cloneAgents(meetingDefaultAgents),
    turnLimit: 3,
    handRaiseMode: 'ai-evaluation'
  }
}

function getEffectiveHandRaiseMode(
  discussionStyle: DiscussionStyle,
  executionMode: ExecutionMode,
  handRaiseMode: HandRaiseMode
): HandRaiseMode {
  if (discussionStyle === 'meeting' && executionMode === 'orchestration') {
    return 'ai-evaluation'
  }

  return handRaiseMode === 'ai-evaluation' ? 'ai-evaluation' : 'rule-based'
}

const SETTINGS_STORAGE_KEY = 'turtle-brain:settings:v1'

interface PersistedSettingsSnapshot {
  version: 1
  discussionStyle: DiscussionStyle
  executionMode: ExecutionMode
  handRaiseMode: HandRaiseMode
  turnLimit: number
  agents: AgentProfile[]
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function loadPersistedSettings(): PersistedSettingsSnapshot | null {
  if (!canUseLocalStorage()) {
    return null
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSettingsSnapshot>
    if (parsed.version !== 1) {
      return null
    }

    const discussionStyle: DiscussionStyle =
      parsed.discussionStyle === 'meeting' ? 'meeting' : 'conversation'
    const executionMode: ExecutionMode =
      parsed.executionMode === 'autonomous' ? 'autonomous' : 'orchestration'
    const handRaiseMode = getEffectiveHandRaiseMode(
      discussionStyle,
      executionMode,
      parsed.handRaiseMode === 'ai-evaluation' ? 'ai-evaluation' : 'rule-based'
    )
    const turnLimit =
      typeof parsed.turnLimit === 'number' && Number.isFinite(parsed.turnLimit)
        ? Math.max(1, Math.min(12, Math.trunc(parsed.turnLimit)))
        : getDiscussionStyleDefaults(discussionStyle).turnLimit

    const fallbackAgents = getDiscussionStyleDefaults(discussionStyle).agents
    const agents = Array.isArray(parsed.agents) && parsed.agents.length > 0
      ? sanitizeAgents(parsed.agents as AgentProfile[])
      : fallbackAgents

    return {
      version: 1,
      discussionStyle,
      executionMode,
      handRaiseMode,
      turnLimit,
      agents
    }
  } catch {
    return null
  }
}

function writePersistedSettings(snapshot: PersistedSettingsSnapshot): void {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot))
}

function removePersistedSettings(): void {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.removeItem(SETTINGS_STORAGE_KEY)
}

const REQUIRED_BACKEND_FEATURE_MARKER = 'copilot-sdk-bridge-v3'

interface BackendHealthResponse {
  status?: string
  featureMarker?: string
  features?: {
    copilotSdkBridge?: boolean
  }
}

async function ensureCopilotBackendReady(agents: AgentProfile[]): Promise<void> {
  if (!agents.some((agent) => agent.provider === 'copilot')) {
    return
  }

  const health = await apiRequestJson<BackendHealthResponse>('/api/health')
  if (health.features?.copilotSdkBridge === true && health.featureMarker === REQUIRED_BACKEND_FEATURE_MARKER) {
    return
  }

  throw new Error('COPILOT_BACKEND_OUTDATED')
}

function getAgentInteractionErrorMessage(error: unknown, details?: string): string {
  if (details && /COPILOT_BACKEND_OUTDATED/i.test(details)) {
    return 'GitHub Copilot CLI の継続会話には新しいバックエンドが必要です。現在は古い server が 3001 番ポートに残っている可能性があります。server を再起動してください。'
  }

  if (error instanceof Error && /COPILOT_BACKEND_OUTDATED/i.test(error.message)) {
    return 'GitHub Copilot CLI の継続会話には新しいバックエンドが必要です。現在は古い server が 3001 番ポートに残っている可能性があります。server を再起動してください。'
  }

  if (error instanceof Error && /GitHub Copilot SDK runtime is not available/i.test(error.message)) {
    return 'GitHub Copilot SDK が見つからないため、継続会話モードを開始できませんでした。グローバルの Copilot CLI / SDK が見える状態で server を再起動してください。'
  }
  if (details) {
    return `エージェント処理に失敗しました: ${details}`
  }

  if (error instanceof TypeError) {
    return 'バックエンドへ接続できませんでした。サーバーが起動しているか確認してください。'
  }

  if (error instanceof Error && /ENAMETOOLONG/i.test(error.message)) {
    return 'GitHub Copilot CLI の実行が古い引数経路に落ちています。新しい SDK 継続経路が使われていないため、古い server が残っている可能性があります。server を再起動してください。'
  }

  if (error instanceof Error && /ENAMETOOLONG/i.test(error.message)) {
    return 'エージェント処理に失敗しました: CLI の起動引数が長すぎます。Copilot SDK の継続セッション経路が使えていない可能性があります。server を再起動し、それでも続く場合はバックエンドが旧経路のまま動いていないか確認してください。'
  }

  if (error instanceof Error && error.message) {
    if (/ENAMETOOLONG/i.test(error.message)) {
      return 'エージェント処理に失敗しました: CLI の起動引数が長すぎます。Copilot の継続実行経路を調整しているため、サーバー再起動後に新規セッションで再試行してください。'
    }

    return `エージェント処理に失敗しました: ${error.message}`
  }

  return 'エージェント処理で不明なエラーが発生しました。'
}

function sanitizeAgents(agents: AgentProfile[]): AgentProfile[] {
  return agents.map((agent, index) => ({
    ...ensureAgentAvatarState(normalizeAgentSelections(agent), index),
    runtimeSessionId: null,
    rateLimits: agent.rateLimits ?? createEmptyRateLimits(),
    status: 'idle',
    speakCount: 0,
    handRaiseIntensity: 0
  }))
}

function reconcileAgentsWithCatalogs(agents: AgentProfile[], catalogs: ProviderCatalogMap): AgentProfile[] {
  return agents.map((agent, index) => {
    const normalizedAgent = ensureAgentAvatarState(normalizeAgentSelections(agent), index)
    const providerCatalog = catalogs[agent.provider]
    const models = providerCatalog?.models ?? []
    const matchedModel = models.find((model) => model.id === normalizedAgent.model)
    const resolvedModel = matchedModel?.id ?? models[0]?.id ?? normalizedAgent.model
    const supportedReasoning = (matchedModel ?? models[0])?.supportedReasoningEfforts ?? []

    const reasoningEffort =
      supportedReasoning.length === 0
        ? normalizedAgent.reasoningEffort
        : supportedReasoning.includes(normalizedAgent.reasoningEffort)
          ? normalizedAgent.reasoningEffort
          : (matchedModel ?? models[0])?.defaultReasoningEffort ?? supportedReasoning[0] ?? normalizedAgent.reasoningEffort

    return {
      ...normalizedAgent,
      model: resolvedModel,
      reasoningEffort
    }
  })
}

function normalizeCatalog(raw: ProviderCatalog, fallback: ProviderCatalog): ProviderCatalog {
  const models = (raw.models?.length ? raw.models : fallback.models).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    description: model.description,
    supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
    defaultReasoningEffort: model.defaultReasoningEffort ?? null,
    billingMultiplier: model.billingMultiplier ?? null
  }))

  return {
    provider: raw.provider,
    label: raw.label || fallback.label,
    source: raw.source || fallback.source,
    fetchedAt: raw.fetchedAt ?? null,
    available: raw.available ?? true,
    error: raw.error ?? null,
    models
  }
}

let currentTurnAbortController: AbortController | null = null
const persistedSettings = loadPersistedSettings()
const initialDiscussionStyle = persistedSettings?.discussionStyle ?? 'conversation'
const initialExecutionMode = persistedSettings?.executionMode ?? 'orchestration'
const initialHandRaiseMode = getEffectiveHandRaiseMode(
  initialDiscussionStyle,
  initialExecutionMode,
  persistedSettings?.handRaiseMode ?? getDiscussionStyleDefaults(initialDiscussionStyle).handRaiseMode
)

export const useStore = create<TurtleBrainState>((set, get) => ({
  agents: persistedSettings?.agents ?? cloneAgents(conversationDefaultAgents),
  topic: '',
  inputPaths: [],
  turnLimit: persistedSettings?.turnLimit ?? 3,
  currentTurn: 0,
  environment: 'sandbox',
  handRaiseMode: initialHandRaiseMode,
  executionMode: initialExecutionMode,
  discussionStyle: initialDiscussionStyle,
  messages: [],
  sessionStatus: 'idle',
  finalConclusion: null,
  sessionError: null,
  backendSessionId: null,
  sessionRunNonce: 0,
  orchestrationDebug: null,
  providerCatalogs: getDefaultCatalogs(),
  providerCatalogStatus: 'idle',
  providerCatalogError: null,

  setTopic: (topic) => set({ topic }),
  setInputPaths: (inputPaths) => set({ inputPaths }),

  setExecutionMode: (executionMode) =>
    set((state) => ({
      executionMode,
      handRaiseMode: getEffectiveHandRaiseMode(state.discussionStyle, executionMode, state.handRaiseMode),
      messages: [],
      currentTurn: 0,
      finalConclusion: null,
      sessionError: null,
      backendSessionId: null,
      sessionRunNonce: 0,
      orchestrationDebug: null,
      sessionStatus: 'idle'
    })),

  setDiscussionStyle: (discussionStyle) =>
    set((state) => {
      const defaults = getDiscussionStyleDefaults(discussionStyle)

      return {
        discussionStyle,
        ...defaults,
        handRaiseMode: getEffectiveHandRaiseMode(discussionStyle, state.executionMode, defaults.handRaiseMode),
        messages: [],
        currentTurn: 0,
        finalConclusion: null,
        sessionError: null,
        backendSessionId: null,
        sessionRunNonce: 0,
        orchestrationDebug: null,
        sessionStatus: 'idle'
      }
    }),

  setTurnLimit: (turnLimit) => set({ turnLimit }),

  addAgent: (agent) =>
    set((state) => ({
      agents: [
        ...state.agents,
        ensureAgentAvatarState(
          normalizeAgentSelections({ ...agent, rateLimits: agent.rateLimits ?? createEmptyRateLimits() }),
          state.agents.length
        )
      ]
    })),

  updateAgent: (id, updates) =>
    set((state) => ({
      agents: state.agents.map((agent, index) =>
        agent.id === id
          ? ensureAgentAvatarState(normalizeAgentSelections({
              ...agent,
              ...updates,
              rateLimits: updates.rateLimits ?? agent.rateLimits
            }), index)
          : agent
      )
    })),

  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== id)
    })),

  resetAgentsToDefault: () =>
    set((state) => ({
      agents: getDiscussionStyleDefaults(state.discussionStyle).agents
    })),

  resetAgentToDefault: (id) =>
    set((state) => {
      const defaults = getDiscussionStyleDefaults(state.discussionStyle).agents
      const defaultAgent = defaults.find((agent) => agent.id === id)
      if (!defaultAgent) {
        return state
      }

      return {
        agents: state.agents.map((agent) => (agent.id === id ? { ...defaultAgent } : agent))
      }
    }),

  saveSettings: () => {
    const state = get()
    writePersistedSettings({
      version: 1,
      discussionStyle: state.discussionStyle,
      executionMode: state.executionMode,
      handRaiseMode: getEffectiveHandRaiseMode(state.discussionStyle, state.executionMode, state.handRaiseMode),
      turnLimit: state.turnLimit,
      agents: sanitizeAgents(state.agents)
    })
  },

  clearSavedSettings: () => {
    currentTurnAbortController?.abort()
    currentTurnAbortController = null
    removePersistedSettings()

    const defaultStyle: DiscussionStyle = 'conversation'
    const defaults = getDiscussionStyleDefaults(defaultStyle)

    set((state) => ({
      agents: defaults.agents,
      topic: '',
      inputPaths: [],
      turnLimit: defaults.turnLimit,
      currentTurn: 0,
      handRaiseMode: defaults.handRaiseMode,
      executionMode: 'orchestration',
      discussionStyle: defaultStyle,
      messages: [],
      sessionStatus: 'idle',
      finalConclusion: null,
      sessionError: null,
      backendSessionId: null,
      sessionRunNonce: state.sessionRunNonce + 1,
      orchestrationDebug: null
    }))
  },

  refreshProviderCatalogs: async (force = false) => {
    const fallbackCatalogs = getDefaultCatalogs()

    set((state) => ({
      providerCatalogStatus: 'loading',
      providerCatalogError: null,
      providerCatalogs: state.providerCatalogStatus === 'idle' ? fallbackCatalogs : state.providerCatalogs
    }))

    try {
      const data = await apiRequestJson<{
        success?: boolean
        catalogs?: ProviderCatalogMap
        details?: string
        error?: string
      }>(`/api/providers/catalogs${force ? '?refresh=1' : ''}`)

      if (!data?.success || !data?.catalogs) {
        throw new Error(data?.details || data?.error || 'モデル候補を取得できませんでした。')
      }

      const incoming = data.catalogs as ProviderCatalogMap
      const mergedCatalogs: ProviderCatalogMap = {
        codex: normalizeCatalog(incoming.codex ?? fallbackCatalogs.codex, fallbackCatalogs.codex),
        gemini: normalizeCatalog(incoming.gemini ?? fallbackCatalogs.gemini, fallbackCatalogs.gemini),
        copilot: normalizeCatalog(incoming.copilot ?? fallbackCatalogs.copilot, fallbackCatalogs.copilot)
      }

      set({
        providerCatalogs: cloneCatalogs(mergedCatalogs),
        providerCatalogStatus: 'ready',
        providerCatalogError: null
      })
      set((state) => ({
        agents: reconcileAgentsWithCatalogs(state.agents, mergedCatalogs)
      }))
    } catch (error) {
      set((state) => ({
        providerCatalogStatus: 'error',
        providerCatalogError: error instanceof Error ? error.message : String(error),
        providerCatalogs: state.providerCatalogs
      }))
    }
  },

  startSession: (topic, inputPaths = []) =>
    set((state) => ({
      topic: topic.trim(),
      inputPaths,
      sessionStatus: 'running',
      sessionRunNonce: state.sessionRunNonce + 1,
      currentTurn: 1,
      messages: [],
      finalConclusion: null,
      sessionError: null,
      backendSessionId: null,
      orchestrationDebug: null,
      agents: sanitizeAgents(state.agents)
    })),

  stopSession: () => {
    currentTurnAbortController?.abort()
    currentTurnAbortController = null

    const state = get()
    const sessionId = state.backendSessionId

    set((current) => ({
      sessionStatus: 'finished',
      sessionRunNonce: current.sessionRunNonce + 1
    }))

    if (sessionId) {
      void apiRequestJson<{ success?: boolean; stopped?: boolean }>('/api/orchestrator/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      }).catch((error) => {
        console.error('Failed to stop backend session:', error)
      })
    }
  },

  clearSessionError: () => set({ sessionError: null }),

  resetSession: () =>
    set((state) => {
      currentTurnAbortController?.abort()
      currentTurnAbortController = null

      return {
        topic: '',
        inputPaths: [],
        sessionStatus: 'idle',
        messages: [],
        currentTurn: 0,
        finalConclusion: null,
        sessionError: null,
        backendSessionId: null,
        sessionRunNonce: state.sessionRunNonce + 1,
        orchestrationDebug: null,
        agents: sanitizeAgents(state.agents)
      }
    }),

  processNextTurn: async () => {
    const state = get()
    if (state.sessionStatus !== 'running') {
      return
    }

    const runNonce = state.sessionRunNonce
    const controller = new AbortController()
    currentTurnAbortController = controller

    try {
      await ensureCopilotBackendReady(state.agents)

      const data = await apiRequestJson<{
        success?: boolean
        sessionId: string | null
        agents: AgentProfile[]
        messages: Message[]
        currentTurn: number
        sessionStatus: TurtleBrainState['sessionStatus']
        finalConclusion: string | null
        debug: OrchestrationDebug | null
        details?: string
        error?: string
      }>('/api/orchestrator/run-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: state.backendSessionId,
          topic: state.topic,
          inputPaths: state.inputPaths,
          discussionStyle: state.discussionStyle,
          handRaiseMode: getEffectiveHandRaiseMode(state.discussionStyle, state.executionMode, state.handRaiseMode),
          turnLimit: state.turnLimit,
          agents: state.agents
        })
      })

      if (!data.success) {
        throw new Error(data.details || data.error || 'オーケストレーションの実行に失敗しました。')
      }

      const latestState = get()
      if (latestState.sessionRunNonce !== runNonce || latestState.sessionStatus !== 'running') {
        return
      }

      set({
        backendSessionId: data.sessionId,
        agents: data.agents.map((agent, index) => ensureAgentAvatarState(normalizeAgentSelections(agent), index)),
        messages: data.messages,
        currentTurn: data.currentTurn,
        sessionStatus: data.sessionStatus,
        finalConclusion: data.finalConclusion,
        orchestrationDebug: data.debug,
        sessionError: null
      })
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return
      }

      console.error('Agent interaction failed:', error)
      set({
        sessionStatus: 'finished',
        sessionError: getAgentInteractionErrorMessage(error)
      })
    } finally {
      if (currentTurnAbortController === controller) {
        currentTurnAbortController = null
      }
    }
  }
}))
