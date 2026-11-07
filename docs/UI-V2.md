# 画面 v2 — タブ式・患者選びを先頭に（2026-11-07 社長の要望）

作成: 2026-11-07 未明。目的は、介護職の方や高齢の方を含む「説明なしで指が動く」画面にすること。
実装は 3 人（データ層 A・タブ画面 B・患者選び UI C）が**同じ作業コピーで並列**に進める。衝突を防ぐため、§7 の担当ファイルを厳守する。

## 1. 社長の要望（原文の要点）

1. 患者を選ぶところがごちゃごちゃして分かりにくい。スッキリまとめる。
2. 下にスクロールする長い 1 ページではなく、**タブが切り替わる**画面。**「次へ」「戻る」のボタンが常にある**。
3. **患者を選ぶ欄が最初**。**個人宅と施設を選ぶ**。
4. 個人宅をタップすると、まず**五十音順**。切り替えで**グループ分け**と**曜日分け**。
5. 施設も同様にグループ分け・曜日分けができる。
6. 患者の表示順は**タップでスライドさせて移動**（ドラッグで並べ替え）。
7. 患者個人の常時画面に**赤い「申し送り・注意事項」ボタン**。タップすると表示。
8. 使う人は薬剤師だけでなく介護職・高齢の方も。感覚的に使える仕様にする。

## 2. 全体の構成（B が担当）

- 4 つのタブ: ①患者 ②会話 ③下書き ④出力。**一度に 1 つのタブだけ見せる**。実装は 4 つとも描画して `hidden` 属性で隠す（入力途中の文字や開閉状態など、子部品の状態を保つため。2026-11-07 実装時の判断）。印刷用の `PrintReport` は④の中にあり、④を開いているときに印刷すると今までどおり出る。
- 上の `StepBar` はタブの見出しとして残す。開いているタブに「いまここ」、まだ開いていない論理上の現在地に「次はここ」、終わった段階に「済み ✓」。タップでそのタブへ移る。
- **画面下に固定の操作バー**（`BottomNav`）: 左「← 戻る」、右「次へ →」。高さ 56px 以上、文字 20px 以上、藍（ai）の塗りの primary と白地の secondary。`safe-area-inset-bottom` を考慮。本文の最下部にバーと重ならない余白（`pb-28` 程度）を取る。印刷時は非表示。
  - ①では「戻る」を出さない（または無効）。④では「次へ」の代わりに「① 患者へ戻る」（secondary）。
  - 「次へ」が無効になるのは **①で患者（氏名）が無いときだけ**。無効のときはボタンの下に「患者を選ぶと進めます」と理由を 1 行出す。②③④では常に有効で、足りないものは各タブの中の既存の案内（WarnText 等）で示す。
- 既存の「マスクして確認」「下書きを作る」「確定」など、成功したら次の場所へ移っていた動き（`scrollToId`）は、**タブの切り替え + タブ内の該当位置へのスクロール**に置き換える（`goToStep(n, anchorId?)`）。
- タブの状態は `sessionStorage` に保存し、再読み込みで同じタブに戻る。URL の `#step-2` のような既存のリンクも受ける。ショートカットの文字起こし取り込み（`#t=`）は②へ移してから帯を出す（既存の `shortcut-import` の帯とスクロールの仕組みは維持）。
- 役割の表示（`statuses`: done/current/todo）は今のロジックを流用する。

## 3. ①患者 の画面（C が担当。B は `PatientPicker` と `CurrentPatientBar` を今までの順で描画するだけ）

### 3-a 入口（患者を選んでいないとき、または「患者を選び直す」を押したとき）

```
┌──────────────────────────────┐
│ 誰の訪問ですか？                │
│ ┌──────────┐ ┌──────────┐     │
│ │  個人宅   │ │   施設    │     │  ← 高さ 96px 以上、文字 24px、人数を小さく添える（例: 12 人／3 施設）
│ └──────────┘ └──────────┘     │
│ ＋ 新しい患者                   │  ← secondary、高さ 56px
│ ▸ その他（読み込み・書き出し・グループ・架空サンプル）│  ← details で畳む
└──────────────────────────────┘
```

