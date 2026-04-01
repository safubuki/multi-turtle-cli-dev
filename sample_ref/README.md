# Turtle Brain

Turtle Brain は、会話の進行役だけを共通化し、応答は Codex・Gemini・Copilot CLIへ振り分けるので、同じ操作感のまま複数AIサービスを横断して比べながら議論でき、それぞれの得意分野や返答の違いがつかみやすい、初心者にも直感的で気軽な会話アプリです。

## 主な機能

- Conversation モード: 2 人のエージェントが交互に対話するモード
- Meeting モード: 参加者、ファシリテーター、オーケストレーターが会議形式で議論を進めるモード
- 半常駐型エージェント: 各エージェントが専用の sessionId を持ち、会話文脈を継続
- Diagnostics 表示: sessionId、ファシリテーター判断、worker 実行、mailbox 状態を控えめに可視化
- Markdown エクスポート: 議論ログと最終結論を MD で保存

## セットアップ

前提:

- Node.js 18 以上
- npm
- Codex CLI が利用可能であること

依存関係をインストールします。

```powershell
cd c:\git_home\turtle-brain
npm install

cd server
npm install
```

## 使い方

ルートで以下を実行すると、フロントエンドとバックエンドが同時に起動します。

```powershell
cd c:\git_home\turtle-brain
npm run dev
```

通常の待受ポート:

- フロントエンド: http://localhost:5173
- バックエンド: http://localhost:3001

もし 5173 が使用中なら、Vite は 5174 以降の空きポートで起動します。

### 基本操作

1. アプリを開く
2. 設定・エージェント管理でモードやエージェント構成を調整する
3. テーマを入力して議論開始を押す
4. 必要に応じてサイドバーの Diagnostics で内部状態を確認する
5. 最終結論や議論ログを Markdown で保存する

## 開発コマンド

```powershell
npm run dev
npm run build
```

server 側だけ起動したい場合:

```powershell
cd c:\git_home\turtle-brain
npm --prefix server run dev
```

## ライセンス

このプロジェクトは GNU General Public License v3.0 で提供されます。

詳細は [LICENSE](LICENSE) を参照してください。
