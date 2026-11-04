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
| 締切・審査日程 | **提出締切 11/8（日）20:00 JST（確定）**。11/9 一次審査（上位6チーム）、11/10 13:00 最終審査 | 社長（キックオフ情報、2026-11-02） |
| 提出物 | Cerebral Valley のフォームから5項目: ①プロジェクト名・テーマ ②デモ動画（最大3分、YouTube か Loom、審査員が見られる設定）③公開 GitHub リポジトリ ④プロジェクト概要（解決する課題と誰のためか）⑤Claude の使い方に関する質問への回答。テーマは「テーマ1: あなたにしかない深さを」 | 同上 |
| 審査基準 | **インパクト 30%**（誰がどんな場面でどれくらい困っているか、ハッカソン後も使い続けるか）／**デモ 25%**（冒頭で「誰の・どんな課題を・どう解決するか」が明確か）／**Claude の活用 25%**（Skills・サブエージェント・MCP・フック等を目的に応じて使い分けたか）／**深さと実行 20%**（試行錯誤の跡、丁寧な設計と実装、リポジトリの中身も見られる） | 同上 |
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

**社長の契約リソース**（`KING_BISON_利用可能リソース一覧.md` 2026-10-09 版）: Max 20x、Max 付帯の月次 API クレジット $200（請求サイクルで失効、API キー経由で利用可）、購入クレジット残高 $5.00。**ハッカソン特典の $500 クレジット**は「ジロー's Individual Org」に申請済み（付与は1〜2営業日後）。`.env` のキー（名前 hackathon、Default ワークスペース）は同じ組織のものなので付与後そのまま使える。付与までは既存残高で動かし、残高不足のときは社長に知らせる（2026-11-02 回答）。

**審査基準から導く優先順位**: ①デモ冒頭 30 秒で「在宅訪問薬剤師の 15 分 → 数分」が伝わる経路を最優先で固める（インパクト+デモ 55%）②Claude 機能の使い分けを README と `.claude/` の中身で示す（25%）③試行錯誤の跡（評価の記録、プロンプト改訂履歴、コミット）を残す（20%）。

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

### 患者リスト（11/4 追加。社長の要望）
- 背景: 基本情報を毎回入力するのは負担。患者リストから選ぶだけにする。
- データ: 患者 1 件 = 基本情報一式（氏名・カナ・生年月日・住所・家族（実名はマスク用）・宛名・訪問頻度・調剤形態・服薬管理者・管理方法・処方・定型欄・所属グループ）。**端末内の localStorage のみ**（`src/lib/patients/`）。サーバーにも API にも送らない。訪問ごとに変わる項目（宛先種別・報告日・次回訪問日）と下書きは患者マスターに持たない。
- 検索: 氏名・カナ（ひらがな・半角カナの違いを吸収）・生年月日（西暦の各表記と和暦）。
- グループ: 施設や訪問曜日などを登録。1 人が複数グループに入れる。グループ内はあいうえお順（カナ、`Intl.Collator("ja")`）か手動（↑↓）に切替。
- 新しい患者の流れ: 「＋ 新しい患者」→ 氏名・カナ・生年月日（マスクに必要な最小限）→ 会話を取り込んで下書き → AI が会話から読み取れた基本情報（`basicInfoSuggestions`: 訪問頻度・調剤形態・家族の関与、および服薬管理者・管理方法）を**空欄にだけ自動入力**し「AI の提案」と表示 → 薬剤師が確認して「患者リストに保存」。既に値がある項目は「記録 → 会話」の差分を見せて手動反映。
- 既存の保存済み基本情報は初回起動時に患者 1 件として自動移行。架空サンプル（山本花子さん）はリストに「（架空）」付きで入る。
- **書き出し・読み込み（11/4 追加）**: 端末ごとに別のリストになるため、JSON ファイルで移す。書き出しは利用者が押したときだけ（実名を含む旨を確認）、iPhone では「ファイル」アプリに保存 → AirDrop などで PC へ。読み込みは「追加・更新」（氏名＋生年月日が同じ人は同じ患者として `updatedAt` が新しい方を採用。グループは名前で突き合わせ、id は端末側を維持）と「置き換え」（確認あり）。適用前に内訳（追加・更新・変更なし・グループ追加）を表示。サーバーは介さない。暗号化は Web Crypto が secure context 限定のため、11/6 の HTTPS 対応後の候補（パスフレーズ付き書き出し）。

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
- マイク利用は HTTPS（または localhost）が必要。スマホ実機で音声を試すには HTTPS の配信先が要る（§4-6）。

