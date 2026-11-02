# 在宅レポAI（仮） 実装計画 v1

作成: 2026-11-02（ハッカソン初日） / 締切: 2026-11-08（日）20:00
対象: `CLAUDE.md` の要件を、6日間で「毎日動く状態」を保ちながら実装するための計画。
この文書はコードではなく設計と段取り。確認済みの事実と、未確認の事項を分けて書く。

---

## 0. 結論（1画面まとめ）

- **形**: Next.js（App Router / TypeScript）の1本のWebアプリ。スマホとPCの両方でブラウザから使う。DBなし。
- **個人情報の境界**: 氏名・住所・生年月日などの置き換え（マスク）と、確定後の復元は**すべてブラウザ内**で行う。サーバー（自分の API ルート）と Claude API には**マスク済みテキストだけ**を送る。元の名前と対応表は端末の localStorage に置き、外に出さない。
- **Claude API**: `claude-opus-5-5` を既定にし、**Structured Outputs**（`output_config.format` に JSON Schema）で報告書の全欄を一度に下書きする。選択式の欄は enum に **「要確認」** を含めて「推測で埋めない」をスキーマで強制する。各グループに「根拠（会話からの引用）」を付け、画面で引用の実在をチェックする。
- **Claude Code の機能**: Skills（報告書ルールの正本）、サブエージェント（個人情報監査・評価の読み解き）、フック（APIキー・実データ・`.env` のコミット防止）を使う。MCP は目的に合うものが現時点でないため**使わない判断を説明する**。
- **合格ライン**: 架空患者「山本花子さん」の台本から、見本と同じ選択・備考・SOAP が出ること。これを `npm run eval` で機械的に確認できるようにする。
- **音声入力**: 第1段階はテキスト貼り付け（OSのキーボード音声入力でも可）。第2段階（時間があれば）は**端末内処理（`processLocally`）の Web Speech API のみ**。サーバー送信型の音声認識は個人情報が生の音声で外部に出るため使わない。

---

## 1. 確認済みの事実（一次情報）と前提

