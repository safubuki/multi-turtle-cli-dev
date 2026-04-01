# Turtle Brain 実装計画書

更新日: 2026-03-13

## 1. 目的

本計画書は、現時点の Turtle Brain の到達点、未実装機能、改善課題、今後の実装順序を整理するためのドキュメントです。

特に以下を明確にします。

- いま何が動いているか
- 何が未実装か
- 何を先に安定化すべきか
- Autonomous モードをどう段階的に実装するか
- UX / 会議サマリ / 内部状態可視化をどう改善するか

## 2. 現在の到達点

### 2.1 実装済みの主要機能

- React + Vite フロントエンドと Express + TypeScript バックエンドの基本構成
- 複数エージェント設定 UI
- エージェント個別リセット、全体リセット
- 実行モードとディスカッションスタイルの分離
  - Orchestration モード
  - Autonomous モードは未実装表示のみ
  - Conversation スタイル
  - Meeting スタイル
- 各エージェントの semi-resident sessionId 継続
- サーバ側オーケストレータによるターン制御
- Meeting 開始時のファシリテーター初手発言
- 内部状態パネル
  - dispatch reason
  - facilitator reasoning
  - score worker / moderation worker / speech worker
  - session / mailbox 情報
- Markdown ダウンロード
  - 総括
  - 各エージェントの発言ダイジェスト
  - 各エージェントの詳細発言
  - 時系列ログ

### 2.2 現在の中心ファイル

- [src/App.tsx](src/App.tsx)
- [src/store/useStore.ts](src/store/useStore.ts)
- [src/components/SettingsModal.tsx](src/components/SettingsModal.tsx)
- [src/config/modeMetadata.ts](src/config/modeMetadata.ts)
- [server/index.ts](server/index.ts)
- [server/orchestrator.ts](server/orchestrator.ts)

## 3. 現状の課題整理

### 3.1 プロダクト設計上の未完了項目

- Autonomous モードが UI 表示のみで、実処理が未実装
- 実行モードごとの責務定義がまだ仕様書レベルでは固まっていない
- Conversation スタイルと Meeting スタイルの差分が主に orchestration 側に埋め込まれている
- サマリ生成が自由文ベースで、構造化 JSON ではないため表示安定性に限界がある

### 3.2 UX 上の改善余地

- 発言参照リンクはヒューリスティックであり、誤検出・取りこぼしがある
- カラム UI の情報量が増えてきており、密度管理が必要
- 内部状態パネルは可視化されたが、初心者にはまだ読み解きづらい
- 最終結論の重要度と補足の区別が弱い

### 3.3 技術的負債・安定性課題

- backend 起動周りは安定化余地あり
  - コンテキスト上では `npm run dev` / `npm --prefix server run dev` / `npx ts-node index.ts` が失敗した履歴がある
- orchestrator の状態はサーバメモリ上のみで、再起動に弱い
- structured summary / structured debug の schema が未確立
- 自動テストが十分ではない

## 4. 実装方針

今後は以下の優先順位で進める。

1. 安定化
2. 仕様の明文化
3. Autonomous モードの最小実装
4. サマリと議事録の構造化
5. 詳細可視化と分析機能の強化

理由:

- まず基盤が不安定な状態で Autonomous を足すとデバッグ不能になる
- 次に UI をいくら磨いても、出力構造が曖昧だと限界がある
- そのため、先に安定化と構造化を進め、その上で新モードを追加する

## 5. フェーズ別計画

### Phase 0: 仕様固定と現状安定化

目的:

- 今の Orchestration モードを壊さずに土台を固める

作業項目:

- 実行モードとディスカッションスタイルの責務を仕様化
- backend 起動手順の再整理
- `npm run dev` と server 単体起動の失敗原因を再確認
- 主要 API の入出力型をドキュメント化
- `RunTurnRequest` / `RunTurnResponse` の明文化

完了条件:

- 開発者がモード概念を誤解しない
- 起動手順が README と実際の挙動で一致する
- Orchestration モードで build と基本動作確認が安定する

対象候補:

- [README.md](README.md)
- [server/index.ts](server/index.ts)
- [server/orchestrator.ts](server/orchestrator.ts)
- [src/store/useStore.ts](src/store/useStore.ts)

### Phase 1: Orchestration モード改善

目的:

- 現行モードの体験品質を上げる

作業項目:

- 参照リンク検出の改善
- 発話順可視化の改善
- 内部状態パネルの用語整理
- 発言強度の意味説明追加
- Message 単位の metadata 拡張
  - global turn index
  - local turn index
  - kind
  - references

完了条件:

- 発言の前後関係が UI 上で追いやすい
- ファシリテーター発言と参加者発言の差が明確
- 内部状態が初心者にも解釈しやすい

対象候補:

- [src/App.tsx](src/App.tsx)
- [src/store/useStore.ts](src/store/useStore.ts)
- [server/orchestrator.ts](server/orchestrator.ts)

### Phase 2: 議事録・サマリ構造化

目的:

- Markdown 出力と最終結論表示を安定させる

作業項目:

- 最終結論を自由文ではなく JSON 形式で返すように変更
- summary schema を定義
  - overview
  - commonGrounds
  - openIssues
  - actionItems
- 各エージェントの digest も生成ルールを改善
  - 単純切り出しから構造化要約へ移行
- Markdown exporter を schema ベースに再構築

完了条件:

- 「途中で切れたダイジェスト」がなくなる
- 最終結論の表示崩れがなくなる
- Markdown がそのまま議事録として読める品質になる

対象候補:

- [server/orchestrator.ts](server/orchestrator.ts)
- [src/App.tsx](src/App.tsx)

### Phase 3: Autonomous モード最小実装

目的:

- UI 上だけ存在している Autonomous モードを最小限動かす

最小仕様:

- ファシリテーターまたは中央オーケストレータの介入を減らす
- 各エージェントが前回までの会話と inbox をもとに自律判断する
- 停止条件を明示的に持つ
  - 規定ターン到達
  - 収束判定
  - 無限ループ防止ガード

作業項目:

- executionMode に応じたサーバ分岐を追加
- Autonomous runner を追加
- 自律会話の終了条件設計
- 安全策の実装
  - 最大ターン
  - 最大連続自己参照
  - 空応答・重複応答ガード

完了条件:

- Autonomous × Conversation が動作する
- 少なくとも UI 上で mode 切替の意味が実装に反映される

対象候補:

- [server/index.ts](server/index.ts)
- [server/orchestrator.ts](server/orchestrator.ts)
- [src/store/useStore.ts](src/store/useStore.ts)
- [src/components/SettingsModal.tsx](src/components/SettingsModal.tsx)

### Phase 4: Autonomous × Meeting

目的:

- 複数エージェントの完全自律会議を成立させる

作業項目:

- facilitator 依存を減らした自律会議進行の設計
- エージェント間の role negotiation
- 合意形成・収束判定の追加
- 議論発散時の制御
- worker / mailbox の扱いを Autonomous 前提で見直し

完了条件:

- Autonomous × Meeting が破綻せず一定ターン継続する
- 収束または停止の理由が UI に表示される

注意:

- このフェーズは最もリスクが高い
- Phase 0〜3 完了前に手をつけない

### Phase 5: 永続化と再開機能

目的:

- セッション再開と履歴管理を可能にする

作業項目:

- サーバメモリ外へのセッション保存
- セッション一覧
- 再開 UI
- 議事録再表示

候補実装:

- file-based persistence
- SQLite

完了条件:

- サーバ再起動後も会議履歴を参照できる
- 少なくとも最終結論とログが復元できる

### Phase 6: テストと運用整備

目的:

- 継続改修に耐える状態へ持っていく

作業項目:

- orchestrator の単体テスト追加
- summary parser / exporter のテスト追加
- UI の主要表示ロジックのテスト追加
- エラー時のフォールバック動作確認
- 開発用デバッグ手順書の作成

完了条件:

- 主要ロジックがテストで守られる
- 次回改修時のデグレが減る

## 6. 優先度付きバックログ

### 最優先

- Autonomous モード仕様の明文化
- backend 起動安定化
- summary の構造化

### 高優先

- 発言参照リンクの精度改善
- 内部状態パネルの読みやすさ改善
- Markdown 出力の議事録品質向上

### 中優先

- セッション永続化
- Autonomous × Meeting
- JSON schema ベースの UI 表示

### 低優先

- 高度な分析ダッシュボード
- 発言クラスタリング
- モード別のテーマテンプレート

## 7. 推奨する次回着手順

外出後に再開するなら、以下の順が最も安全です。

1. Phase 0 の仕様固定
2. server 起動失敗の整理
3. summary の JSON 化
4. Autonomous × Conversation の最小実装

## 8. 次回セッション開始時の引き継ぎメモ

次回はまず以下を確認する。

- [src/store/useStore.ts](src/store/useStore.ts) の `executionMode` / `discussionStyle`
- [server/orchestrator.ts](server/orchestrator.ts) の `runConversationTurn` / `runMeetingTurn` / `finalizeSession`
- [src/App.tsx](src/App.tsx) の内部状態パネルと Markdown 出力
- 現在 Autonomous モードは UI 表示のみで、サーバ分岐は未実装

## 9. 補足メモ

- いまのプロダクトは「擬似マルチエージェント」ではなく、すでに server-side orchestration まで進んでいる
- ただし完全自律モードはまだ本体未実装で、次の大きな節目になる
- 今後の改善は UI 微修正よりも、構造化出力とモード別アーキテクチャの分離が重要
