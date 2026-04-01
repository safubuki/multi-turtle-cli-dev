import type { AgentCliProvider, AgentRole, ReasoningEffort } from '../store/useStore'

export const PROVIDER_LABELS: Record<AgentCliProvider, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  copilot: 'GitHub Copilot CLI'
}

export const ROLE_LABELS: Record<AgentRole, string> = {
  Participant: '参加者',
  Facilitator: 'ファシリテータ'
}

export const STANCE_PRIMARY_OPTIONS = [
  '建設的・共感的',
  '探究的・批判的',
  '中立・バランス',
  '発散・アイデア重視',
  '実務・実装重視',
  '品質・リスク管理',
  'ユーザー価値重視',
  '長期・戦略視点'
] as const

export const PERSONALITY_PRIMARY_OPTIONS = [
  '前向き・協調的',
  '慎重・論理的',
  '高速・実務的',
  '丁寧・堅実',
  '分析的・俯瞰的',
  '率直・情熱的',
  '冷静・寡黙',
  '大胆・直感的'
] as const

export const STANCE_PRESETS = [
  '建設的',
  '批判的',
  '中立',
  'アイデア出し',
  'リスク分析',
  '受容的',
  '同調的',
  '挑戦的',
  'データ重視',
  '実践派',
  'ユーザー目線',
  '長期視点',
  'コスト重視',
  '速度重視',
  '品質重視',
  '新規性重視',
  '保守性重視',
  '運用重視',
  'セキュリティ重視',
  '合意形成重視'
] as const

export const PERSONALITY_PRESETS = [
  '論理的',
  '感情的',
  '協調的',
  '前向き',
  '慎重',
  '大胆',
  '冷静',
  '熱血',
  '分析的',
  '直感的',
  '寡黙',
  '饒舌',
  '皮肉屋',
  '俯瞰的',
  '丁寧',
  '堅実',
  '率直',
  '実務的',
  '主張強め',
  'ユーモラス'
] as const

export const STANCE_PRIMARY_SELECTIONS: Record<(typeof STANCE_PRIMARY_OPTIONS)[number], readonly string[]> = {
  '建設的・共感的': ['建設的', '受容的'],
  '探究的・批判的': ['批判的', 'データ重視'],
  '中立・バランス': ['中立', '合意形成重視'],
  '発散・アイデア重視': ['アイデア出し', '新規性重視'],
  '実務・実装重視': ['実践派', '速度重視'],
  '品質・リスク管理': ['品質重視', 'リスク分析'],
  'ユーザー価値重視': ['ユーザー目線'],
  '長期・戦略視点': ['長期視点']
}

export const PERSONALITY_PRIMARY_SELECTIONS: Record<(typeof PERSONALITY_PRIMARY_OPTIONS)[number], readonly string[]> = {
  '前向き・協調的': ['前向き', '協調的'],
  '慎重・論理的': ['慎重', '論理的'],
  '高速・実務的': ['実務的'],
  '丁寧・堅実': ['丁寧', '堅実'],
  '分析的・俯瞰的': ['分析的', '俯瞰的'],
  '率直・情熱的': ['率直', '熱血'],
  '冷静・寡黙': ['冷静', '寡黙'],
  '大胆・直感的': ['大胆', '直感的']
}

export const STANCE_VALUE_ALIASES: Record<string, readonly string[]> = {
  ...STANCE_PRIMARY_SELECTIONS,
  発散: ['アイデア出し'],
  アイデア重視: ['アイデア出し', '新規性重視'],
  共感的: ['受容的'],
  探究的: ['批判的', 'データ重視'],
  バランス: ['中立', '合意形成重視'],
  実務: ['実践派'],
  実装重視: ['実践派'],
  品質: ['品質重視'],
  リスク管理: ['リスク分析'],
  ユーザー価値: ['ユーザー目線'],
  戦略視点: ['長期視点']
}

