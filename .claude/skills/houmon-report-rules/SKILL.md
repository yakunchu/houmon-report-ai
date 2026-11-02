---
name: houmon-report-rules
description: 居宅療養管理指導報告書の欄・選択肢・SOAP・要確認ルール。報告書の下書き、プロンプト修正、評価、フォーム実装のときに使う
---

# 居宅療養管理指導報告書のルール（正本は共有）

このスキルは「人・Claude Code・アプリが同じルールを見る」ための入口です。ルール本文はここに複製せず、正本を読みます。

## まず読むもの（この順）
1. `${CLAUDE_PROJECT_DIR}/prompts/report-rules.md` — ルールの正本。各欄の決め方、SOAP の書き方、「要確認」の扱い。アプリのシステムプロンプトもここから生成される
2. `${CLAUDE_PROJECT_DIR}/src/lib/report/schema.ts` — 欄・選択肢・「要確認」を含む Zod スキーマ（Structured Outputs と画面で共用）
3. `${CLAUDE_PROJECT_DIR}/src/lib/report/fields.ts` — 日本語の欄名・並び順（見本＝報告書ソフトの順）・根拠グループ
4. 見本が要るとき: `${CLAUDE_PROJECT_DIR}/fixtures/yamamoto-hanako/`（`transcript.md` 台本、`expected_report.md` 見本、`expected.json` 機械判定用、`profile.json` 基本情報・処方）。すべて架空

## 守る原則
- 選択式の欄は選択肢から 1 つだけ。会話に根拠が無い欄は **「要確認」**（推測で埋めない）。台本に数字が無い項目（例: センノシドの残数）が「要確認」になるのが正しい挙動
- S は本人の言葉をそのまま引用（方言もそのまま）。医療判断・処方変更の決定は書かない（書類の下書き支援）
- 選択肢の正は `CLAUDE.md` の表と `schema.ts`。食い違いを見つけたら直さずに報告する

## ルールを変えるとき（手順）
1. `prompts/report-rules.md` **だけ**を直す（`rules.generated.ts` は生成物。手で編集しない）
2. `npm run gen:prompt` で `src/lib/prompt/rules.generated.ts` を再生成
3. `npm run eval`（API を 1 回呼ぶ。費用が掛かる）で見本との一致を確認
4. `eval-results/history.md` に評価の記録が残る。試行錯誤の跡として、何を直して何が変わったかをコミットメッセージにも書く

## やってはいけないこと
- **見本の文をプロンプトにそのまま丸写ししない**。見本の言い回しをルールに入れると、評価が「覚えた文の再生」になって意味を失い、2 本目の台本で崩れる。書き方の型は一般化して書く
- 実在の患者データを例や評価に使わない（fixtures の架空データのみ）
- ルール本文を `schema.ts` の describe やこのスキルに二重に書かない（正本は 1 か所）