### 4-6. 開発中にスマホから HTTPS で開く方法（方針案・2026-11-02 追記、実装は 11/6）

**背景**: `getUserMedia`（録音）と `navigator.clipboard` は secure context（https か localhost）でしか使えない。Chromium の定義では secure origin は https／wss／localhost／127.0.0.0/8／::1 などで、LAN の `http://192.168.1.112:3000` は含まれない（出典: Chromium「Prefer Secure Origins For Powerful New Features」）。文字入力の経路は http のまま動く（`next.config.ts` の `allowedDevOrigins` に `192.168.1.112` と `192.168.1.*` を登録済み。Next.js は `localhost` 以外のオリジンからの `/_next/*` をブロックするため。`*` はホスト名の 1 ラベル＝IP では 1 オクテット）。コピーは http でも動くよう `textarea` + `document.execCommand("copy")` の予備手段を入れた。

| 方法 | 手順の概要 | 長所 | 短所・リスク | 向く場面 |
|---|---|---|---|---|
| **A. 自前証明書 + `next dev --experimental-https`** | mkcert で LAN IP を含む証明書を作る（例: `mkcert 192.168.1.112 localhost 127.0.0.1 ::1`）→ `next dev --experimental-https --experimental-https-key <key> --experimental-https-cert <cert>` → スマホに `rootCA.pem`（`mkcert -CAROOT` の場所）を入れて信頼する。iOS: AirDrop かメールで開く → 設定「プロファイルがダウンロードされました」でインストール → 設定 > 一般 > 情報 > 証明書信頼設定 で「ルート証明書を全面的に信頼」を ON（出典: mkcert README、Apple サポート 102390）。Android: ユーザー証明書として CA をインストール | LAN 内で完結し第三者を経由しない。iPhone・Android 両方で使える。一度入れれば以後は安定 | 初回設定に手間。PC の IP が変わると証明書の作り直し（ルーターの DHCP 固定割当で回避）。**Next 同梱の自動生成証明書は `localhost` / `127.0.0.1` / `::1` だけ**で LAN IP を含まない（確認済: `node_modules/next/dist/lib/mkcert.js`）ので、自前の証明書が必須。開発用 CA をスマホに入れる（`rootCA-key.pem` は PC 外に出さない） | **本命**（11/6 の録音開発） |
| **B. Android Chrome のフラグ** `chrome://flags/#unsafely-treat-insecure-origin-as-secure` に `http://192.168.1.112:3000` を登録 | スマホの Chrome で設定、2〜3 分 | 証明書不要で最速 | Android Chrome だけ（iPhone の Safari には無い）。Chromium の資料は「そのセッション・そのオリジンだけ secure 扱い」とし、Android での可否は chrome://flags 形式については明記なし（コマンドライン版は root が必要と記載）→ 実機で要確認（出典: Chromium「Deprecating Powerful Features on Insecure Origins」） | 社長のスマホが Android なら、録音 UI の即日確認用 |
| **C. Cloudflare Quick Tunnel** `cloudflared tunnel --url http://localhost:3000` | `cloudflared` を PC に入れて起動 → 表示される `trycloudflare.com` の URL をスマホで開く | Cloudflare アカウント不要。証明書不要。LAN の外からも開ける | **URL を知っていれば誰でも開発サーバーに到達できる**（API キーはサーバー側にあるので第三者に使われる恐れ）→ `--allowed-mail` のメール認証ゲートを必ず併用。通信は Cloudflare を経由（マスク済みの会話が通る）。URL は起動ごとに変わり、稼働保証なし、同時 200 リクエストまで、開発・テスト用途と明記。`allowedDevOrigins` に `*.trycloudflare.com` の追加が必要（出典: Cloudflare「Quick Tunnels」） | 自宅 LAN の外でのデモ、CA を入れられない端末 |
| **D. 早期デプロイ（Vercel 等）** | GitHub 連携でデプロイし、環境変数にキーを置く | 本番に近い確認。HTTPS は自動 | 公開 URL + サーバー側 API キー → 認証を付けないと誰でも API を使えてしまう。11/7 の「安全に公開する方法」を聞いてから判断（社長の方針） | 提出直前 |

**方針（2026-11-02 確定。社長のスマホは iPhone）**: **A で進める。B（Android Chrome のフラグ）は対象外。** C は LAN 外でのデモの予備（必ず `--allowed-mail` 付き）。D は 11/7 以降。いずれも `allowedDevOrigins` はホスト名で判定されるため https でも必要。

