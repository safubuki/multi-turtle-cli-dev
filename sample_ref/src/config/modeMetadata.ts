import type { DiscussionStyle, ExecutionMode } from '../store/useStore'

export const EXECUTION_MODE_METADATA: Record<ExecutionMode, {
  label: string
  shortDescription: string
  longDescription: string
  badge?: string
}> = {
  orchestration: {
    label: 'Orchestration モード',
    shortDescription: '進行と選出を制御しながら安定動作させる標準モード',
    longDescription: 'Orchestration モードは現在の標準モードです。オーケストレーターが進行、選出、診断情報の集約を担当します。'
  },
  autonomous: {
    label: 'Autonomous モード',
    shortDescription: '完全自律で議論を進める将来モード',
    longDescription: 'Autonomous モードでは、将来的にエージェント自身が発言順、論点整理、収束判断まで主体的に進めます。現時点では未実装です。',
    badge: '未実装'
  }
}

export const DISCUSSION_STYLE_METADATA: Record<DiscussionStyle, {
  label: string
  shortDescription: string
  longDescription: string
}> = {
  conversation: {
    label: 'Conversation スタイル',
    shortDescription: '2人で交互に聞き合いながら対話する',
    longDescription: 'Conversation スタイルでは2名が交互に応答します。挙手判定やファシリテーターは使わず、相手の発言を受けて会話を深める設定です。'
  },
  meeting: {
    label: 'Meeting スタイル',
    shortDescription: '挙手・進行役・性格差が効く会議向け',
    longDescription: 'Meeting スタイルでは複数エージェントが会議形式で議論します。挙手判定、進行役、スタンスや性格による振る舞いの違いを活かす設定です。'
  }
}