# 音声テキスト化アプリ

Google Gemini APIを使用して音声ファイルをテキストに変換するNext.jsアプリケーションです。

## 機能

- 音声ファイル（MP3、M4A、WAV、FLAC、OGG、WebM）のアップロード
- 最大100MBのファイルサイズ対応
- Google Gemini AIによる高精度な音声認識
- テキスト結果のコピー・ダウンロード機能
- レスポンシブデザイン

## 必要な環境変数

`.env.local`ファイルを作成し、以下の環境変数を設定してください：

```
GEMINI_API_KEY=your-gemini-api-key-here
```

## セットアップ

1. 依存関係のインストール：
```bash
npm install
```

2. 開発サーバーの起動：
```bash
npm run dev
```

3. ブラウザで `http://localhost:3000` を開く

## Vercelデプロイ

### 方法1: Vercel CLI

1. Vercel CLIをインストール：
```bash
npm i -g vercel
```

2. プロジェクトをデプロイ：
```bash
vercel
```

3. 環境変数の設定：
```bash
vercel env add GEMINI_API_KEY
```

### 方法2: GitHub連携

1. GitHubにリポジトリをプッシュ
2. [Vercel](https://vercel.com)にログイン
3. 「New Project」でGitHubリポジトリを選択
4. 環境変数設定で `GEMINI_API_KEY` を追加
5. デプロイ完了

### 環境変数の取得

Google AI Studioでアカウントを作成し、APIキーを取得してください：
https://aistudio.google.com/app/apikey

## 対応ファイル形式

- MP3 (.mp3)
- M4A (.m4a)
- WAV (.wav)
- FLAC (.flac)
- OGG (.ogg)
- WebM (.webm)

## 制限事項

- 最大ファイルサイズ: 100MB
- 処理時間制限: 5分
- Gemini APIの利用制限に依存