- 患者を選んでいるときは、入口の代わりに 1 行の見出し「選択中: 山本 花子 さん　[患者を選び直す]」だけを出し、その下に患者カード（3-e）。
- 「その他」の中身: 読み込み・書き出し（既存 `TransferPanel`）、グループの管理（既存 `GroupManager`）、架空サンプルの読み込み、保存データの全消去（これらは今 `BasicInfoSection` にあるボタンを含め、1 か所にまとめる。`BasicInfoSection` 側からは消すか、C が置き場所を決める）。

### 3-b 個人宅の一覧

```
┌──────────────────────────────┐
│ ← 入口へ        個人宅（12 人）  │
│ [五十音] [グループ] [曜日]       │  ← segmented。選択中は藍の塗り。高さ 48px 以上
│ 🔍 氏名・カナ・生年月日で検索     │  ← 既存の検索
│ あ ───────────────────────── │  ← 見出し（五十音のとき）
│ 浅田 一郎  アサダ イチロウ 84歳 ≡ │  ← 行: 名前 22px 太字 + カナ + 年齢。右端に ≡（手動のときだけ）
│ 阿部 花    アベ ハナ 90歳      ≡ │
│ か ───────────────────────── │
└──────────────────────────────┘
```

- 五十音: `sortByKana` → `sectionsByKana`（あ・か・さ…・他）。右端に **あかさたな の索引**（縦の小さなボタン列。押すとその見出しへスクロール）があると望ましいが任意。
- グループ: `sectionsByGroup`（グループ順 → グループなし）。グループ内の並びは既存の設定（kana / manual）。
- 曜日: `sectionsByWeekday`（月〜日 → 曜日なし）。複数曜日の人は各曜日に出る。並びはカナ順。
- 並び替え（手動）: 五十音の画面で「並び: 五十音｜手動」の切替（`setScopeSortMode({kind:"home"})`）。手動のとき各行の右端に ≡ が出て、ドラッグで入れ替える（3-f）。グループの区分の中でも、そのグループが manual なら同様に並べ替えられる。曜日のときは並べ替えなし。
- 行をタップ → `onSelect(id)` → 入口の代わりに患者カード（3-e）が出る。一覧は畳む（「患者を選び直す」で戻る）。
- 検索中は見出しを出さず、該当者だけを 1 本の一覧で出す（既存どおり）。並べ替えは検索中は不可。

### 3-c 施設の一覧

- 見出し「施設（3 施設）」、切替 [五十音] [グループ] [曜日]（施設に対して同じ区分け。`facilitySectionsByGroup` / `facilitySectionsByWeekday`）。
- 行: 施設名 22px 太字 + 入居者数 + 曜日チップ（例: 月・木）。タップ → 3-d。
- 「＋ 新しい施設」: 名前（必須）・カナ・訪問曜日（7 つのトグル）・グループ（既存グループのチェック）。保存は `upsertFacility`。施設の削除は 3-d の中で（確認ダイアログ付き）。
- `residence.kind === "facility"` で `facilityId` が無い患者が 1 人でもいれば、一覧の最後に「施設（未設定）の入居者（n 人）」の行を出し、タップでその一覧へ。

### 3-d 施設の入居者一覧

- 見出し「← 施設一覧へ　ひまわり荘（4 人）」。並び: 五十音｜手動（`{kind:"facility", facilityId}`）。手動のときはドラッグで入れ替え。
- 「＋ この施設に新しい患者」→ `onNew({ residence: { kind: "facility", facilityId } })`。
- 「この施設を編集」（名前・カナ・曜日・グループ）／「この施設を削除」（確認。入居者は消えず「施設（未設定）」になる旨を書く）。

### 3-e 患者カード（`CurrentPatientBar`。患者を選んだあと、①の上に常に出る「常時画面」）