11/6 の手順（iPhone 向け）:
1. PC で mkcert を用意する（Next が `--experimental-https` の初回に取得する mkcert バイナリの流用か、winget 等での導入。当日に一次情報で確認）。`mkcert -install` のあと `mkcert 192.168.1.112 localhost 127.0.0.1 ::1` で LAN IP 入りの証明書を作る（PC の IP は DHCP で変わり得るので、ルーターで固定割当にするか、変わったら作り直す）。
2. `package.json` に `dev:https`（`next dev --experimental-https --experimental-https-key <key> --experimental-https-cert <cert>`）を足す。証明書と鍵は git 管理外に置く（`.gitignore` に追加。`rootCA-key.pem` は PC の外に出さない）。
3. iPhone に `rootCA.pem`（`mkcert -CAROOT` の場所）を AirDrop かメールで送って開く → 設定「プロファイルがダウンロードされました」からインストール → 設定 > 一般 > 情報 > 証明書信頼設定 で「ルート証明書を全面的に信頼」を ON（出典: mkcert README、Apple サポート 102390）。
4. Safari で `https://192.168.1.112:3000` を開き、鍵マークが出ること、`window.isSecureContext` が true になること、マイク許可のダイアログが出ることを確認する。
5. 録音の設計判断（§4-5）: Safari の `webkitSpeechRecognition` が端末内処理（`processLocally`）に対応しているかは未確認なので、まず `SpeechRecognition.available({ langs: ["ja-JP"], processLocally: true })` の戻り値を実機で確かめる。`unavailable` なら、録音は MediaRecorder で端末内に音声を残すだけにし、文字起こしは iPhone のキーボード音声入力（第1段階の経路）を使う方針に切り替える。サーバー送信型の音声認識は使わない。
6. 証明書の有効期限や IP 変更で開けなくなったときの復旧手順を README に書く。

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
- **スマホで試すときの開発サーバーの起動方法（2026-11-02 の教訓）**: Claude Code の内蔵ブラウザ用に起動したサーバー（preview）は Claude のターンが終わるとアプリ側で停止されるため、iPhone から開くと「サーバーが応答を停止」になる。スマホ実機で使うときは **Terminal パネルで `npm run dev` を起動**する（ターンが終わっても動き続ける。止めるのは Ctrl+C）。

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
| （11/2 実績） | 11/3〜11/4 の予定分まで到達: 一連の経路（貼り付け → マスク → 下書き → フォーム → 確定 → 復元 → コピー・印刷）が動作。評価 13/13、S 原文引用、12.7 秒（effort medium） | 並行実装 Workflow（33 エージェント）→ レビュー 16 件修正。`CLAUDE_EFFORT` が Claude Code の環境変数と衝突したため設定名を `HOUMON_EFFORT` に変更 |
| 11/4（水） | MVP 完成。見本との一致率を `npm run eval` で確認 | 全欄・備考・SOAP・根拠、要確認バッジ、引用照合、確定 → 復元 → コピー・印刷 |
| 11/5（木） | スマホで実用に耐える速さと見やすさ | 大きな文字の調整、エラー処理、キャッシュ、Opus/Sonnet・effort 比較、2 本目の台本、`/pii-check` |
| 11/6（金） | デモ経路の固定 + 録音 | **iPhone から HTTPS で開く（§4-6 の A: mkcert の証明書 + 証明書の信頼）→ 録音・端末内音声認識の可否判定と追加（目安日）**、README（構成図・Claude 機能の使い分け・架空データ方針）、`/eval-report` 整備 |
| 11/7（土） | 提出物の下書き完成 | デモ動画（3分以内、画面録画）の台本と撮影、プロジェクト概要・Claude の使い方の回答文、最終評価。セッション「安全に公開する方法」を聞いてから公開（Vercel 等）の可否を判断 |
| 11/8（日） | 20:00 までに提出 | 最終確認（フック・監査・動作）、タグ付け、Cerebral Valley フォームから提出 |

