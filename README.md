# Multi Turtle CLI Dev

Multi Turtle CLI Dev は、複数の CLI エージェントを 1 画面で並行運用するための Web アプリケーションです。

Codex CLI、GitHub Copilot CLI、Gemini CLI をペイン単位で切り替えながら、同じ画面で進行状況を監視できます。単なるターミナル多重化ではなく、会話の継続、共有コンテキスト、停止検知、実行前プレビュー、ローカル / SSH ワークスペース切り替えを UI 側で補助する構成です。

## できること

- 複数ペインで CLI セッションを並行実行
- Codex / Copilot / Gemini の切り替え
- モデル、推論レベル、権限レベルの切り替え
- ローカル workspace と SSH workspace の切り替え
- ペインごとの session 継続と resume
- ペイン間の shared context 添付
- 実行前に、CLI へ渡す情報を構造化プレビュー
- 実行中 / 完了 / 確認待ち / エラーの状態表示
- Live Output、Activity、Conversation の分離表示

## 構成

- フロントエンド: React 19 + Vite + TypeScript
- バックエンド: Express 5 + TypeScript
- 開発時フロントエンド URL: http://localhost:5173
- 開発時 API サーバー URL: http://localhost:3001

フロントエンドは Vite dev server で起動し、/api はバックエンドへプロキシされます。

## 前提条件

このワークスペースを動かすには、少なくとも次が必要です。

- Node.js
- npm
- ルートと server の依存関係インストール

CLI 連携を実際に使う場合は、使いたい CLI を別途インストールしておく必要があります。

- Codex CLI: npm install -g @openai/codex
- Gemini CLI: npm install -g @google/gemini-cli
- GitHub Copilot CLI: npm install -g @github/copilot

補足:

- アプリ自体は起動できますが、各 CLI が未インストールまたは未ログインだと、その provider は実行できません。
- Copilot CLI の一部ツール実行では pwsh が必要になる場合があります。
- Windows では標準モードの Codex が sandbox 制約により OS 制御系タスクで失敗しやすいことがあります。

## セットアップ

ルートディレクトリでフロントエンド依存関係を入れます。

```bash
npm install
```

次に server ディレクトリの依存関係を入れます。

```bash
npm --prefix server install
```

## 最短の実行方法

このアプリを開発用に動かす最短手順は、ルートで次を実行することです。

```bash
npm run dev
```

このコマンドで、以下が同時に起動します。

- フロントエンド: Vite dev server
- バックエンド: Express API server

起動後はブラウザで次を開きます。

http://localhost:5173

## 手動で分けて起動する方法

フロントとバックエンドを別々に見たい場合は、別ターミナルでそれぞれ起動できます。

フロントエンド:

```bash
npm run dev:client
```

バックエンド:

```bash
npm run dev:server
```

## 実行後の基本操作

1. アプリを開く
2. ペインごとに provider を選ぶ
3. workspace を選ぶ
4. 必要なら model / reasoning / approval を調整する
5. プロンプトを入力して Run する

実行前には、どの CLI に何を渡すかを確認できるプレビューが表示されます。

## テストとビルド

フロントエンドのテスト実行:

```bash
npm test
```

フロントエンドのビルド:

```bash
npm run build
```

バックエンドのビルド:

```bash
npm --prefix server run build
```

バックエンドのビルド済み成果物を起動:

```bash
npm --prefix server run start
```

## よくある注意点

### 1. 依存関係をルートだけに入れても server は起動しない

このリポジトリは、ルートと server にそれぞれ package.json があります。
そのため、初回は両方で npm install が必要です。

### 2. UI は開くが CLI 実行が失敗する

主な原因は次です。

- 対象 CLI が未インストール
- 対象 CLI が未ログイン
- 非 Git workspace で git 前提の作業をさせている
- PowerShell 5.1 環境で PowerShell 7 前提のコマンドが混ざっている
- Windows で OS 制御系タスクを Codex 標準モードに流している

### 3. 複数ペインで長く使うと重く感じる

このアプリはストリーム表示量が多いため、ログが大きい状態では描画負荷が上がることがあります。通常の開発確認では、まず 1 から 2 ペインで動作確認すると切り分けしやすくなります。

## 主要ディレクトリ

- src: フロントエンド本体
- src/components: ペイン UI と周辺コンポーネント
- src/lib: 実行、状態管理、workspace 操作、共有コンテキストなどのロジック
- src/test: フロントエンドのテスト
- server/src: API サーバーと CLI 実行制御
- docs: 仕様メモ、設計方針、調査記録

## 現時点で確認できている実行コマンド

開発起動:

```bash
npm run dev
```

フロントエンドのみ:

```bash
npm run dev:client
```

バックエンドのみ:

```bash
npm run dev:server
```

テスト:

```bash
npm test
```

フロントビルド:

```bash
npm run build
```

サーバービルド:

```bash
npm --prefix server run build
```

---

普段の開発では、まず npm install、npm --prefix server install、npm run dev の順で十分です。