```
┌──────────────────────────────┐
│ 山本 花子 さん   ヤマモト ハナコ 86歳 │  ← 24px 太字
│ 🏠 個人宅 ／ 水曜            [住まい・曜日を変更] │
│ ┌──────────────────────────┐ │
│ │ 申し送り・注意事項  あり   │ │  ← 赤（akane の塗り、白文字）、高さ 56px、幅いっぱい。無ければ「なし」
│ └──────────────────────────┘ │
│ ✓ 患者リストに保存済み          │  ← 既存の保存状態の表示（未保存なら茜の文字 + 「患者リストに保存」ボタン）
│ [基本情報を開く] [この患者を編集] [リストから削除] │
└──────────────────────────────┘
```

- 赤いボタンをタップ → 画面中央のダイアログ（`role="dialog"`、`aria-modal`、見出し「申し送り・注意事項」、本文 20px 以上、背景を暗く）。中に「閉じる」（56px、secondary）と「編集」。編集は同じダイアログ内で textarea に切り替わり、「保存」で `onSaveExtras({ ...extras, handoverNote })`（即保存）。空のときは「登録されていません。「編集」で書けます。」
- 「住まい・曜日を変更」→ カードの中に折りたたみで出す: 住まい（個人宅／施設 の 2 択 + 施設のときは施設の選択）、訪問曜日（月〜日の 7 つのトグル）。変更のたびに `onSaveExtras` で即保存（未登録の新規患者のときは作業用コピーだけ更新される。B 側の実装）。
- 既存の「患者リストに保存」「この患者を編集」「リストから削除」と、未登録のときの案内文は残す。「基本情報を開く」は B から渡される `onToggleBasic`（既存の `BasicInfoSection` の open/onToggle を操作する）で、長い基本情報フォームは畳んだまま。

### 3-f ドラッグで並べ替え（`ReorderList`）

- 行の右端の **≡ ハンドル（48×48px 以上、`touch-action: none`）** を押さえて上下に動かす。Pointer Events（`pointerdown` で `setPointerCapture`、`pointermove` で行の中心位置から挿入先を計算、`pointerup` で確定）。長押しは使わない（iPhone の文字選択と取り合いになる）。
- 動かしている行は少し持ち上がった見た目（影・薄い藍の枠）、挿入先に 4px の藍の線。確定で `setManualOrder(scope, orderedIds)`。
- キーボード・補助用に、ハンドルの左に小さな「↑」「↓」（既存の矢印。`movePatientInScope`）を残す。
- ライブラリは追加しない（締切前日に依存を増やさない）。

## 4. データ（A が担当。契約は `src/lib/patients/types.ts`。この型を変える必要があれば報告する）

- `Patient` に `residence`・`visitDays`・`handoverNote`。`PatientStore` に `facilities`・`homeSortMode`・`homeManualOrder`、`version: 2`。
- `loadStore` は v1 のデータを補って返す（住まい = 個人宅、曜日なし、申し送りなし、施設なし、home の並びは kana）。不正な曜日（0〜6 以外）は捨てる。`residence.facilityId` が存在しない施設を指していれば null にする。保存キーは変えない。
- 新しい関数: `createEmptyFacility`、`upsertFacility`、`deleteFacility`、`movePatientInScope`、`setScopeSortMode`、`setManualOrder`、`updatePatientExtras`、`patientsInScope`、`facilitiesSorted`。既存の `movePatientInGroup` / `setGroupSortMode` / `patientsInGroup` は残す（scope 版で実装してもよい）。`deletePatient` は施設の manualOrder と homeManualOrder からも外す。`deleteGroup` は施設の groupIds からも外す。
- `transfer.ts`: 書き出しは version 2（facilities 付き）。読み込みは version 1 も 2 も受ける。merge は施設を名前で突き合わせ、患者の `residence.facilityId` と施設の `manualOrder` を付け替える。`ImportSummary.facilitiesAdded`。
- `src/lib/patients/index.ts` に新しい関数を再 export する（view.ts は再 export しない。C が `@/lib/patients/view` から直接 import する）。
- 架空サンプル（`src/lib/sample/*.ts`、`fixtures/*/profile.json`）: 各サンプルに `extras: PatientExtras` を追加して export する。山本花子 = 個人宅・水曜・申し送り「玄関の呼び鈴が鳴らないことがある。裏口から声をかける。」、佐々木清 = 施設「ひまわり荘」（架空。`facilityName` も export）・木曜・申し送り「右耳が聞こえにくい。左側から、ゆっくり大きめの声で。」。`index.ts` の `Sample` 型にも `extras` と `facilityName?` を足す。fixtures の `profile.json` に同じ値を `residence`（"home" / "facility"）・`facilityName`・`visitDays`・`handoverNote` として書く（`scripts/eval.ts` と `src/lib/report/sample-args.ts` の `Profile` 型は壊さない。必要なら optional で足す）。
- テスト: store（v1 → v2 の補い、施設の追加・削除、scope ごとの並び替え、extras 更新）、sort（patientsInScope の 3 種、facilitiesSorted）、transfer（v1 ファイルの読み込み、施設の merge と id の付け替え、replace）。既存テストは全部通ること。

