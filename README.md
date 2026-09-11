# SpeakUp! AI英会話

英会話、会話分析、履歴に基づく文法・単語テストをまとめたスマートフォン対応Webアプリです。

## 40人同時利用への対策

- Next.js Edge APIでサーバーレス実行
- 音声認識と読み上げは端末内で処理
- 履歴は各端末に保存し、スプレッドシートへの同時書き込みを廃止
- AIへ送る会話数と出力トークンを制限
- 高速な llama-3.1-8b-instant を標準使用
- 429/5xx時だけ環境変数内の別キーへフェイルオーバー
- サーバー内でsleepせず、14秒でタイムアウト

## ローカル起動

```bash
npm install
cp .env.example .env.local
# .env.localに新しく発行したGroq APIキーを設定
npm run dev
```

## Vercelで公開

1. このGitHubリポジトリをVercelにImport
2. Environment Variablesに `GROQ_API_KEYS` を追加
3. 新しく発行したキーを設定（複数ならカンマ区切り）
4. Deploy

チャット等に貼ったAPIキーはGroq Consoleで無効化し、新しいキーを使用してください。

> Groqの無料枠には組織単位のRPM/TPM/RPD/TPD制限があります。イベント前にGroq ConsoleのLimits画面を確認し、実際の40台で負荷テストしてください。
