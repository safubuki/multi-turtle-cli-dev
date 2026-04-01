import { randomUUID } from 'crypto'
import { loadInputContext } from './contextLoader'
import type {
  AgentCliProvider,
  AgentRateLimits,
  CliExecResult,
  CliRunOptions,
  ReasoningEffort
} from './cliRunner'

export type AgentRole = 'Participant' | 'Facilitator'
export type DiscussionStyle = 'conversation' | 'meeting'
export type HandRaiseMode = 'rule-based' | 'ai-evaluation'
export type AgentAvatarPreset = 'user_icon1' | 'user_icon2' | 'user_icon3' | 'user_icon4'

export interface AgentProfileInput {
  id: string
  name: string
  role: AgentRole
  stance: string
  personality: string
  avatarPreset: AgentAvatarPreset | null
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

export interface MessageRecord {
  id: string
  agentId: string
  content: string
  summary: string
  timestamp: number
}

export interface OrchestratorDebugSnapshot {
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

export interface RunTurnRequest {
  sessionId?: string
  topic: string
  inputPaths?: string[]
  discussionStyle: DiscussionStyle
  handRaiseMode?: HandRaiseMode
  turnLimit: number
  agents: AgentProfileInput[]
}

export interface RunTurnResponse {
  sessionId: string
  agents: AgentProfileInput[]
  messages: MessageRecord[]
  currentTurn: number
  sessionStatus: 'idle' | 'running' | 'finished'
  finalConclusion: string | null
  debug: OrchestratorDebugSnapshot | null
}

interface MailboxItem {
  id: string
  fromAgentId: string
  kind: 'message' | 'facilitator-note' | 'system'
  content: string
  summary: string
  timestamp: number
}

interface RuntimeAgent extends AgentProfileInput {
  inbox: MailboxItem[]
  outbox: MailboxItem[]
}

interface FacilitatorDecision {
  overview: string
  rationale: string
  nextFocus: string
  selectedAgentId: string | null
  selectedAgentIds: string[]
  inviteAgentIds: string[]
  interventionPriority: number
  shouldIntervene: boolean
  parallelDispatch: boolean
  participantScores: Array<{
    agentId: string
    score: number
    confidence: number
    desiredAction: string
    reason: string
  }>
}

interface ScoreDecision {
  agentId: string
  runtimeSessionId: string | null
  score: number
  confidence: number
  desiredAction: string
  reason: string
}

interface MeetingSession {
  id: string
  topic: string
  inputPaths: string[]
  inputContextPrompt: string
  inputContextWarnings: string[]
  discussionStyle: DiscussionStyle
  handRaiseMode: HandRaiseMode
  turnLimit: number
  currentTurn: number
  status: 'idle' | 'running' | 'finished'
  agents: RuntimeAgent[]
  messages: MessageRecord[]
  finalConclusion: string | null
  debug: OrchestratorDebugSnapshot | null
  log: OrchestratorDebugSnapshot['log']
  stopRequested: boolean
}

type CliRunner = (options: CliRunOptions) => Promise<CliExecResult>

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function extractJsonLineRecords(value: string): Record<string, unknown>[] {
  return value
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

function extractAssistantContentFromEventLog(value: string): string | null {
  const records = extractJsonLineRecords(value)
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

function sanitizeMessageContent(value: string): string {
  return (extractAssistantContentFromEventLog(value) ?? value).trim()
}

function summarizeResponse(response: string): string {
  const normalized = sanitizeMessageContent(response).replace(/\s+/g, ' ').trim()
  if (normalized.length <= 80) {
    return normalized
  }

  return `${normalized.slice(0, 80).trim()}...`
}

function buildPromptExcerpt(value: string, maxChars: number): string {
  const normalized = sanitizeMessageContent(value).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }

  return `${normalized.slice(0, maxChars).trim()}...`
}

function getRecentDialogue(session: MeetingSession, limit = 6, excerptChars = 180): string {
  const recentMessages = session.messages.slice(-limit)
  if (recentMessages.length === 0) {
    return 'まだ会話は始まっていません。'
  }

  return recentMessages
    .map((message) => {
      const agent = session.agents.find((entry) => entry.id === message.agentId)
      return `- ${agent?.name ?? message.agentId}: ${buildPromptExcerpt(message.content, excerptChars)}`
    })
    .join('\n')
}

function getLastOtherMessage(session: MeetingSession, speaker: RuntimeAgent, excerptChars = 180): string | null {
  const target = [...session.messages].reverse().find((message) => message.agentId !== speaker.id)
  if (!target) {
    return null
  }

  const agent = session.agents.find((entry) => entry.id === target.agentId)
  return `${agent?.name ?? target.agentId}: ${buildPromptExcerpt(target.content, excerptChars)}`
}

function getInboxPrompt(session: MeetingSession, speaker: RuntimeAgent, limit = 3, excerptChars = 150): string {
  return speaker.inbox
    .slice(-limit)
    .map((item) => {
      const fromAgent = session.agents.find((entry) => entry.id === item.fromAgentId)
      const label = fromAgent?.name ?? item.fromAgentId
      const content = item.kind === 'facilitator-note' ? item.summary : buildPromptExcerpt(item.content, excerptChars)
      return `- ${label}: ${content}`
    })
    .join('\n')
}

function getSelfHistoryPrompt(session: MeetingSession, speaker: RuntimeAgent, limit = 2, excerptChars = 180): string {
  return getSafeSelfHistoryPrompt(session, speaker, limit, excerptChars)
  const ownMessages = session.messages.filter((message) => message.agentId === speaker.id).slice(-limit)
  if (ownMessages.length === 0) {
    return ''
  }

  return ownMessages
    .map((message, index) => {
      const globalOrder = session.messages.findIndex((entry) => entry.id === message.id) + 1
      return `- 直近${index + 1}: 全体${globalOrder}件目 / ${buildPromptExcerpt(message.content, excerptChars)}`
    })
    .join('\n')
}

function getDesiredActionGuidance(desiredAction?: string): string {
  switch (desiredAction) {
    case 'agree':
      return '相手の良い点を認めたうえで、具体的な補足を1つ加えてください。'
    case 'challenge':
      return '相手の前提や見落としを1つだけ丁寧に指摘してください。'
    case 'question':
      return '次に進めるための具体的な質問を1つ入れてください。'
    case 'synthesize':
      return '複数の意見をつなぎ、今の論点を整理してください。'
    case 'implement':
      return '今すぐ試せる具体案や手順を1つ提案してください。'
    default:
      return '直前の発言を受けて、会話が前に進む具体的な返答にしてください。'
  }
}

function cloneAgent(agent: AgentProfileInput): RuntimeAgent {
  return {
    ...agent,
    runtimeSessionId: agent.runtimeSessionId ?? null,
    rateLimits: agent.rateLimits ?? null,
    status: 'idle',
    handRaiseIntensity: 0,
    speakCount: 0,
    inbox: [],
    outbox: []
  }
}

function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

function trimMailbox(items: MailboxItem[], maxItems = 12): MailboxItem[] {
  return items.slice(-maxItems)
}

function getRecentTranscript(session: MeetingSession, limit = 8): string {
  return session.messages
    .slice(-limit)
    .map((message) => {
      const agent = session.agents.find((entry) => entry.id === message.agentId)
      return `${agent?.name ?? message.agentId}: ${summarizeResponse(message.content)}`
    })
    .join(' --- ')
}

function getSharedPromptContext(session: MeetingSession): string {
  const parts = [`テーマ: ${session.topic}`]

  if (session.inputContextPrompt) {
    parts.push(session.inputContextPrompt)
  }

  if (session.inputContextWarnings.length > 0) {
    parts.push(`入力コンテキストの注意:\n${session.inputContextWarnings.join('\n')}`)
  }

  return parts.join('\n\n')
}

function buildReasoningGuidance(reasoningEffort: ReasoningEffort): string {
  switch (reasoningEffort) {
    case 'low':
      return '推論強度は low。簡潔に答えてください。'
    case 'high':
      return '推論強度は high。論点を整理して慎重に答えてください。'
    case 'xhigh':
      return '推論強度は xhigh。十分に比較検討したうえで答えてください。'
    default:
      return '推論強度は medium。簡潔さと妥当性のバランスを取ってください。'
  }
}

function applyResultToAgent(agent: RuntimeAgent, result: CliExecResult): void {
  const sanitizedSessionId =
    result.sessionId && result.sessionId.trim().length > 0 && result.sessionId.trim().length <= 160 && !/[\r\n]/.test(result.sessionId)
      ? result.sessionId.trim()
      : null

  agent.runtimeSessionId = sanitizedSessionId ?? agent.runtimeSessionId
  if (result.rateLimits) {
    agent.rateLimits = result.rateLimits
  }
}

function getSafeRecentDialogue(session: MeetingSession, limit = 6, excerptChars = 180): string {
  const recentMessages = session.messages.slice(-limit)
  if (recentMessages.length === 0) {
    return 'No recent messages yet.'
  }

  return recentMessages
    .map((message) => {
      const agent = session.agents.find((entry) => entry.id === message.agentId)
      return `- ${agent?.name ?? message.agentId}: ${buildPromptExcerpt(message.content, excerptChars)}`
    })
    .join('\n')
}

function getSafeSharedPromptContext(session: MeetingSession): string {
  const parts = [`Topic: ${session.topic}`]

  if (session.inputContextPrompt) {
    parts.push(session.inputContextPrompt)
  }

  if (session.inputContextWarnings.length > 0) {
    parts.push(`Input context warnings:\n${session.inputContextWarnings.join('\n')}`)
  }

  return parts.join('\n\n')
}

function getSafeReasoningGuidance(reasoningEffort: ReasoningEffort): string {
  switch (reasoningEffort) {
    case 'low':
      return 'Reasoning effort is low. Prefer speed and simplicity.'
    case 'high':
      return 'Reasoning effort is high. Think carefully and be precise.'
    case 'xhigh':
      return 'Reasoning effort is xhigh. Use the strongest deliberation before answering.'
    default:
      return 'Reasoning effort is medium. Balance speed and quality.'
  }
}

function getSafeSelfHistoryPrompt(
  session: MeetingSession,
  speaker: RuntimeAgent,
  limit = 2,
  excerptChars = 180
): string {
  const ownMessages = session.messages.filter((message) => message.agentId === speaker.id).slice(-limit)
  if (ownMessages.length === 0) {
    return ''
  }

  return ownMessages
    .map((message, index) => {
      const globalOrder = session.messages.findIndex((entry) => entry.id === message.id) + 1
      return `- Your recent message ${index + 1}: global #${globalOrder} / ${buildPromptExcerpt(message.content, excerptChars)}`
    })
    .join('\n')
}

function getLatestAgentMessage(session: MeetingSession, agentId: string): MessageRecord | null {
  return [...session.messages].reverse().find((message) => message.agentId === agentId) ?? null
}

function getVisibleParticipantState(session: MeetingSession, agent: RuntimeAgent, excerptChars = 120): string {
  const latestMessage = getLatestAgentMessage(session, agent.id)
  const latestSummary = latestMessage
    ? buildPromptExcerpt(latestMessage.content, excerptChars)
    : 'No visible statement yet.'

  return `${agent.name}: speakCount=${agent.speakCount}, handRaise=${agent.handRaiseIntensity}, latest="${latestSummary}"`
}

function getMessagesSinceLastFacilitator(session: MeetingSession, facilitatorId: string): number {
  let count = 0

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].agentId === facilitatorId) {
      return count
    }