## 5. B の具体的な変更点（`ReportApp.tsx` ほか）

- `activeStep: 1 | 2 | 3 | 4` の state と `goToStep(step, anchorId?)`。既存の `scrollToId(...)` 呼び出しをすべて置き換える（`shortcut-import` の帯は②に移してから `scrollToNoticeWhenSettled`）。
- `StepBar` の `onJump` は `goToStep`。`BottomNav`（`src/components/ui.tsx` か新規 `src/components/BottomNav.tsx`）を追加。
- `BasicInfoSection`・`TranscriptSection`・`DraftSection`・`OutputSection` の描画を `activeStep` で出し分ける。`SuggestionPanel` は③（今の位置関係を保つ）。印刷用の要素は従来どおり。
- `PatientPicker` に渡す `onNew` は `(preset?: Partial<PatientExtras>) => void`。`newPatient(preset)` は `createEmptyPatient()` に preset を重ねる。
- `CurrentPatientBar` に渡す新しい props（§6）。`onSaveExtras(next)`: 作業用コピー（`base`）に重ね、患者がリストに登録済み（`savedPatient !== null`）なら `upsertPatient` でリストにも即保存する。未登録なら `base` だけ更新。
- `loadSample`: サンプルの `extras` を患者に重ねる。佐々木（施設）は、同名の施設が無ければ `createEmptyFacility()` に `facilityName` を入れて `upsertFacility` し、その id を `residence.facilityId` に入れる。
- マスク: 患者の住まいが施設なら、その施設名を「その他マスクしたい語」と同じ扱いでマスク対象に加える（AI に送る前）。
- `clearAll` / `clearSaved` / `sessionStorage` のタブ状態との整合。
- 既存のテスト・lint・型を通す。`docs/` と `README` は触らない（後の工程）。

## 6. 部品の契約（B と C で合わせる。ここに無い props を足したいときは報告する）

```ts
// src/components/patients/PatientPicker.tsx（C）
type Props = {
  store: PatientStore;
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  onNew: (preset?: Partial<PatientExtras>) => void;   // 変更: preset を受ける
  onStoreChange: (next: PatientStore) => void;
  onImport: (next: PatientStore) => void;
  onLoadSample: (id: SampleId) => void;               // 追加: 「その他」に架空サンプルを置くため
  onClearSaved: () => void;                           // 追加: 同上（保存データの消去）
  onClearEverything: () => void;                      // 追加: 同上（全消去）
};

// src/components/patients/CurrentPatientBar.tsx（C）
type Props = {
  name: string; saved: boolean; dirty: boolean; canSave: boolean; notice: string | null;
  onEdit: () => void; onSave: () => void; onDelete: () => void;
  kana: string;                      // 追加: 表示用（空可）
  age: number | null;                // 追加: 表示用
  extras: PatientExtras;             // 追加: 作業中の患者の住まい・曜日・申し送り
  facilities: Facility[];            // 追加: 住まいの選択肢（store.facilities）
  onSaveExtras: (next: PatientExtras) => void;  // 追加: 即保存
  basicOpen: boolean;                // 追加: 基本情報フォームが開いているか
  onToggleBasic: () => void;         // 追加: 「基本情報を開く／閉じる」
};
```