| 項目 | 確認した内容 | 出典 |
|---|---|---|
| ハッカソン期間 | 公式ページ: 11月2日(月)12:00〜11月10日(火)14:00（JST）。完全オンライン、250名選考、チーム2名まで | [cerebralvalley.ai/e/built-with-claude-japan2026](https://cerebralvalley.ai/e/built-with-claude-japan2026) |
| 開発期間 | 参加者の記録では、同意書に「November 2 to 8, 2026」と記載（二次情報） | [参加記録](https://tech.gadget-kazuki.com/p/built-with-claude-japan-2026) |
| 審査基準・提出物 | 公式ページに**未掲載**（審査員は「近日発表」）。提出先は Cerebral Valley のポータル、GitHub URL が必要（二次情報） | 同上 |
| 参加特典 | 参加者1名につき Max 5x プラン ＋ $500 の Claude API クレジット | 公式ページ、[Techno Edge](https://www.techno-edge.net/article/2026/10/14/5584.html) |
| モデルと料金 | Opus 5.5: 入力 $4 / 出力 $20、Sonnet 5.5: $2 / $10、Haiku 5.5: $0.10 / $0.50（10万トークン以下）。キャッシュ読み取りは Opus/Sonnet 5.5 で入力の 0.05 倍。Batch は 50% 引き（$/MTok） | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| 入力の種類 | 現行モデルは「text and image input, text output」。**音声入力の記載なし** → 音声は別の手段で文字にしてから渡す | [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Structured Outputs | 対応モデルに Opus 5.5 / Sonnet 5.5 / Haiku 5.5 を含む。`enum`（文字列・数値・真偽・null）、`required`、`additionalProperties: false` 必須。**制限**: 任意（required に無い）パラメータ合計 24 まで、union 型（`anyOf` / `["string","null"]`）合計 16 まで、超えると 400。Citations と併用不可。初回はスキーマのコンパイル待ちあり（24時間キャッシュ）。enum の大文字小文字は保証されない | [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| 思考・effort | Opus 5.5 は thinking を無効化できない（adaptive 固定）。effort の既定は `medium`。`tool_choice` の `any` / `tool` 強制は 400 → JSON を取るなら Structured Outputs を使う | 同上 + claude-api スキル |
| プロンプトキャッシュ | 最小 512 トークン（Opus 5.5 / Sonnet 5.5 / Haiku 5.5）。TTL 既定 5 分、1 時間は書き込み 2 倍。effort や thinking 設定の変更でメッセージ部のキャッシュが無効化 | [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| API のデータ保持 | API の入力・出力はバックエンドで**30日以内に削除**（2026-07-01 更新）。商用条件（API 含む）ではモデル学習に使わない | [privacy.claude.com](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data)、[code.claude.com data-usage](https://code.claude.com/docs/en/data-usage) |
| ブラウザ音声認識 | Web Speech API は既定で**サーバー側の認識エンジンに音声を送る**。`processLocally = true` で端末内処理を強制でき、`SpeechRecognition.available({langs, processLocally})` が `available` / `downloadable` / `downloading` / `unavailable` を返す。未対応なら `language-not-supported` エラー。実験的機能 | [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)、[MDN Using the Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API) |
| Claude Code Skills | `.claude/skills/<name>/SKILL.md`。frontmatter: `name` `description` `disable-model-invocation` `user-invocable` `allowed-tools` `context: fork` `agent` など。`!`cmd`` で実行結果を埋め込める | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) |
| Claude Code サブエージェント | `.claude/agents/<name>.md`。`name` `description` 必須、`tools` `model`（sonnet/opus/haiku/inherit）`effort` `maxTurns` `skills` など。独立したコンテキストで動き、要約だけが戻る | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Claude Code フック | `.claude/settings.json` の `hooks`。`PreToolUse` で `matcher: "Bash"`、`if: "Bash(git commit *)"`、`type: "command"`。**終了コード 2 でブロック**し stderr が理由として Claude に渡る。`onFailure: "block"` は v2.1.295 以降 | [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) |
| ローカル環境 | Node v24.14.1 / npm 11.11.0 / git 2.53 / gh ログイン済（yakunchu）/ Claude Code 2.1.309 / gitleaks 未導入 | このPCで確認 |

**社長の契約リソース**（`KING_BISON_利用可能リソース一覧.md` 2026-10-09 版）: Max 20x、Max 付帯の月次 API クレジット $200（請求サイクルで失効、API キー経由で利用可）、購入クレジット残高 $5.00。**ハッカソン特典の $500 クレジットは同文書に記載がなく「不明」** → §11 で確認。

---

## 2. 全体アーキテクチャ

```
[スマホ / PC のブラウザ]                         [Next.js サーバー (API ルート)]        [Claude API]
 1. 会話テキスト入力（貼り付け / OS音声入力）
 2. 訪問先メモ（氏名・住所・生年月日…）を登録 ── localStorage（端末内のみ）
 3. マスク処理（辞書置換 + 正規表現）─ 端末内
 4. マスク結果の確認画面（置換箇所をハイライト）
 5. 「下書きを作る」 ── マスク済みテキスト + 宛先 ──▶ POST /api/draft
                                                       ・ANTHROPIC_API_KEY は .env（サーバーのみ）
                                                       ・本文はログに残さない、保存しない
                                                       ・system = 報告書ルール（キャッシュ対象）
                                                       ・output_config.format = 報告書スキーマ ──▶ messages.parse
                                              ◀── 報告書 JSON（選択・備考・根拠・SOAP）◀──
 6. 報告書フォーム表示（報告書ソフトと同じ並び）
    ・要確認 バッジ / 根拠引用 / 引用が原文に無ければ警告
 7. 薬剤師が確認・修正 → 確定
 8. 端末内で名前を復元 → 印刷用レイアウト / コピー用テキスト
```

- **個人情報が出る境界は 5 の POST のみ**。送るのはマスク済みテキストと宛先だけ。
- サーバーは状態を持たない（DB なし）。下書きの一時保存は端末の localStorage。
- Claude API 側の保持は 30 日以内削除・学習不使用（§1）。それでもマスクするのは「二重の守り」。実運用時の医療情報の取扱い基準の確認は本計画の範囲外（ハッカソン提出後の課題として README に明記）。

---

## 3. 画面と機能

### MVP（11/4 までに動かす）
1. **入力画面**: 大きなテキスト欄。宛先（医療機関／ケアマネ／その他）の切替。
2. **訪問先メモ**: 患者名・家族名・住所・生年月日・電話など、端末に保存。1人分で可（複数患者は拡張）。
3. **マスク確認画面**: 置換箇所を色付きで表示。辞書に無いが名前らしい語（「○○さん」「○○様」の直前など）は**黄色で警告**し、タップで辞書に追加できる。ここを通らないと送信できない。
4. **下書き生成**: 進行表示付き。失敗時（refusal / max_tokens / タイムアウト / 429）は分かる言葉で表示し再試行できる。
5. **報告書フォーム**: `CLAUDE.md` の表の並び。各欄 = 選択肢（ラジオ／セレクト）+ 備考（自由入力）。会話に根拠が無い欄は空欄のまま「要確認」バッジ。各グループに「根拠」（会話からの引用）を折りたたみ表示。SOAP の S は引用そのまま。
6. **確定 → 出力**: 名前を復元した「完成テキスト」。コピー・印刷（A4 想定、`@media print`）。宛先で文頭の宛名だけ変わる。

### 拡張（11/5 以降、時間があれば）
- 複数患者の訪問先メモ、下書き履歴（端末内）。
- 端末内音声認識（§4-5）。
- 2 つ目の架空台本（ケアマネ宛）での評価。
- スマホのホーム画面追加（PWA 最小構成）。

### 画面方針
- 文字は大きく（本文 18px 以上、選択肢ボタンは指で押せる高さ）。色だけで意味を伝えない（「要確認」は文字でも表示）。
- 画面案が必要なら Claude Design で 1〜2 案作ってから実装（任意。グローバルルールに従い、実装コード自体は Claude Code で書く）。

---

## 4. Claude API の使い方

### 4-1. モデルと設定
- 既定 `claude-opus-5-5`（claude-api スキルの既定）。`effort` は明示する（まず `medium`、評価で `high` と比較）。
- `MODEL` を環境変数で切替可能にし、`claude-sonnet-5-5` を同じ評価で比較（速さ重視の訪問先利用を想定）。採用は評価結果と体感速度で決める。
- 非ストリーミングの `client.messages.parse()` + `zodOutputFormat()`（`@anthropic-ai/sdk/helpers/zod`）。`max_tokens` は 16000（上限であり消費量ではない）。
- `stop_reason` を必ず確認: `refusal`（200 で返る）→「下書きを作れませんでした」表示、`max_tokens` → 上限を上げて再試行。

### 4-2. 報告書スキーマの設計（Structured Outputs の制限に合わせる）
制限（任意パラメータ 24、union 16）を**使い切らない**設計にする:
- **全プロパティを `required`** にする（任意 0、union 0）。
- 選択式の欄は `enum` に本来の選択肢 + **`"要確認"`** を持たせる。`null` や `["string","null"]` は使わない。
- 備考は `string`（根拠が無ければ空文字 `""`）。
- 数値欄（食事回数）も `string`（例 `"3"`、不明なら `"要確認"`）にして union を避ける。数値制約はスキーマで表せないため、画面側で検証。
- 「○日毎」「○時間○分」のような補足値は備考に書く運用にし、スキーマは単純に保つ。

| グループ | 欄 | 型 |
|---|---|---|
| 宛先 | 宛先 | enum: 医療機関／ケアマネ／その他／要確認 |
| 訪問 | 訪問頻度 | enum: 1週間毎／2週間毎／1か月毎／その他／要確認 + 備考 |
| 服薬 | 調剤形態、服薬管理者、管理方法、服薬状況 | 各 enum + 備考 |
| 残薬 | 残薬 | array of {薬剤名: string, 残数: string, 備考: string}（0件可） |
| 食事 | 量、回数、嚥下 | enum / string / enum + 備考 |
| 排泄 | 尿頻度、便通 | enum + 備考 |
| 睡眠 | 日中、夜間 | enum + 備考 |
| 運動・移動 | 運動、移動 | enum + 備考 |
| 傾向 | 日常でみられる傾向 | enum: 特になし／有／要確認 + 備考 |
| 指導内容 | S・O・A・P | 各 string（S は本人の言葉の引用） |
| 定型 | 指導相手、後発品希望、お薬手帳 | 選択肢は見本を見て決める（§11） |
| 根拠 | グループごとの `根拠` | string（会話からの引用、無ければ `""`） |

- **根拠はグループ単位**（欄ごとにすると項目数が約3倍になり、コンパイル上限に当たる恐れ）。初日にこのスキーマがコンパイルできることを確認する（「Schema is too complex」が出たら根拠をさらに集約）。
- enum 値の大文字小文字は保証されないため、比較は正規化して行う（今回の選択肢は日本語なので実害は小さい）。
- スキーマの `enum` や説明文に個人情報を入れない（公式の注意事項）。架空データでも患者名はスキーマに書かない。

### 4-3. システムプロンプト（= Skill の正本）
- `prompts/report-rules.md` を正本とし、アプリは**ビルド時に TS 定数へ生成**して読み込む。Claude Code の Skill も同じファイルを参照する（§5-1）。
- 内容: 役割（書類の下書き支援であり医療判断はしない）、各欄の選択基準、「会話に根拠が無い欄は要確認、推測で埋めない」、S は原文引用、備考の書き方、根拠の書き方、口語→報告書の文体変換の例。
- 512 トークン以上になる見込みなので `cache_control` を付ける（開発中の繰り返し実行と、同じ日に複数件作る場面で効く）。effort を変えるとキャッシュが切れるため、比較実験は時間を分けて行う。

### 4-4. 引用照合（AIは下書き、判断は薬剤師）
- 返ってきた `根拠` と `S` が、送ったマスク済みテキストに実在するかを**画面側で照合**（空白・句読点を無視した部分一致）。見つからなければ「原文にない引用」警告を付け、薬剤師の確認を促す。
- 「要確認」の欄は未選択のまま表示し、確定時に未選択が残っていれば一覧で知らせる（空欄のまま確定することも可能）。

### 4-5. 音声入力（第2段階・任意）
- 第1段階: テキスト貼り付け。スマホではキーボードの音声入力でそのまま欄に入力できる（処理場所は OS 依存で、本計画では未確認）。
- 第2段階: `SpeechRecognition.available({langs:["ja-JP"], processLocally:true})` が `available`（または `downloadable` → `install()` 成功）のときだけ録音ボタンを有効化。`processLocally = true` 固定。`unavailable` の端末には「この端末では端末内音声認識が使えません」と表示して第1段階に誘導。
- **使わないもの**: サーバー送信型の Web Speech（既定動作）、外部の文字起こし API（生の音声に実名が含まれる）。ブラウザ内 Whisper は期間内の実装・検証が重く見送る。
- 日本語の端末内認識が社長の端末で使えるかは**未確認** → 11/3 に実機（スマホ・PC）で `available()` の値を確認し、第2段階の可否を決める。
- マイク利用は HTTPS（または localhost）が必要。スマホ実機で音声を試すには HTTPS の配信先が要る（§7）。

---

## 5. Claude Code 機能の割り当て（審査向けの説明も兼ねる）

### 5-1. Skills（`.claude/skills/`）
| スキル | 役割 | 設定 |
|---|---|---|
| `houmon-report-rules` | 報告書の書式・選択肢・SOAP・要確認ルールの**正本**。実装・プロンプト修正・評価のとき Claude Code が参照する。アプリのシステムプロンプトも同じ `prompts/report-rules.md` から生成するので「人と AI とアプリが同じルールを見る」 | 自動呼び出し可（description で誘導）。本文は短く、詳細は `prompts/report-rules.md` を読む指示 |
| `/eval-report` | `npm run eval` を実行し、見本との差分表を読み解いて、プロンプトのどこを直すべきかを提案する | `disable-model-invocation: true`、`!`npm run eval`` で結果を埋め込む |
| `/pii-check` | フィクスチャ・テスト・ドキュメント・スクリーンショットに実在データらしきものが無いか監査 | `context: fork`、`agent: pii-auditor` |

### 5-2. サブエージェント（`.claude/agents/`）
| エージェント | 役割 | model / tools |
|---|---|---|
| `pii-auditor` | 架空データ以外が混入していないかの**二重チェック**。全フィクスチャ先頭の「この台本は架空です」宣言、実在しそうな住所・電話・医療機関名・氏名パターン、`.env` 由来の文字列を探す。結果は一覧で返す | `model: sonnet`（日本語の氏名判定に判断力が要るため Haiku にしない）、`tools: Read, Grep, Glob` |
| `report-qa` | 評価結果（差分表）を読み、落ちた欄ごとに「台本のどの発話が根拠か」「ルール文のどこを直すか」を整理。**編集はしない**（提案のみ） | `model: sonnet`、`tools: Read, Grep, Bash(npm run eval*)` |

### 5-3. フック（`.claude/settings.json` にコミット + git 側の `pre-commit`）
| イベント | 条件 | 動作 |
|---|---|---|
| `PreToolUse` | `Bash(git commit *)` / `Bash(git push *)` | `node .claude/hooks/guard-commit.mjs` を実行。ステージ済み差分に `sk-ant-` 等の API キー形式、値入りの `ANTHROPIC_API_KEY=`、`.env` 自体、架空宣言の無い `fixtures/` ファイルがあれば**終了コード 2 でブロック**し理由を返す。`onFailure: "block"` |
| `PreToolUse` | `Edit(.env)` / `Write(.env)` | ブロック（キーは社長だけが書く） |
| `Stop` | — | 未コミットの変更があれば「今日の動く状態をコミットしていません」と表示（任意） |
| git `pre-commit`（`.githooks/`、`core.hooksPath`） | 全コミット | 同じ `guard-commit.mjs` を実行。Claude Code 以外からのコミットも守る |

gitleaks は未導入のため、依存を増やさず Node スクリプトで実装する（Node は既にある）。

### 5-4. MCP
- 現時点で**目的に合う MCP が無い**ため使わない。理由: 外部サービス連携（カレンダー・DB・チケット）が無く、評価や監査はスクリプトとサブエージェントで足りる。無理に使うと審査で「目的に合わせて使い分ける」の逆になる。
- 候補として残すもの: 報告書ソフトへの転記を自動化する段階（本番運用）で、転記先が API を持てば MCP サーバー化する価値がある。README に「次の一手」として書く。

### 5-5. その他の Claude 機能
- Structured Outputs（主機能）、adaptive thinking + effort、prompt caching、`refusal` の扱い。
- 開発中の UI 確認は Claude Code の内蔵ブラウザでスマホ幅表示を確認する。

---

## 6. 合格ライン（評価）

- `fixtures/yamamoto-hanako/transcript.md`（架空台本）と `expected.json`（見本を JSON 化）を置く。先頭に「この台本は架空です」宣言。
- `scripts/eval.ts`（`npm run eval`）: API を1回呼び、欄ごとに「見本 / 実際 / 一致」の表を出す。
  - 選択式: 一致率 100% を合格（見本が空欄の欄は「要確認」と一致すること）。
  - 備考・SOAP: 並べて表示し人が判定（必要なら後で Haiku 5.5 による採点を追加）。
  - S の引用が台本に実在すること、出力にマスク記号以外の氏名が無いこと。
- 11/5 までに**2 つ目の台本**（別患者・ケアマネ宛）を架空で作り、1 本目に過剰適合していないか確認。
- 評価の API 費用は 1 回 $0.1 前後（§10）。

---

## 7. 技術スタックとリポジトリ構成

- Next.js（App Router、TypeScript、実装時に最新安定版を確認）、Tailwind CSS、Zod、`@anthropic-ai/sdk`。DB なし。
- 配信: 開発中は PC で `next dev`、スマホは同一 LAN で確認（テキスト経路は http で可。マイクは HTTPS 必須）。デモ用に Vercel 等へ配信するかは §11（無料枠の条件を確認してから）。

```
houmon-report-ai/
├─ CLAUDE.md
├─ docs/PLAN.md（本書）
├─ prompts/report-rules.md          ← ルールの正本（Skill とアプリが共有）
├─ fixtures/yamamoto-hanako/        ← 架空台本と見本 JSON（先頭に架空宣言）
├─ scripts/eval.ts, scripts/gen-prompt.ts
├─ src/app/                         ← 画面（入力 / マスク確認 / フォーム / 出力）
├─ src/app/api/draft/route.ts       ← Claude API 呼び出し（サーバーのみ）
├─ src/lib/mask/                    ← 端末内マスク・復元（純関数、単体テスト）
├─ src/lib/report/schema.ts         ← Zod スキーマ（Structured Outputs と画面で共用）
├─ src/lib/report/evidence.ts       ← 引用照合
├─ .claude/skills/  .claude/agents/  .claude/hooks/  .claude/settings.json
├─ .githooks/pre-commit
└─ .env（git 管理外） / .env.example
```

---

## 8. 日程（毎日「動く状態」で終える）

| 日 | 目標（終業時に動くもの） | 主な作業 |
|---|---|---|
| 11/2（月） | スキーマがコンパイルされ、台本から JSON が返る CLI | 計画確定、Next.js 雛形、フック・Skill・エージェントの骨組み、フィクスチャ投入、`scripts/eval.ts` の最小版で**初回 API 呼び出し**、初コミット |
| 11/3（火） | ブラウザで「貼り付け → マスク確認 → 下書き → フォーム表示」が通る | マスク処理と確認画面、`/api/draft`、フォーム骨格、実機で `available()` 確認 |
| 11/4（水） | MVP 完成。見本との一致率を `npm run eval` で確認 | 全欄・備考・SOAP・根拠、要確認バッジ、引用照合、確定 → 復元 → コピー・印刷 |
| 11/5（木） | スマホで実用に耐える速さと見やすさ | 大きな文字の調整、エラー処理、キャッシュ、Opus/Sonnet・effort 比較、2 本目の台本、`/pii-check` |
| 11/6（金） | デモ経路の固定 | 端末内音声認識（可否判定次第）、配信先、README（構成図・Claude 機能の使い分け・架空データ方針）、`/eval-report` 整備 |
| 11/7（土） | 提出物の下書き完成 | デモ動画の台本と撮影、説明文、最終評価、予備日 |
| 11/8（日） | 20:00 までに提出 | 最終確認（フック・監査・動作）、タグ付け、提出 |

---

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| スキーマが「too complex」で 400 | 初日に確認。根拠をさらに集約、備考を減らす、2 回に分けて呼ぶ |
| Opus 5.5 がスマホ利用で遅い | 評価で Sonnet 5.5・effort `low/medium` を比較。進行表示を出す |
| 1 本の台本に過剰適合 | 2 本目の架空台本。ルール文は一般化して書く（見本の文言を丸写ししない） |
| マスク漏れ | 送信前の確認画面を必須にし、名前らしい語を警告。辞書に追加できる |
| 実データ・キーの誤コミット | フック + git `pre-commit` + `.env` 編集ブロック + `pii-auditor` |
| 審査基準・提出形式が不明 | 社長が持つ参加者向け案内を確認（§11）。README に「何を Claude のどの機能で解いたか」を明記して備える |
| 端末内音声認識が日本語非対応 | 第1段階（テキスト）で提出できる設計。音声はあくまで加点 |

---

## 10. コスト見積り（確認済み料金ベース）

前提: 1 回の下書きで入力 8,000 トークン（ルール 3,000 + 会話 5,000）、出力 3,000 トークン。会話の文字数からトークン数への換算は未計測なので、初回実行で `usage` を記録して補正する。

| モデル | 1 回 | 開発中 300 回 |
|---|---|---|
| Opus 5.5（$4 / $20） | 約 $0.09（ルール部がキャッシュ命中なら約 $0.08） | 約 $27 |
| Sonnet 5.5（$2 / $10） | 約 $0.05 | 約 $14 |
| Haiku 5.5（$0.10 / $0.50） | 約 $0.002 | 約 $0.7 |

- Max 付帯の月次 API クレジット $200（資料の 2026-10-09 時点の情報。請求サイクルで失効）の範囲に収まる見込み。ハッカソン特典の $500 が別組織に付与される場合はそのキーを使う方が節約になる（§11）。
- Batch API（50% 引き）は対話的な用途なので使わない。

---

## 11. 社長に確認したいこと

1. **提出物と審査基準**: 運営（Cerebral Valley / Discord / メール）から提出形式（動画の長さ、説明文、提出フォーム）や審査基準の案内があれば共有してほしい。公式ページには未掲載。
2. **締切の確認**: `CLAUDE.md` の 11/8（日）20:00 を提出締切として扱う。公式ページの開催終了は 11/10（火）14:00 なので、11/8 が提出締切で 11/10 が審査・発表という理解でよいか。
3. **API キーの出所**: ハッカソン特典の $500 クレジットは、どの Console 組織に付与されたか（既存の Max 連携組織か、新しい組織か）。`.env` に入れるキーはクレジットが入っている組織のものにする。残高は Console の請求ページで確認。
4. **見本と欄の並び**: 次のメッセージで渡される台本と一緒に、見本の報告書（架空）と、報告書ソフトの欄の**並び順**・定型欄（指導相手、後発品希望、お薬手帳）の選択肢をもらいたい。
5. **音声入力の優先度**: 「テキスト優先、端末内音声認識は対応端末だけ」の方針でよいか。
6. **デモの配信先**: スマホ実機デモのために外部配信（Vercel 等）を使うか、PC のローカルと LAN 内スマホで済ませるか。外部配信する場合は無料枠の条件を確認してから進める。

---

## 12. 参考（一次情報の URL）

- ハッカソン公式: https://cerebralvalley.ai/e/built-with-claude-japan2026
- Techno Edge 記事: https://www.techno-edge.net/article/2026/10/14/5584.html
- 参加記録（二次情報）: https://tech.gadget-kazuki.com/p/built-with-claude-japan-2026
- Claude 料金: https://platform.claude.com/docs/en/about-claude/pricing
- モデル一覧: https://platform.claude.com/docs/en/about-claude/models/overview
- Structured Outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- API データ保持: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data
- Claude Code データ方針: https://code.claude.com/docs/en/data-usage
- Claude Code Skills / Sub-agents / Hooks / MCP: https://code.claude.com/docs/en/skills , https://code.claude.com/docs/en/sub-agents , https://code.claude.com/docs/en/hooks , https://code.claude.com/docs/en/mcp
- Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition , https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