    count += 1
  }

  return Number.POSITIVE_INFINITY
}

function getMessagesSinceAgentSpoke(session: MeetingSession, agentId: string): number {
  let count = 0

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].agentId === agentId) {
      return count
    }

    count += 1
  }

  return Number.POSITIVE_INFINITY
}

function countSubstringOccurrences(text: string, needle: string): number {
  if (!needle.trim()) {
    return 0
  }

  let count = 0
  let searchIndex = 0

  while (searchIndex < text.length) {
    const foundAt = text.indexOf(needle, searchIndex)
    if (foundAt === -1) {
      break
    }

    count += 1
    searchIndex = foundAt + needle.length
  }

  return count
}

function getParticipantRecencyPenalty(session: MeetingSession, agentId: string): number {
  const recentParticipantIds = [...session.messages]
    .reverse()
    .filter((message) => {
      const speaker = session.agents.find((agent) => agent.id === message.agentId)
      return speaker?.role === 'Participant'
    })
    .slice(0, 2)
    .map((message) => message.agentId)

  if (recentParticipantIds[0] === agentId) {
    return 28
  }

  if (recentParticipantIds.includes(agentId)) {
    return 14
  }

  return 0
}

function getSpeakCountSpread(participants: RuntimeAgent[]): number {
  if (participants.length === 0) {
    return 0
  }

  const counts = participants.map((agent) => agent.speakCount)
  return Math.max(...counts) - Math.min(...counts)
}

function getQuietParticipantIds(participants: RuntimeAgent[]): string[] {
  if (participants.length === 0) {
    return []
  }

  const minSpeakCount = Math.min(...participants.map((agent) => agent.speakCount))
  return participants.filter((agent) => agent.speakCount === minSpeakCount).map((agent) => agent.id)
}

function getSynthesisCapabilityScore(agent: RuntimeAgent): number {
  const providerBonus: Record<AgentCliProvider, number> = {
    codex: 28,
    copilot: 24,
    gemini: 18
  }
  const model = agent.model.toLowerCase()
  let score = 50 + providerBonus[agent.provider]

  if (model.includes('opus')) score += 28
  else if (model.includes('gpt-5.4')) score += 26
  else if (model.includes('pro')) score += 22
  else if (model.includes('sonnet')) score += 18
  else if (model.includes('gpt-5.3')) score += 18
  else if (model.includes('gpt-5.2')) score += 14
  else if (model.includes('gpt-5.1')) score += 10

  if (model.includes('mini')) score -= 24
  if (model.includes('flash')) score -= 22
  if (model.includes('lite')) score -= 28

  return score
}

function getSafeDesiredActionGuidance(desiredAction?: string): string {
  switch (desiredAction) {
    case 'agree':
      return 'Build on the previous point and add one useful implication.'
    case 'challenge':
      return 'Raise one concrete concern or counterpoint.'
    case 'question':
      return 'Ask one concrete question that helps the discussion move forward.'
    case 'synthesize':
      return 'Synthesize multiple points into one short direction or takeaway.'
    case 'implement':
      return 'Propose one concrete next step, experiment, or decision.'
    default:
      return 'Respond to the latest discussion with one useful, specific contribution.'
  }
}