---

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| スキーマが「too complex」で 400 | **11/2 解消**: 現行スキーマ（全 required、union 0、enum 13）は Opus 5.5 でコンパイルされ、parsed_output が返ることを確認（stop_reason end_turn、14 秒、effort low、短い架空文）。ただし入力 9,624 トークン（スキーマの説明文がプロンプトに展開される分が大きい）→ 説明文の圧縮を後日検討 |
| Opus 5.5 がスマホ利用で遅い | 評価で Sonnet 5.5・effort `low/medium` を比較。進行表示を出す |
| 1 本の台本に過剰適合 | 2 本目の架空台本。ルール文は一般化して書く（見本の文言を丸写ししない） |
| マスク漏れ | 送信前の確認画面を必須にし、名前らしい語を警告。辞書に追加できる |
| 実データ・キーの誤コミット | フック + git `pre-commit` + `.env` 編集ブロック + `pii-auditor` |
| 審査基準・提出形式が不明 | 社長が持つ参加者向け案内を確認（§11）。README に「何を Claude のどの機能で解いたか」を明記して備える |
| 端末内音声認識が日本語非対応 | 第1段階（テキスト）で提出できる設計。音声はあくまで加点 |

---

## 10. コスト見積り（確認済み料金ベース）

前提: 1 回の下書きで入力 8,000 トークン（ルール 3,000 + 会話 5,000）、出力 3,000 トークン。会話の文字数からトークン数への換算は未計測なので、初回実行で `usage` を記録して補正する。
**11/2 実測（短い架空文、ルール無し）**: 入力 9,624 / 出力 846 トークン。スキーマの説明文だけで約 9,000 トークン入るため、実際の 1 回は入力 13,000〜15,000 トークン前後になる見込み（Opus 5.5 で約 $0.06 + 出力 $0.06 ≒ $0.12）。`eval-results/history.md` で継続記録する。

| モデル | 1 回 | 開発中 300 回 |
|---|---|---|
| Opus 5.5（$4 / $20） | 約 $0.09（ルール部がキャッシュ命中なら約 $0.08） | 約 $27 |
| Sonnet 5.5（$2 / $10） | 約 $0.05 | 約 $14 |
| Haiku 5.5（$0.10 / $0.50） | 約 $0.002 | 約 $0.7 |

- Max 付帯の月次 API クレジット $200（資料の 2026-10-09 時点の情報。請求サイクルで失効）の範囲に収まる見込み。ハッカソン特典の $500 が別組織に付与される場合はそのキーを使う方が節約になる（§11）。
- Batch API（50% 引き）は対話的な用途なので使わない。

---

## 11. 社長への確認事項と回答（2026-11-02 回答済み）

1. **提出物と審査基準** → §1 の表に反映（5項目の提出、審査 4 基準）。
2. **締切** → 11/8（日）20:00 JST で確定。11/9 一次審査、11/10 13:00 最終審査。
3. **API キー** → 「ジロー's Individual Org」に $500 を申請済み。`.env` のキーは同じ組織。付与までは既存残高、不足時は社長へ連絡。
4. **台本と見本** → `fixtures/yamamoto-hanako/`（`transcript.md`、`expected_report.md`、JSON 化した `expected.json`、基本情報・処方の `profile.json`）。**欄の並び順は見本ファイルの順＝報告書ソフトと同じ**。選択肢は `CLAUDE.md` の表が正。「センノシドの残数」のように台本に数字がない項目は「要確認」が正解。
5. **音声入力** → 方針どおり。第1段階はテキスト貼り付けで中心機能を完成、録音・端末内認識は 11/6 目安で後から追加。
6. **外部配信** → 期間中は LAN 内で十分。公開は 11/7 のセッションを聞いてから判断。デモ動画は画面録画。

### 見本から分かった設計上の補足
- 報告書は「基本情報（宛先・患者・薬局・訪問頻度・次回訪問日・調剤形態・服薬管理者・管理方法）」「処方内容」「会話から埋める欄」「SOAP」「定型欄」の 5 ブロック。**AI が埋めるのは「会話から埋める欄」と SOAP、および服薬管理者・管理方法の備考**。基本情報と処方内容は薬局側の既存データ（端末内で手入力・保存）で、AI には**文脈として**渡す（例: 一包化・就寝前のセンノシドが処方にあると分かるので、残薬の記述や A/P に使える）。
- 見本の O の書き出し「処方内容の薬効・用法を説明、内容理解OK」、P の「残薬は次回処方で日数調整を医師に提案」「ケアマネジャー様への依頼」は、この薬局の報告書の**書き方の型**としてルール（Skill）に一般化して載せる。見本の文そのものはプロンプトに入れない（評価が意味を失うため）。
- 台本は熊本の方言を含む。方言のまま正しく読み取れることを評価で確認する。

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