export const PERSONALITY_VALUE_ALIASES: Record<string, readonly string[]> = {
  ...PERSONALITY_PRIMARY_SELECTIONS,
  情熱的: ['熱血'],
  高速: ['実務的'],
  共感的: ['協調的']
}

export const REASONING_OPTIONS: Array<{
  value: ReasoningEffort
  label: string
  description: string
}> = [
  { value: 'low', label: 'Low', description: '短めに推論して速度重視' },
  { value: 'medium', label: 'Medium', description: '標準的な推論強度' },
  { value: 'high', label: 'High', description: '深めに考えて妥当性を重視' },
  { value: 'xhigh', label: 'XHigh', description: '最大級の推論で複雑な議題向け' }
]

export function formatAgentRole(role: AgentRole): string {
  return ROLE_LABELS[role]
}

export function formatReasoningEffort(effort: ReasoningEffort): string {
  return REASONING_OPTIONS.find((option) => option.value === effort)?.label ?? effort
}

export function parseSelectableValue(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\s*\/\s*|\s*・\s*|[,+，\n]+/u)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  )
}

export function serializeSelectableValue(values: string[], delimiter = '・'): string {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(delimiter)
}

function expandSelectableAliases(currentValue: string, aliases: Record<string, readonly string[]> = {}): string[] {
  const normalized = currentValue.trim()
  if (!normalized) {
    return []
  }

  const direct = aliases[normalized]
  if (direct) {
    return [...direct]
  }

  return parseSelectableValue(normalized).flatMap((value) => aliases[value] ? [...aliases[value]] : [value])
}

export function normalizeSelectableValue(
  currentValue: string,
  presets: readonly string[],
  aliases: Record<string, readonly string[]> = {}
): string {
  const normalized = currentValue.trim()
  if (!normalized) {
    return ''
  }

  const presetSet = new Set(presets)
  const direct = aliases[normalized]
  if (direct) {
    return serializeSelectableValue([...direct])
  }

  const normalizedParts = parseSelectableValue(normalized).flatMap((value) => {
    if (presetSet.has(value)) {
      return [value]
    }

    const mapped = aliases[value]
    if (mapped) {
      return [...mapped]
    }

    return [value]
  })

  return serializeSelectableValue(normalizedParts)
}

export function toggleSelectableValue(currentValue: string, target: string): string {
  const selections = parseSelectableValue(currentValue)
  if (selections.includes(target)) {
    return serializeSelectableValue(selections.filter((value) => value !== target))
  }
  return serializeSelectableValue([...selections, target])
}

export function appendSelectableValue(currentValue: string, extraValue: string): string {
  return serializeSelectableValue([...parseSelectableValue(currentValue), ...parseSelectableValue(extraValue)])
}

export function setPrimarySelectableValue(
  currentValue: string,
  primaryValue: string,
  aliases: Record<string, readonly string[]> = {}
): string {
  const primaryParts = expandSelectableAliases(primaryValue, aliases)
  const rest = parseSelectableValue(currentValue).filter((value) => !primaryParts.includes(value))
  return serializeSelectableValue([...primaryParts, ...rest])
}

export function getPrimarySelectableValue(
  currentValue: string,
  options: readonly string[],
  aliases: Record<string, readonly string[]> = {}
): string {
  const currentParts = expandSelectableAliases(currentValue, aliases)
  if (currentParts.length === 0) {
    return options[0] ?? ''
  }

  const matched = [...options]
    .sort((left, right) => expandSelectableAliases(right, aliases).length - expandSelectableAliases(left, aliases).length)
    .find((option) => {
      const optionParts = expandSelectableAliases(option, aliases)
      return optionParts.every((part) => currentParts.includes(part))
    })

  return matched ?? options[0] ?? ''
}

export function ensurePrimaryOption(options: readonly string[], currentValue: string): string[] {
  const normalized = currentValue.trim()
  if (!normalized || options.includes(normalized)) {
    return [...options]
  }
  return [normalized, ...options]
}