- B は `BasicInfoSection` の props を変えない（`onLoadSample` 等は従来どおり渡し続けてよい。C が `BasicInfoSection` 側のボタンを消すか残すかを決める）。
- C は `ReportApp.tsx` を触らない。B は `src/components/patients/*` と `BasicInfoSection.tsx` を触らない。

## 7. 担当ファイル（厳守。他の人のファイルに必要な変更は、最終報告に「依頼」として書く）

| 担当 | 触ってよいファイル |
|---|---|
| A（データ層） | `src/lib/patients/store.ts`・`sort.ts`・`transfer.ts`・`index.ts`・`search.ts`、`src/lib/patients/*.test.ts`（view.test.ts を除く）、`src/lib/sample/*.ts`、`fixtures/*/profile.json`、`src/lib/report/sample-args.ts`（Profile 型に optional を足すときだけ） |
| B（タブ画面） | `src/components/ReportApp.tsx`、`src/components/StepBar.tsx`、`src/components/ui.tsx`、新規 `src/components/BottomNav.tsx`、`src/lib/ui/storage.ts`、`src/lib/ui/patient-bridge.ts`（必要なら） |
| C（患者選び UI） | `src/components/patients/*.tsx`（新規含む）、`src/components/BasicInfoSection.tsx`、新規 `src/lib/patients/view.ts` と `view.test.ts` |
| 統括 | `src/lib/patients/types.ts`（契約）、`docs/*`、`README.md`、`CLAUDE.md`、`scripts/screenshots.mjs` |

共通ルール:
- `git commit` しない。`npm run build` を走らせない（開発サーバーが同じフォルダで動いている。ビルドは統括が最後に行う）。
- 確認は `npx vitest run <自分のテスト>`、`npx tsc --noEmit`（自分のファイル由来のエラーだけ直す。他の担当のファイル由来のエラーは報告に書く）、`npx eslint <自分のファイル>`。
- 文言は日本語。架空データ以外を書かない。新しい npm 依存を入れない。`new Date()` を描画中に呼ばない（cacheComponents）。effect の中で直接 setState しない（React Compiler の lint）。
- ジローブルーのトークン（`ai`・`hanada`・`shiroai`・`akane`・`ink`・`ink-muted`・`line`・`surface`・`raised`・`on-ai`）と既存の `Button`・`inputClass`・`Section`・`WarnText` を使う。タップ領域 48px 以上、主要ボタン 56px、文字 18px 以上。

## 8. 受け入れ条件（統括が最後に確かめる）

1. `npx vitest run`・`npx tsc --noEmit`・`npm run lint`・`npm run build` がすべて通る。
2. iPhone 幅で: 起動 → 入口（個人宅／施設）→ 個人宅 → 五十音の一覧 → 行をタップ → 患者カードに赤いボタン → 押すと申し送りが開く → 閉じる → 「次へ」で②。
3. ②で架空サンプル①を読み込んだ状態から「マスクして確認」→「下書きを作る」で③に移り、「確定」で④に移る。④の印刷プレビューが今までどおり出る。
4. 施設を作る → その施設に新しい患者 → 入居者一覧に出る → 手動にしてドラッグで順番が変わり、再読み込み後も保たれる。
5. 曜日を付けた患者が「曜日」の区分に出る。グループの区分も出る。
6. v1 の localStorage データ（施設なし）を読み込んでも落ちず、個人宅として出る。書き出し → 読み込み（merge・replace）で施設が保たれる。
7. ショートカットの `#t=` で開くと②に移り、青い帯が見える。Windows 幅でも崩れない。

## 9. この後（統括）

スクリーンショットの撮り直し（`scripts/screenshots.mjs` はタブ操作に変更）、`README.md` の「画面で見る使い方」、`docs/DEMO.md` の①の手順、手順書 4 ページ目、`CLAUDE.md` の患者リストの節、`docs/PLAN.md` §12 に決定と実績を記録。
