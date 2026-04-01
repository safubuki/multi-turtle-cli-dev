import titleIcon from '../assets/title_icon.png'
import userIcon1 from '../assets/user_icon1.jpg'
import userIcon2 from '../assets/user_icon2.jpg'
import userIcon3 from '../assets/user_icon3.jpg'
import userIcon4 from '../assets/user_icon4.jpg'

export type BuiltInAgentIconId = 'user_icon1' | 'user_icon2' | 'user_icon3' | 'user_icon4'

export const TITLE_ICON_SRC = titleIcon

export const BUILT_IN_AGENT_ICON_IDS: readonly BuiltInAgentIconId[] = [
  'user_icon1',
  'user_icon2',
  'user_icon3',
  'user_icon4'
] as const

export const BUILT_IN_AGENT_ICON_LABELS: Record<BuiltInAgentIconId, string> = {
  user_icon1: 'アイコン1',
  user_icon2: 'アイコン2',
  user_icon3: 'アイコン3',
  user_icon4: 'アイコン4'
}

export const BUILT_IN_AGENT_ICON_SOURCES: Record<BuiltInAgentIconId, string> = {
  user_icon1: userIcon1,
  user_icon2: userIcon2,
  user_icon3: userIcon3,
  user_icon4: userIcon4
}

export function getBuiltInAgentIconSrc(iconId: BuiltInAgentIconId | null): string | null {
  return iconId ? BUILT_IN_AGENT_ICON_SOURCES[iconId] : null
}

export function getDefaultBuiltInAgentIcon(index: number): BuiltInAgentIconId {
  return BUILT_IN_AGENT_ICON_IDS[index % BUILT_IN_AGENT_ICON_IDS.length] ?? 'user_icon1'
}

export function getAgentIconLabel(iconId: BuiltInAgentIconId | null, customName: string | null): string {
  if (customName?.trim()) {
    return `カスタム: ${customName.trim()}`
  }

  if (!iconId) {
    return '未選択（標準アイコン）'
  }

  return BUILT_IN_AGENT_ICON_LABELS[iconId]
}
