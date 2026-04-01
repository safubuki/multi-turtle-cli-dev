import type { SpecSection } from './types.js'

export const specSections: SpecSection[] = [
  {
    title: 'MVP',
    body: 'まずは分割ペイン、CLI切り替え、ローカル/SSHワークスペース、VSCode起動、共有コンテキストを一画面で成立させます。',
    bullets: [
      '生ターミナルではなくコンポーザモードを先に完成させる',
      'CLIごとの差異はバックエンド側で吸収する',
      '状態LEDで停滞と完了をすぐ見分ける'
    ]
  },
  {
    title: 'SSH',
    body: '手元のSSH設定がなくても手入力でホストを指定でき、接続先のCLI有無と候補ワークスペースを取得します。',
    bullets: [
      '~/.ssh/config の Host を候補化',
      'bash と find がある Unix 系ホストを想定',
      'Remote-SSH URI で VSCode を開く'
    ]
  },
  {
    title: '情報連携',
    body: '各ペインの成果を共有コンテキストに昇格させ、別ペインに添付して連携を作ります。',
    bullets: [
      '直近結果を要約して共有',
      '次回プロンプトへ自動で差し込む',
      'CLIセッション継続に依存しすぎない'
    ]
  }
]