function getNextConversationSpeaker(session: MeetingSession): RuntimeAgent {
  const participants = session.agents.filter((agent) => agent.role === 'Participant').slice(0, 2)
  if (participants.length === 0) {
    return session.agents[0]
  }

  if (participants.length === 1 || session.messages.length === 0) {
    return [...participants].sort((left, right) => left.speakCount - right.speakCount)[0]
  }

  const lastSpeakerId = session.messages[session.messages.length - 1].agentId
  return participants.find((agent) => agent.id !== lastSpeakerId) ?? participants[0]
}

export class MeetingOrchestrator {
  private readonly sessions = new Map<string, MeetingSession>()

  constructor(private readonly runCli: CliRunner) {}

  async runTurn(input: RunTurnRequest): Promise<RunTurnResponse> {
    const isNewSession = !input.sessionId || !this.sessions.has(input.sessionId)
    const inputPaths = input.inputPaths ?? []
    const loadedContext = isNewSession || input.sessionId === undefined
      ? await loadInputContext(inputPaths)
      : null

    const session = input.sessionId && this.sessions.has(input.sessionId)
      ? this.sessions.get(input.sessionId)!
      : this.createSession(input, loadedContext?.promptBlock ?? '', loadedContext?.warnings ?? [])

    if (!isNewSession && JSON.stringify(session.inputPaths) !== JSON.stringify(inputPaths)) {
      const refreshedContext = await loadInputContext(inputPaths)
      session.inputPaths = [...inputPaths]
      session.inputContextPrompt = refreshedContext.promptBlock
      session.inputContextWarnings = refreshedContext.warnings
    }

    session.handRaiseMode = input.handRaiseMode ?? session.handRaiseMode

    if (session.stopRequested || session.status === 'finished') {
      session.status = 'finished'
      return this.serializeSession(session)
    }

    session.status = 'running'

    const totalTurns = session.turnLimit * Math.max(session.agents.length, 1)
    if (session.currentTurn > totalTurns) {
      await this.finalizeSession(session)
      return this.serializeSession(session)
    }

    if (session.discussionStyle === 'conversation') {
      await this.runConversationTurn(session)
    } else {
      await this.runMeetingTurn(session)
    }

    if (session.stopRequested) {
      session.status = 'finished'
      return this.serializeSession(session)
    }

    session.currentTurn += 1

    if (session.currentTurn > totalTurns) {
      await this.finalizeSession(session)
    }

    return this.serializeSession(session)
  }

  private createSession(input: RunTurnRequest, inputContextPrompt: string, inputContextWarnings: string[]): MeetingSession {
    const id = input.sessionId ?? randomUUID()
    const session: MeetingSession = {
      id,
      topic: input.topic,
      inputPaths: [...(input.inputPaths ?? [])],
      inputContextPrompt,
      inputContextWarnings,
      discussionStyle: input.discussionStyle,
      handRaiseMode: input.handRaiseMode ?? 'ai-evaluation',
      turnLimit: input.turnLimit,
      currentTurn: 1,
      status: 'idle',
      agents: input.agents.map(cloneAgent),
      messages: [],
      finalConclusion: null,
      debug: null,
      log: [],
      stopRequested: false
    }

    this.sessions.set(id, session)
    return session
  }

  private serializeSession(session: MeetingSession): RunTurnResponse {
    return {
      sessionId: session.id,
      agents: session.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        stance: agent.stance,
        personality: agent.personality,
        avatarPreset: agent.avatarPreset,
        avatarCustomDataUrl: agent.avatarCustomDataUrl,
        avatarCustomName: agent.avatarCustomName,
        provider: agent.provider,
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
        runtimeSessionId: agent.runtimeSessionId,
        rateLimits: agent.rateLimits,
        status: agent.status,
        handRaiseIntensity: agent.handRaiseIntensity,
        speakCount: agent.speakCount
      })),
      messages: session.messages,
      currentTurn: session.currentTurn,
      sessionStatus: session.status,
      finalConclusion: session.finalConclusion,
      debug: session.debug
    }
  }

  private async runConversationTurn(session: MeetingSession): Promise<void> {
    const speaker = getNextConversationSpeaker(session)
    const prompt = this.buildConversationPromptV2(session, speaker)
    const startedAt = Date.now()
    const result = await this.runCli({
      provider: speaker.provider,
      model: speaker.model,
      reasoningEffort: speaker.reasoningEffort,
      prompt,
      sessionId: speaker.runtimeSessionId ?? undefined
    })
    const finishedAt = Date.now()

    applyResultToAgent(speaker, result)
    speaker.status = 'idle'
    speaker.speakCount += 1

    const message = this.recordMessage(session, speaker, result.response, 'message')
    this.deliverMessage(session, speaker.id, message)

    session.agents.forEach((agent) => {
      agent.handRaiseIntensity = agent.id === speaker.id ? 100 : 0
    })

    session.debug = {
      sessionId: session.id,
      turn: session.currentTurn,
      selectedSpeakerId: speaker.id,
      dispatchReason: 'Conversation モードのため、直前の発話者と異なる参加者を選択しました。',
      facilitator: null,
      scores: session.agents
        .filter((agent) => agent.role === 'Participant')
        .map((agent) => ({
          agentId: agent.id,
          runtimeSessionId: agent.runtimeSessionId,
          score: agent.id === speaker.id ? 100 : 0,
          confidence: 100,
          desiredAction: agent.id === speaker.id ? 'respond' : 'wait',
          reason: agent.id === speaker.id ? '交互発話ロジックで選択' : '今回は待機'
        })),
      workers: [{
        workerId: `speech:${speaker.id}`,
        kind: 'speech',
        targetAgentId: speaker.id,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt
      }],
      agentSessions: session.agents.map((agent) => ({
        agentId: agent.id,
        runtimeSessionId: agent.runtimeSessionId,
        inboxCount: agent.inbox.length,
        outboxCount: agent.outbox.length
      })),
      log: session.log.slice(-8)
    }
  }

  private async runMeetingTurn(session: MeetingSession): Promise<void> {
    const facilitator = session.agents.find((agent) => agent.role === 'Facilitator') ?? null
    const participants = session.agents.filter((agent) => agent.role === 'Participant')

    if (session.messages.length === 0 && facilitator) {
      const prompt = this.buildMeetingPromptV2(session, facilitator, null, [])
      const startedAt = Date.now()
      const result = await this.runCli({
        provider: facilitator.provider,
        model: facilitator.model,
        reasoningEffort: facilitator.reasoningEffort,
        prompt,
        sessionId: facilitator.runtimeSessionId ?? undefined
      })
      const finishedAt = Date.now()

      applyResultToAgent(facilitator, result)
      facilitator.speakCount += 1
      participants.forEach((agent) => {
        agent.handRaiseIntensity = 0
      })

      const message = this.recordMessage(session, facilitator, result.response, 'moderation')
      this.deliverMessage(session, facilitator.id, message)

      session.debug = {
        sessionId: session.id,
        turn: session.currentTurn,
        selectedSpeakerId: facilitator.id,
        dispatchReason: '会議開始時のため、ファシリテータが最初の論点整理を行いました。',
        facilitator: {
          agentId: facilitator.id,
          runtimeSessionId: facilitator.runtimeSessionId,
          overview: '会議の導入と論点整理',
          rationale: '初手は前提共有を優先',
          nextFocus: '参加者が論点ごとに見解を出す',
          selectedAgentId: null,
          selectedAgentIds: participants.map((agent) => agent.id),
          inviteAgentIds: participants.map((agent) => agent.id),
          interventionPriority: 100,
          shouldIntervene: true,
          parallelDispatch: false
        },
        scores: [],
        workers: [{
          workerId: `speech:${facilitator.id}`,
          kind: 'speech',
          targetAgentId: facilitator.id,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt
        }],
        agentSessions: session.agents.map((agent) => ({
          agentId: agent.id,
          runtimeSessionId: agent.runtimeSessionId,
          inboxCount: agent.inbox.length,
          outboxCount: agent.outbox.length
        })),
        log: session.log.slice(-8)
      }

      return
    }

    const workerRuns: OrchestratorDebugSnapshot['workers'] = []
    const useAiEvaluation = session.handRaiseMode === 'ai-evaluation'
    let facilitatorDecision: FacilitatorDecision | null = null
    let scores: ScoreDecision[] = []

    if (useAiEvaluation && facilitator) {
      const startedAt = Date.now()
      facilitatorDecision = await this.moderateMeetingV2(session, facilitator)
      const finishedAt = Date.now()
      workerRuns.push({
        workerId: `moderation:${facilitator.id}`,
        kind: 'moderation',
        targetAgentId: facilitator.id,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt
      })

      scores = participants.map((agent) => {
        const matched = facilitatorDecision?.participantScores.find((entry) => entry.agentId === agent.id)
        return {
          agentId: agent.id,
          runtimeSessionId: agent.runtimeSessionId,
          score: clamp(matched?.score ?? 40, 0, 100),
          confidence: clamp(matched?.confidence ?? 50, 0, 100),
          desiredAction: matched?.desiredAction ?? 'question',
          reason: matched?.reason ?? 'Fallback score because the facilitator did not return a participant score.'
        }
      })
    } else {
      scores = await Promise.all(
        participants.map(async (agent) => {
          const startedAt = Date.now()
          const score = useAiEvaluation
            ? await this.scoreParticipantV2(session, agent)
            : this.scoreParticipantRuleBased(session, agent)
          const finishedAt = Date.now()
          workerRuns.push({
            workerId: `score:${agent.id}`,
            kind: 'score',
            targetAgentId: agent.id,
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt
          })
          return score
        })
      )
    }

    participants.forEach((agent) => {
      const score = scores.find((entry) => entry.agentId === agent.id)
      agent.handRaiseIntensity = score?.score ?? 0
    })

    if (facilitatorDecision?.inviteAgentIds.length) {
      for (const agentId of facilitatorDecision.inviteAgentIds) {
        const target = session.agents.find((agent) => agent.id === agentId)
        if (!target) {
          continue
        }

        target.inbox = trimMailbox([
          ...target.inbox,
          {
            id: randomUUID(),
            fromAgentId: facilitator?.id ?? 'facilitator',
            kind: 'facilitator-note',
            content: facilitatorDecision.nextFocus,
            summary: `ファシリテータ指示: ${facilitatorDecision.nextFocus}`,
            timestamp: Date.now()
          }
        ])
      }
    }

    const { speakers, dispatchReason } = this.selectSpeakers(session, scores, facilitatorDecision, facilitator)
    const plannedSpeakers = [...speakers]

    const speechRuns = await Promise.all(
      plannedSpeakers.map(async (speaker) => {
        const prompt = this.buildMeetingPromptV2(session, speaker, facilitatorDecision, scores)
        const startedAt = Date.now()
        const result = await this.runCli({
          provider: speaker.provider,
          model: speaker.model,
          reasoningEffort: speaker.reasoningEffort,
          prompt,
          sessionId: speaker.runtimeSessionId ?? undefined
        })
        const finishedAt = Date.now()
        return { speaker, result, startedAt, finishedAt }
      })
    )

    for (const speech of speechRuns) {
      workerRuns.push({
        workerId: `speech:${speech.speaker.id}`,
        kind: 'speech',
        targetAgentId: speech.speaker.id,
        startedAt: speech.startedAt,
        finishedAt: speech.finishedAt,
        durationMs: speech.finishedAt - speech.startedAt
      })
    }

    for (const speech of speechRuns) {
      applyResultToAgent(speech.speaker, speech.result)
      speech.speaker.speakCount += 1
    }

    const newMessages = speechRuns.map((speech) =>
      this.recordMessage(
        session,
        speech.speaker,
        speech.result.response,
        speech.speaker.role === 'Facilitator' ? 'moderation' : 'message'
      )
    )

    for (let index = 0; index < speechRuns.length; index += 1) {
      this.deliverMessage(session, speechRuns[index].speaker.id, newMessages[index])
    }

    session.debug = {
      sessionId: session.id,
      turn: session.currentTurn,
      selectedSpeakerId: speechRuns[0]?.speaker.id ?? null,
      dispatchReason,
      facilitator: facilitator && facilitatorDecision ? {
        agentId: facilitator.id,
        runtimeSessionId: facilitator.runtimeSessionId,
        overview: facilitatorDecision.overview,
        rationale: facilitatorDecision.rationale,
        nextFocus: facilitatorDecision.nextFocus,
        selectedAgentId: facilitatorDecision.selectedAgentId,
        selectedAgentIds: facilitatorDecision.selectedAgentIds,
        inviteAgentIds: facilitatorDecision.inviteAgentIds,
        interventionPriority: facilitatorDecision.interventionPriority,
        shouldIntervene: facilitatorDecision.shouldIntervene,
        parallelDispatch: facilitatorDecision.parallelDispatch
      } : null,
      scores,
      workers: workerRuns,
      agentSessions: session.agents.map((agent) => ({
        agentId: agent.id,
        runtimeSessionId: agent.runtimeSessionId,
        inboxCount: agent.inbox.length,
        outboxCount: agent.outbox.length
      })),
      log: session.log.slice(-8)
    }
  }

  private async finalizeSession(session: MeetingSession): Promise<void> {
    if (session.finalConclusion) {
      session.status = 'finished'
      return
    }

    const synthesizer =
      [...session.agents].sort((left, right) => getSynthesisCapabilityScore(right) - getSynthesisCapabilityScore(left))[0] ??
      session.agents[0]
    const startedAt = Date.now()
    const result = await this.runCli({
      provider: synthesizer.provider,
      model: synthesizer.model,
      reasoningEffort: synthesizer.reasoningEffort,
      prompt: this.buildFinalConclusionPromptV2(session),
      sessionId: synthesizer.runtimeSessionId ?? undefined
    })
    const finishedAt = Date.now()

    applyResultToAgent(synthesizer, result)
    session.finalConclusion = sanitizeMessageContent(result.response)
    session.status = 'finished'
    session.log.push({
      turn: session.currentTurn,
      kind: 'synthesis',
      summary: summarizeResponse(session.finalConclusion),
      timestamp: Date.now()
    })

    session.debug = {
      sessionId: session.id,
      turn: session.currentTurn,
      selectedSpeakerId: null,
      dispatchReason: 'ターン上限に到達したため最終結論を生成しました。',
      facilitator: synthesizer ? {
        agentId: synthesizer.id,
        runtimeSessionId: synthesizer.runtimeSessionId,
        overview: '議論全体の要約',
        rationale: '終了条件に到達したため総括を作成',
        nextFocus: '最終結論の提示',
        selectedAgentId: null,
        selectedAgentIds: [],
        inviteAgentIds: [],
        interventionPriority: 100,
        shouldIntervene: true,
        parallelDispatch: false
      } : null,
      scores: [],
      workers: [{
        workerId: `synthesis:${synthesizer.id}`,
        kind: 'synthesis',
        targetAgentId: synthesizer.id,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt
      }],
      agentSessions: session.agents.map((agent) => ({
        agentId: agent.id,
        runtimeSessionId: agent.runtimeSessionId,
        inboxCount: agent.inbox.length,
        outboxCount: agent.outbox.length
      })),
      log: session.log.slice(-8)
    }
  }

  private buildConversationPrompt(session: MeetingSession, speaker: RuntimeAgent): string {
    const transcript = getRecentDialogue(session, 6, 180)
    const lastOtherMessage = getLastOtherMessage(session, speaker, 180)
    const inboxText = getInboxPrompt(session, speaker, 3, 140)

    const parts = [
      getSharedPromptContext(session),
      `あなたは ${speaker.name} です。立場: ${speaker.stance}。性格: ${speaker.personality}。`,
      buildReasoningGuidance(speaker.reasoningEffort)
    ]

    if (lastOtherMessage) {
      parts.push(`直前に相手が述べた内容:\n${lastOtherMessage}`)
    }

    if (session.messages.length > 0) {
      parts.push(`直近の会話ログ:\n${transcript}`)
    }

    if (inboxText) {
      parts.push(`受信メモ:\n${inboxText}`)
    }

    parts.push('会話として自然につながる短い返答を日本語で返してください。')
    parts.push('必ず直前の誰かの発言に反応し、賛成・懸念・補足・質問のどれかを含めてください。')
    parts.push('一般論だけを独立して述べるのは禁止です。相手の名前や「その点」「今の話」など、会話の受けを明示してください。')
    parts.push('2〜4文で十分です。')
    return parts.join('\n\n')
  }

  private buildConversationPromptV2(session: MeetingSession, speaker: RuntimeAgent): string {
    const transcript = getSafeRecentDialogue(session, 6, 180)
    const lastOtherMessage = getLastOtherMessage(session, speaker, 180)
    const inboxText = getInboxPrompt(session, speaker, 3, 140)
    const selfHistory = getSelfHistoryPrompt(session, speaker, 2, 180)
    const counterpartName =
      session.agents.find((entry) => entry.id !== speaker.id && entry.role === 'Participant')?.name ?? '相手'

    const parts = [
      getSafeSharedPromptContext(session),
      `You are ${speaker.name}. Your stance is "${speaker.stance}". Your personality is "${speaker.personality}".`,
      getSafeReasoningGuidance(speaker.reasoningEffort)
    ]

    if (selfHistory) {
      parts.push(`Your own recent messages:\n${selfHistory}`)
    }

    if (lastOtherMessage) {
      parts.push(`Most recent message from another agent:\n${lastOtherMessage}`)
    }

    if (session.messages.length > 0) {
      parts.push(`Recent dialogue:\n${transcript}`)
    }

    if (inboxText) {
      parts.push(`Messages directly addressed to you:\n${inboxText}`)
    }

    parts.push('Reply in Japanese with one short but concrete conversational turn.')
    parts.push('React to the latest point first, then add one useful agreement, concern, question, or refinement.')
    parts.push('Do not assume hidden roles, departments, stance labels, or personality labels of the other agent. React only to what was actually said in the dialogue.')
    parts.push('Do not invent occupational labels such as planner, designer, engineer, or owner unless those labels were explicitly stated in the dialogue itself.')
    parts.push(`If you refer to another agent, mention the exact agent name such as "${counterpartName}".`)
    parts.push('Use 2 to 4 sentences. Do not output JSON, bullet lists, or stage directions.')
    return parts.join('\n\n')
  }

  stopSession(sessionId?: string): boolean {
    if (!sessionId || !this.sessions.has(sessionId)) {
      return false
    }

    const session = this.sessions.get(sessionId)!
    session.stopRequested = true
    session.status = 'finished'
    return true
  }

  private async runMetaCli(
    provider: AgentCliProvider,
    model: string,
    reasoningEffort: ReasoningEffort,
    prompt: string
  ): Promise<CliExecResult> {
    return this.runCli({
      provider,
      model,
      reasoningEffort,
      prompt
    })
  }

  private async scoreParticipantV2(session: MeetingSession, agent: RuntimeAgent): Promise<ScoreDecision> {
    const transcript = getRecentTranscript(session, 8)
    const inboxText = agent.inbox.slice(-5).map((item) => item.summary).join(' / ')
    const prompt = [
      getSafeSharedPromptContext(session),
      `You are evaluating whether ${agent.name} should speak next.`,
      `Stance: ${agent.stance}`,
      `Personality: ${agent.personality}`,
      getSafeReasoningGuidance(agent.reasoningEffort),
      `Recent transcript: ${transcript || 'No recent discussion yet.'}`,
      inboxText ? `Direct inbox: ${inboxText}` : '',
      'Return JSON only.',
      '{"score":0-100,"confidence":0-100,"desiredAction":"agree|challenge|question|synthesize|implement","reason":"short reason"}'
    ].filter(Boolean).join('\n\n')

    const result = await this.runMetaCli(agent.provider, agent.model, agent.reasoningEffort, prompt)

    const parsed = extractJson<{ score?: number; confidence?: number; desiredAction?: string; reason?: string }>(result.response)
    return {
      agentId: agent.id,
      runtimeSessionId: agent.runtimeSessionId,
      score: clamp(parsed?.score ?? 40, 0, 100),
      confidence: clamp(parsed?.confidence ?? 50, 0, 100),
      desiredAction: parsed?.desiredAction ?? 'question',
      reason: parsed?.reason ?? 'Fallback score because the evaluation response was not structured.'
    }
  }

  private scoreParticipantRuleBased(session: MeetingSession, agent: RuntimeAgent): ScoreDecision {
    const participants = session.agents.filter((entry) => entry.role === 'Participant')
    const quietParticipantIds = new Set(getQuietParticipantIds(participants))
    const latestMessage = session.messages[session.messages.length - 1] ?? null
    const messagesSinceOwnTurn = getMessagesSinceAgentSpoke(session, agent.id)
    const mentionCount =
      latestMessage && latestMessage.agentId !== agent.id ? countSubstringOccurrences(latestMessage.content, agent.name) : 0
    const mentionBonus = Math.min(mentionCount, 2) * 16
    const inboxBonus = Math.min(agent.inbox.length, 3) * 12
    const quietBoost = quietParticipantIds.has(agent.id) ? 14 : 0
    const firstTurnBoost = agent.speakCount === 0 ? 12 : 0
    const staleBoost = Number.isFinite(messagesSinceOwnTurn) ? Math.min(messagesSinceOwnTurn, 4) * 4 : 18
    const recencyPenalty = getParticipantRecencyPenalty(session, agent.id)
    const score = clamp(34 + mentionBonus + inboxBonus + quietBoost + firstTurnBoost + staleBoost - recencyPenalty, 0, 100)

    const desiredAction =
      mentionBonus > 0 || inboxBonus > 0
        ? 'question'
        : quietBoost > 0
          ? 'implement'
          : messagesSinceOwnTurn >= 3
            ? 'synthesize'
            : 'agree'

    const reasons: string[] = []
    if (mentionBonus > 0) {
      reasons.push('最新発言で名指しされた')
    }
    if (inboxBonus > 0) {
      reasons.push('未処理の受信メッセージがある')
    }
    if (quietBoost > 0) {
      reasons.push('発言回数が少なめ')
    }
    if (staleBoost >= 12) {
      reasons.push('しばらく発言していない')
    }
    if (reasons.length === 0) {
      reasons.push('直近の発言順を避けつつ均等化を優先')
    }

    return {
      agentId: agent.id,
      runtimeSessionId: agent.runtimeSessionId,
      score,
      confidence: 72,
      desiredAction,
      reason: reasons.join(' / ')
    }
  }

  private async scoreParticipant(session: MeetingSession, agent: RuntimeAgent): Promise<ScoreDecision> {
    const transcript = getRecentTranscript(session, 8)
    const inboxText = agent.inbox.slice(-5).map((item) => item.summary).join(' / ')
    const prompt = [
      getSharedPromptContext(session),
      `あなたは採点係です。対象エージェントは ${agent.name}。立場: ${agent.stance}。性格: ${agent.personality}。`,
      buildReasoningGuidance(agent.reasoningEffort),
      `直近の議論: ${transcript || 'まだ議論は始まっていません。'}`,
      inboxText ? `受信メモ: ${inboxText}` : '',
      'このエージェントが今ターンに発言すべき強さを JSON のみで返してください。',
      '{"score":0-100,"confidence":0-100,"desiredAction":"agree|challenge|question|synthesize|implement","reason":"短い理由"}'
    ].filter(Boolean).join('\n\n')

    const result = await this.runCli({
      provider: agent.provider,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      prompt,
      sessionId: agent.runtimeSessionId ?? undefined
    })

    applyResultToAgent(agent, result)

    const parsed = extractJson<{ score?: number; confidence?: number; desiredAction?: string; reason?: string }>(result.response)
    return {
      agentId: agent.id,
      runtimeSessionId: agent.runtimeSessionId,
      score: clamp(parsed?.score ?? 40, 0, 100),
      confidence: clamp(parsed?.confidence ?? 50, 0, 100),
      desiredAction: parsed?.desiredAction ?? 'question',
      reason: parsed?.reason ?? '発言必要度の理由が不足していたため既定値を使用'
    }
  }

  private async moderateMeetingV2(session: MeetingSession, facilitator: RuntimeAgent): Promise<FacilitatorDecision> {
    const transcript = getSafeRecentDialogue(session, 8, 180)
    const participants = session.agents.filter((agent) => agent.role === 'Participant')
    const participantState = participants
      .map((agent) => getVisibleParticipantState(session, agent))
      .join(' | ')
    const messagesSinceLastFacilitator = getMessagesSinceLastFacilitator(session, facilitator.id)
    const quietParticipantNames = getQuietParticipantIds(participants)
      .map((agentId) => participants.find((agent) => agent.id === agentId)?.name)
      .filter((name): name is string => Boolean(name))
    const speakCountSpread = getSpeakCountSpread(participants)

    const prompt = [
      getSafeSharedPromptContext(session),
      `You are the facilitator ${facilitator.name}.`,
      getSafeReasoningGuidance(facilitator.reasoningEffort),
      `Messages since your last facilitation turn: ${messagesSinceLastFacilitator === Number.POSITIVE_INFINITY ? 'many / not applicable' : messagesSinceLastFacilitator}`,
      `Speaking spread among participants: ${speakCountSpread}`,
      quietParticipantNames.length > 0 ? `Quieter participants right now: ${quietParticipantNames.join(', ')}` : '',
      `Participant state: ${participantState}`,
      `Recent dialogue:\n${transcript}`,
      'Prefer selecting participants to speak. Your own facilitation turn should be rare and should mainly be used for the opening, for unblocking a stalled discussion, or for synthesizing after several participant turns.',
      'Avoid consecutive facilitator turns whenever possible.',
      'When some participants have spoken much less than others, help rebalance the discussion by inviting the quieter participants by name.',
      'After several participant messages, it is good to briefly summarize direction and then hand off to one or two participants.',
      'Do not infer hidden roles, departments, stance labels, or personality labels of participants. Refer only to agent names and what they have actually said.',
      'Decide who should speak next and whether multiple participants should respond in parallel.',
      'Also score every participant for hand-raise intensity.',
      'Return JSON only.',
      '{"overview":"current state","rationale":"why","nextFocus":"next focus","selectedAgentId":"agent-id or null","selectedAgentIds":["agent-id"],"inviteAgentIds":["agent-id"],"interventionPriority":0-100,"shouldIntervene":true|false,"parallelDispatch":true|false,"participantScores":[{"agentId":"agent-id","score":0-100,"confidence":0-100,"desiredAction":"agree|challenge|question|synthesize|implement","reason":"short reason"}]}'
    ].join('\n\n')

    const result = await this.runMetaCli(facilitator.provider, facilitator.model, facilitator.reasoningEffort, prompt)

    const parsed = extractJson<Partial<FacilitatorDecision>>(result.response)
    const selectedAgentIds = Array.isArray(parsed?.selectedAgentIds) ? parsed.selectedAgentIds.filter(Boolean) : []
    const inviteAgentIds = Array.isArray(parsed?.inviteAgentIds) ? parsed.inviteAgentIds.filter(Boolean) : []
    const participantScores = Array.isArray(parsed?.participantScores)
      ? parsed.participantScores
          .filter((entry): entry is FacilitatorDecision['participantScores'][number] => Boolean(entry && typeof entry === 'object'))
          .map((entry) => ({
            agentId: typeof entry.agentId === 'string' ? entry.agentId : '',
            score: clamp(typeof entry.score === 'number' ? entry.score : 40, 0, 100),
            confidence: clamp(typeof entry.confidence === 'number' ? entry.confidence : 50, 0, 100),
            desiredAction: typeof entry.desiredAction === 'string' ? entry.desiredAction : 'question',
            reason: typeof entry.reason === 'string' ? entry.reason : 'Fallback score because the facilitator did not return a reason.'
          }))
          .filter((entry) => entry.agentId.length > 0)
      : []

    return {
      overview: parsed?.overview ?? 'Current state was not clearly returned.',
      rationale: parsed?.rationale ?? 'No explicit rationale was returned.',
      nextFocus: parsed?.nextFocus ?? 'Ask the next agent to move the discussion forward.',
      selectedAgentId: parsed?.selectedAgentId ?? null,
      selectedAgentIds,
      inviteAgentIds,
      interventionPriority: clamp(parsed?.interventionPriority ?? 40, 0, 100),
      shouldIntervene: Boolean(parsed?.shouldIntervene),
      parallelDispatch: Boolean(parsed?.parallelDispatch) || selectedAgentIds.length > 1,
      participantScores
    }
  }

  private async moderateMeeting(session: MeetingSession, facilitator: RuntimeAgent): Promise<FacilitatorDecision> {
    const transcript = getRecentDialogue(session, 8, 180)
    const participantState = session.agents
      .filter((agent) => agent.role === 'Participant')
      .map((agent) => `${agent.name}: 発言${agent.speakCount}回, stance=${agent.stance}, personality=${agent.personality}`)
      .join(' | ')

    const prompt = [
      getSharedPromptContext(session),
      `あなたは会議のファシリテータ ${facilitator.name} です。`,
      buildReasoningGuidance(facilitator.reasoningEffort),
      `参加者の状態: ${participantState}`,
      `直近の議論:\n${transcript}`,
      '会話が続くように、補完関係や対立関係がある参加者を優先して選んでください。',
      '必要なら複数担当者へ同時に話題を振ってください。',
      '次の JSON のみを返してください。',
      '{"overview":"現状整理","rationale":"判断理由","nextFocus":"次に進める論点","selectedAgentId":"agent-id or null","selectedAgentIds":["agent-id"],"inviteAgentIds":["agent-id"],"interventionPriority":0-100,"shouldIntervene":true|false,"parallelDispatch":true|false}'
    ].join('\n\n')

    const result = await this.runCli({
      provider: facilitator.provider,
      model: facilitator.model,
      reasoningEffort: facilitator.reasoningEffort,
      prompt,
      sessionId: facilitator.runtimeSessionId ?? undefined
    })

    applyResultToAgent(facilitator, result)

    const parsed = extractJson<Partial<FacilitatorDecision>>(result.response)
    const selectedAgentIds = Array.isArray(parsed?.selectedAgentIds) ? parsed!.selectedAgentIds.filter(Boolean) : []
    const inviteAgentIds = Array.isArray(parsed?.inviteAgentIds) ? parsed!.inviteAgentIds.filter(Boolean) : []

    return {
      overview: parsed?.overview ?? '現状整理を取得できませんでした',
      rationale: parsed?.rationale ?? '判断理由を取得できませんでした',
      nextFocus: parsed?.nextFocus ?? '次の論点を明示してください',
      selectedAgentId: parsed?.selectedAgentId ?? null,
      selectedAgentIds,
      inviteAgentIds,
      interventionPriority: clamp(parsed?.interventionPriority ?? 40, 0, 100),
      shouldIntervene: Boolean(parsed?.shouldIntervene),
      parallelDispatch: Boolean(parsed?.parallelDispatch) || selectedAgentIds.length > 1,
      participantScores: []
    }
  }

  private selectSpeakers(
    session: MeetingSession,
    scores: ScoreDecision[],
    facilitatorDecision: FacilitatorDecision | null,
    facilitator: RuntimeAgent | null
  ): { speakers: RuntimeAgent[]; dispatchReason: string } {
    const participants = session.agents.filter((agent) => agent.role === 'Participant')
    const maxSpeakCount = Math.max(...participants.map((agent) => agent.speakCount), 0)
    const speakCountSpread = getSpeakCountSpread(participants)
    const ranked = participants
      .map((agent) => {
        const score = scores.find((entry) => entry.agentId === agent.id)
        const facilitatorBoost =
          facilitatorDecision?.selectedAgentIds.includes(agent.id) || facilitatorDecision?.selectedAgentId === agent.id ? 12 : 0
        const equityBoost = Math.max(0, maxSpeakCount - agent.speakCount) * 8
        const highHandRaiseBoost = (score?.score ?? 0) >= 80 ? 6 : 0
        const recencyPenalty = getParticipantRecencyPenalty(session, agent.id)
        return {
          agent,
          baseScore: score?.score ?? 0,
          adjustedScore: (score?.score ?? 0) + facilitatorBoost + equityBoost + highHandRaiseBoost - recencyPenalty,
          reason: score?.reason ?? '理由なし'
        }
      })
      .sort((left, right) => right.adjustedScore - left.adjustedScore)

    const topParticipantScore = ranked[0]?.adjustedScore ?? 0
    const messagesSinceLastFacilitator =
      facilitator ? getMessagesSinceLastFacilitator(session, facilitator.id) : Number.POSITIVE_INFINITY
    const facilitatorShouldRebalance = speakCountSpread >= 2
    const facilitatorShouldSummarize = messagesSinceLastFacilitator >= 3 && session.messages.length >= Math.max(participants.length, 2)

    if (
      facilitator &&
      facilitatorDecision?.shouldIntervene &&
      messagesSinceLastFacilitator >= 2 &&
      (
        facilitatorDecision.interventionPriority >= topParticipantScore + 12 ||
        (facilitatorShouldRebalance && facilitatorDecision.interventionPriority >= topParticipantScore - 4) ||
        (facilitatorShouldSummarize && facilitatorDecision.interventionPriority >= topParticipantScore)
      )
    ) {
      return {
        speakers: [facilitator],
        dispatchReason: `ファシリテータ介入を優先: ${facilitatorDecision.rationale}`
      }
    }

    const explicitlySelectedIds = facilitatorDecision?.selectedAgentIds.filter((id) =>
      participants.some((agent) => agent.id === id)
    ) ?? []

    const fallbackSelectedIds = facilitatorDecision?.selectedAgentId
      ? [facilitatorDecision.selectedAgentId].filter((id) => participants.some((agent) => agent.id === id))
      : []

    const parallelIds = facilitatorDecision?.parallelDispatch
      ? (explicitlySelectedIds.length > 0
          ? explicitlySelectedIds
          : facilitatorDecision?.inviteAgentIds.filter((id) => participants.some((agent) => agent.id === id)) ?? [])
      : []

    const selectedIds = explicitlySelectedIds.length > 0
      ? explicitlySelectedIds
      : parallelIds.length > 1
        ? parallelIds
        : fallbackSelectedIds.length > 0
          ? fallbackSelectedIds
          : ranked.slice(0, 1).map((entry) => entry.agent.id)

    const speakers = selectedIds
      .map((agentId) => participants.find((agent) => agent.id === agentId) ?? null)
      .filter((agent): agent is RuntimeAgent => agent !== null)

    if (speakers.length === 0) {
      return {
        speakers: ranked.length > 0 ? [ranked[0].agent] : [session.agents[0]],
        dispatchReason: '候補が空だったため最高スコアの参加者を選択しました。'
      }
    }

    if (speakers.length > 1) {
      const speakerNames = speakers.map((agent) => agent.name).join(', ')
      return {
        speakers,
        dispatchReason: `ファシリテータが複数担当者へ同時依頼: ${speakerNames}`
      }
    }

    const topReason = ranked[0]
      ? `${ranked[0].agent.name} を選択。score=${ranked[0].adjustedScore} (${ranked[0].reason})`
      : '候補情報なし'

    return {
      speakers,
      dispatchReason: topReason
    }
  }

  private buildMeetingPromptV2(
    session: MeetingSession,
    speaker: RuntimeAgent,
    facilitatorDecision: FacilitatorDecision | null,
    scores: ScoreDecision[]
  ): string {
    const transcript = getSafeRecentDialogue(session, 8, 180)
    const lastOtherMessage = getLastOtherMessage(session, speaker, 180)
    const inboxText = getInboxPrompt(session, speaker, 4, 140)
    const selfHistory = getSelfHistoryPrompt(session, speaker, 2, 180)

    if (speaker.role === 'Facilitator') {
      return [
        getSafeSharedPromptContext(session),
        `You are the facilitator ${speaker.name}.`,
        getSafeReasoningGuidance(speaker.reasoningEffort),
        `Current overview: ${facilitatorDecision?.overview ?? 'No prior overview.'}`,
        `Next focus: ${facilitatorDecision?.nextFocus ?? 'Move the discussion to the next useful point.'}`,
        selfHistory ? `Your own recent messages:\n${selfHistory}` : '',
        `Recent dialogue:\n${transcript}`,
        'Reply in Japanese with one short facilitation turn.',
        'Base your facilitation only on the actual visible dialogue. Do not assume hidden roles, departments, stance labels, or personality labels of participants.',
        'Do not invent occupational labels such as planner, designer, engineer, or owner unless those labels were explicitly stated in the dialogue itself.',
        'Summarize the current state, point to one or two concrete next angles, and explicitly invite the relevant participant names when useful.',
        'Prefer broad prompts or targeted follow-up based on what they actually said. Avoid speaking again immediately after your own previous facilitation turn unless the discussion is stalled.',
        'Use 2 to 4 sentences. Do not output JSON or bullet lists.'
      ].filter(Boolean).join('\n\n')
    }

    const scoreInfo = scores.find((entry) => entry.agentId === speaker.id)
    return [
      getSafeSharedPromptContext(session),
      `You are ${speaker.name}. Your stance is "${speaker.stance}". Your personality is "${speaker.personality}".`,
      getSafeReasoningGuidance(speaker.reasoningEffort),
      selfHistory ? `Your own recent messages:\n${selfHistory}` : '',
      lastOtherMessage ? `Most recent message from another agent:\n${lastOtherMessage}` : '',
      `Recent dialogue:\n${transcript}`,
      facilitatorDecision ? `Facilitator overview: ${facilitatorDecision.overview}\nNext focus: ${facilitatorDecision.nextFocus}` : '',
      inboxText ? `Messages directly addressed to you:\n${inboxText}` : '',
      scoreInfo
        ? `Desired action: ${scoreInfo.desiredAction}\nScoring reason: ${scoreInfo.reason}\nGuidance: ${getSafeDesiredActionGuidance(scoreInfo.desiredAction)}`
        : '',
      'Reply in Japanese with one short conversational turn for the meeting.',
      'React to a specific prior point, mention the target agent name explicitly when responding to someone, and add one concrete refinement, concern, question, or synthesis.',
      'Do not assume hidden roles, departments, stance labels, or personality labels of the other agents. React only to what they actually said.',
      'Do not invent occupational labels such as planner, designer, engineer, or owner unless those labels were explicitly stated in the dialogue itself.',
      'Use 2 to 4 sentences. Do not output JSON or bullet lists.'
    ].filter(Boolean).join('\n\n')
  }

  private buildFinalConclusionPromptV2(session: MeetingSession): string {
    const transcript = getRecentTranscript(session, 20)
    return [
      getSafeSharedPromptContext(session),
      'Summarize the discussion in Japanese.',
      'Create exactly five numbered sections with these titles:',
      '1. 結論サマリー',
      '2. 詳細な解説',
      '3. 共通認識',
      '4. 残課題',
      '5. 次のアクション',
      'In section 2, explain the reasoning path, key tradeoffs, and why the conclusion was reached in more detail than section 1.',
      'Write each section as plain paragraphs, not bullets unless necessary.',
      `Discussion log: ${transcript}`
    ].join('\n\n')
  }

  private buildMeetingPrompt(
    session: MeetingSession,
    speaker: RuntimeAgent,
    facilitatorDecision: FacilitatorDecision | null,
    scores: ScoreDecision[]
  ): string {
    const transcript = getRecentDialogue(session, 8, 180)
    const lastOtherMessage = getLastOtherMessage(session, speaker, 180)
    const inboxText = getInboxPrompt(session, speaker, 4, 140)

    if (speaker.role === 'Facilitator') {
      return [
        getSharedPromptContext(session),
        `あなたはファシリテータ ${speaker.name} です。`,
        buildReasoningGuidance(speaker.reasoningEffort),
        `現在の整理: ${facilitatorDecision?.overview ?? '未整理'}`,
        `次の焦点: ${facilitatorDecision?.nextFocus ?? '論点を再整理してください'}`,
        `直近の議論:\n${transcript}`,
        '直前の流れを受けた短い進行発話を日本語で返してください。',
        '誰のどの発言を受けた進行なのかが伝わるようにしてください。1〜3文で十分です。'
      ].join('\n\n')
    }

    const scoreInfo = scores.find((entry) => entry.agentId === speaker.id)
    return [
      getSharedPromptContext(session),
      `あなたは ${speaker.name} です。立場: ${speaker.stance}。性格: ${speaker.personality}。`,
      buildReasoningGuidance(speaker.reasoningEffort),
      lastOtherMessage ? `直前の他者発言:\n${lastOtherMessage}` : '',
      `直近の議論:\n${transcript}`,
      facilitatorDecision ? `ファシリテータ整理: ${facilitatorDecision.overview}\n次の焦点: ${facilitatorDecision.nextFocus}` : '',
      inboxText ? `受信メモ:\n${inboxText}` : '',
      scoreInfo
        ? `期待される行動: ${scoreInfo.desiredAction} / 理由: ${scoreInfo.reason}\n補足指示: ${getDesiredActionGuidance(scoreInfo.desiredAction)}`
        : '',
      '会議の流れに自然につながる一発言を日本語で返してください。'
        + ' 必ず直前の発言かファシリテータの整理に反応してください。独白は禁止です。'
        + ' 相手の名前や「その懸念」「今の提案」などの受けを入れてください。2〜4文で十分です。'
    ].filter(Boolean).join('\n\n')
  }

  private recordMessage(
    session: MeetingSession,
    speaker: RuntimeAgent,
    content: string,
    kind: 'message' | 'moderation'
  ): MessageRecord {
    const sanitizedContent = sanitizeMessageContent(content)
    const message: MessageRecord = {
      id: `msg-${Date.now()}-${randomUUID().slice(0, 6)}`,
      agentId: speaker.id,
      content: sanitizedContent,
      summary: summarizeResponse(sanitizedContent),
      timestamp: Date.now()
    }

    session.messages.push(message)
    session.log.push({
      turn: session.currentTurn,
      kind,
      summary: message.summary,
      timestamp: message.timestamp
    })

    return message
  }

  private deliverMessage(session: MeetingSession, speakerId: string, message: MessageRecord): void {
    session.agents.forEach((agent) => {
      const envelope: MailboxItem = {
        id: randomUUID(),
        fromAgentId: speakerId,
        kind: 'message',
        content: message.content,
        summary: message.summary,
        timestamp: message.timestamp
      }

      if (agent.id === speakerId) {
        agent.outbox = trimMailbox([...agent.outbox, envelope])
      } else {
        agent.inbox = trimMailbox([...agent.inbox, envelope])
      }
    })
  }
}
