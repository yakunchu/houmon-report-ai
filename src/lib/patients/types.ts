/**
 * 患者リストの契約（型と関数シグネチャ）。実装は src/lib/patients/store.ts, search.ts, sort.ts, view.ts, transfer.ts。
 *
 * - すべて端末内（localStorage）に保存し、サーバーや Claude API には一切送らない。
 * - 患者 1 件 = 基本情報一式（マスク用の実名を含む）。訪問ごとに変わるもの（報告日・次回訪問日・下書き）は
 *   ここには持たない（ReportApp の訪問セッション側）。
 * - 並び順: 「個人宅の全員」「グループ内」「施設の入居者」のそれぞれで、あいうえお順（カナ）か手動（manualOrder）を選べる。
 * - v2（2026-11-07、画面 v2 = docs/UI-V2.md）: 住まい（個人宅／施設）・施設の台帳・訪問曜日・申し送り（注意事項）を追加。
 *   v1 のデータは読み込み時に補う（住まい = 個人宅、曜日なし、申し送りなし、施設なし）。保存キーは変えない。
 */

export type PatientId = string;
export type GroupId = string;
export type FacilityId = string;

/** 訪問曜日。JS の Date.getDay() と同じ（0 = 日 … 6 = 土） */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** 画面に並べる順（月〜日） */
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_LABELS: Record<Weekday, string> = { 0: "日", 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土" };

export type FamilyMember = {
  /** 実名（マスク用。端末内のみ） */
  name: string;
  /** 続柄（長女 など。AI に送る文脈ではこちらだけを使う） */
  relation: string;
};

export type ResidenceKind = "home" | "facility";
/** 住まい。施設のとき facilityId はその施設。施設が消されたら null のまま残る（画面では「施設（未設定）」） */
export type Residence = { kind: ResidenceKind; facilityId: FacilityId | null };

export type Patient = {
  id: PatientId;
  familyName: string;
  givenName: string;
  /** カタカナ。並び替え・検索に使う。ひらがな入力は保存時にカタカナへ正規化する */
  familyNameKana: string;
  givenNameKana: string;
  /** YYYY-MM-DD。空文字可 */
  birthDate: string;
  sex: "" | "男性" | "女性";
  address: string;
  phone: string;
  /** 家族構成・関与（続柄だけ。AI に送る文脈） */
  familyNote: string;
  /** 家族の実名（マスク用） */
  familyMembers: FamilyMember[];
  /** その他マスクしたい語（医療機関名・事業所名など） */
  otherMaskWords: string[];
  /** 宛名（出力の文頭に使う。AI には送らない） */
  recipients: { careManager: string; doctor: string };
  visitFrequency: { choice: string; note: string };
  dispensingForm: string;
  /** 記録上の服薬管理者・管理方法 */
  medicationManager: string;
  managementMethod: string;
  /** 最新の処方（訪問のたびに更新してよい） */
  prescription: { header: string; items: string; concomitant: string };
  fixedFields: { counselingTarget: string; genericPreference: string; medicineNotebook: string };
  groupIds: GroupId[];
  memo: string;
  /** 住まい（個人宅／施設）。v1 のデータは個人宅として読む */
  residence: Residence;
  /** 訪問曜日（複数可。空 = 未設定） */
  visitDays: Weekday[];
  /** 申し送り・注意事項（患者カードの赤いボタンで開く。実名を含みうるので端末内のみ。AI には送らない） */
  handoverNote: string;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
};

/** 患者カードで直接編集して即保存する 3 項目 */
export type PatientExtras = Pick<Patient, "residence" | "visitDays" | "handoverNote">;

export type GroupSortMode = "kana" | "manual";

export type Group = {
  id: GroupId;
  name: string;
  sortMode: GroupSortMode;
  /** sortMode が manual のときの並び。含まれない患者（新規追加）は末尾にカナ順で続ける */
  manualOrder: PatientId[];
  createdAt: string;
};

/** 施設（有料老人ホーム・グループホームなど）。入居者は Patient.residence で結びつく */
export type Facility = {
  id: FacilityId;
  /** 施設名（実名。端末内のみ。AI に送る前にマスクする） */
  name: string;
  /** カタカナ（並び替え用。ひらがな入力は保存時にカタカナへ正規化） */
  nameKana: string;
  groupIds: GroupId[];
  visitDays: Weekday[];
  /** 入居者の並び */
  sortMode: GroupSortMode;
  manualOrder: PatientId[];
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
};

export type PatientStore = {
  version: 2;
  patients: Patient[];
  groups: Group[];
  facilities: Facility[];
  /** 個人宅の全員の一覧（五十音の画面で「手動」にしたとき）の並び */
  homeSortMode: GroupSortMode;
  homeManualOrder: PatientId[];
  /** 最後に選んだ患者（起動時に復元） */
  selectedPatientId: PatientId | null;
};

/** グループ絞り込みの指定。"all" = 全員、"ungrouped" = どのグループにも入っていない人 */
export type GroupFilter = GroupId | "all" | "ungrouped";

/** 一覧と並び替えの対象。home = 個人宅の全員、group = グループ内（住まいを問わない）、facility = その施設の入居者 */
export type OrderScope = { kind: "home" } | { kind: "group"; groupId: GroupId } | { kind: "facility"; facilityId: FacilityId };

/** 保存キー。v2 でも変えない（読み込み時に補って、次の保存で version 2 になる） */
export const PATIENT_STORE_KEY = "houmon-report-ai:patients:v1";

/* ---- store.ts ---- */
/** localStorage から読む。無い・壊れている・使えないときは空の store を返す（例外を投げない）。v1 のデータは v2 に補う */
export type LoadStoreFn = () => PatientStore;
/** localStorage へ書く。失敗しても例外を投げず false を返す */
export type SaveStoreFn = (store: PatientStore) => boolean;
export type CreateEmptyPatientFn = () => Patient;
export type CreateEmptyStoreFn = () => PatientStore;
export type CreateEmptyFacilityFn = () => Facility;
/** id が一致すれば置換、無ければ追加。updatedAt を更新し、カナをカタカナに正規化した新しい store を返す（元は変更しない） */
export type UpsertPatientFn = (store: PatientStore, patient: Patient) => PatientStore;
/** 患者を消す。グループ・施設の manualOrder と homeManualOrder からも外す */
export type DeletePatientFn = (store: PatientStore, id: PatientId) => PatientStore;
export type UpsertGroupFn = (store: PatientStore, group: Group) => PatientStore;
/** グループを消す。患者側・施設側の groupIds からも外す */
export type DeleteGroupFn = (store: PatientStore, id: GroupId) => PatientStore;
/** id が一致すれば置換、無ければ追加。updatedAt を更新し、カナをカタカナに正規化する */
export type UpsertFacilityFn = (store: PatientStore, facility: Facility) => PatientStore;
/** 施設を消す。入居者の residence.facilityId は null にする（kind は "facility" のまま。画面では「施設（未設定）」） */
export type DeleteFacilityFn = (store: PatientStore, id: FacilityId) => PatientStore;
/** 手動並びで患者を delta（-1 = 上へ、+1 = 下へ）動かす。sortMode を manual にし、manualOrder を現在の表示順で初期化してから動かす */
export type MovePatientInGroupFn = (store: PatientStore, groupId: GroupId, patientId: PatientId, delta: -1 | 1) => PatientStore;
export type SetGroupSortModeFn = (store: PatientStore, groupId: GroupId, mode: GroupSortMode) => PatientStore;
/** MovePatientInGroupFn の scope 版（home・group・facility） */
export type MovePatientInScopeFn = (store: PatientStore, scope: OrderScope, patientId: PatientId, delta: -1 | 1) => PatientStore;
export type SetScopeSortModeFn = (store: PatientStore, scope: OrderScope, mode: GroupSortMode) => PatientStore;
/** ドラッグで並べ替えた結果を保存する。scope の sortMode を manual にし、manualOrder を orderedIds にする（含まれない患者は末尾にカナ順） */
export type SetManualOrderFn = (store: PatientStore, scope: OrderScope, orderedIds: PatientId[]) => PatientStore;
/** 住まい・曜日・申し送りだけを更新する（他の欄は触らない。updatedAt は更新） */
export type UpdatePatientExtrasFn = (store: PatientStore, id: PatientId, extras: Partial<PatientExtras>) => PatientStore;

/* ---- sort.ts ---- */
/** カナ（姓→名）であいうえお順。カナが空なら氏名で比較。Intl.Collator("ja") を使う */
export type SortByKanaFn = (patients: Patient[]) => Patient[];
/** フィルタとグループの並び設定を適用した表示順。manual のときは manualOrder → 残りはカナ順 */
export type PatientsInGroupFn = (store: PatientStore, filter: GroupFilter) => Patient[];
/**
 * scope の並び設定を適用した表示順。
 * home = residence.kind === "home" の全員（homeSortMode / homeManualOrder）、group = そのグループ（Group の設定）、
 * facility = residence.facilityId がその施設の患者（Facility の設定）
 */
export type PatientsInScopeFn = (store: PatientStore, scope: OrderScope) => Patient[];
/** 施設をカナ順で（カナが空なら名前で比較） */
export type FacilitiesSortedFn = (store: PatientStore) => Facility[];

/* ---- view.ts（画面の区分け。純関数。実装は患者選び UI 側） ---- */
export type ListSection<T = Patient> = { key: string; title: string; items: T[] };
/** 五十音の見出し（「あ」「か」…「わ」。カナが空・記号なら「他」）。カタカナ・ひらがな・濁音・半濁音・小書きを同じ行にまとめる */
export type KanaRowOfFn = (p: Patient) => string;
/** 五十音の区分け。入力の並びを保ったまま、見出しごとにまとめる（呼び出し側でカナ順にしておく） */
export type SectionsByKanaFn = (patients: Patient[]) => ListSection[];
/** グループ別の区分け。store.groups の順 → 最後に「グループなし」。各区分の並びは patientsInScope(group) の順に従う。空の区分は出さない */
export type SectionsByGroupFn = (store: PatientStore, patients: Patient[]) => ListSection[];
/** 曜日別の区分け（月〜日 → 最後に「曜日なし」）。複数曜日の人は各曜日に出る。空の区分は出さない */
export type SectionsByWeekdayFn = (patients: Patient[]) => ListSection[];
/** 施設の区分け（グループ別・曜日別）。並びは入力順を保つ */
export type FacilitySectionsByGroupFn = (store: PatientStore, facilities: Facility[]) => ListSection<Facility>[];
export type FacilitySectionsByWeekdayFn = (facilities: Facility[]) => ListSection<Facility>[];
/** 配列の from 番目を to 番目へ動かした新しい配列（ドラッグ並び替え用） */
export type MoveItemFn = <T>(items: readonly T[], from: number, to: number) => T[];

/* ---- transfer.ts（書き出し・読み込み。iPhone と PC で患者リストを共有する） ---- */
/**
 * 書き出しファイルの中身。実名を含むので、端末どうし（AirDrop・USB など）で直接やり取りし、サーバーは介さない。
 * 患者の id は端末ごとに違い得るので、読み込みでは「氏名 + 生年月日」で同じ人と判定し、グループと施設は名前で突き合わせる。
 * version 1（facilities なし・患者に住まい等なし）のファイルも読める。
 */
export type ExportFile = {
  app: "houmon-report-ai";
  kind: "patient-list";
  version: 2;
  /** ISO 8601 */
  exportedAt: string;
  patients: Patient[];
  groups: Group[];
  facilities: Facility[];
};

/** merge = 追加・更新（同じ人は updatedAt が新しい方を採用）、replace = 端末のリストを丸ごと置き換える */
export type ImportMode = "merge" | "replace";

export type ImportSummary = {
  added: number;
  updated: number;
  unchanged: number;
  groupsAdded: number;
  facilitiesAdded: number;
  /** 読み飛ばした行などの注意（id や氏名が無い患者 など） */
  warnings: string[];
};

/** store を JSON 文字列にする（整形あり。selectedPatientId は含めない） */
export type ExportStoreFn = (store: PatientStore, exportedAt: string) => string;
/** ファイル名: houmon-report-ai_患者リスト_YYYYMMDD-HHMM.json */
export type ExportFileNameFn = (exportedAt: string) => string;
/**
 * 文字列を検査して ExportFile にする。壊れた JSON・別アプリのファイル・未知の version は ok:false と日本語の理由。
 * version 1 は v2 の形に補って返す。形が不正な患者・グループ・施設は読み飛ばし、warnings にその旨を入れる
 */
export type ParseExportFn = (text: string) => { ok: true; file: ExportFile; warnings: string[] } | { ok: false; message: string };
/**
 * 読み込みの適用（純関数。元の store は変更しない）。
 * - merge: 氏名（姓・名）+ 生年月日が同じ患者は同じ人として、updatedAt が新しい方を採用（id は端末側を維持）。
 *   それ以外は追加。グループ・施設は名前が同じなら同じもの（id は端末側を維持）、無ければ追加。
 *   読み込む患者の groupIds・residence.facilityId と、各グループ・施設の manualOrder は、突き合わせ後の id に付け替える。
 *   homeSortMode / homeManualOrder は端末側を保つ。
 * - replace: 読み込んだ患者・グループ・施設で置き換える（selectedPatientId は null。home の並びは kana に戻す）。
 * 戻り値の summary は画面の確認表示に使う（適用前に同じ関数で内訳を出し、確認後にその結果を保存する）。
 */
export type MergeStoresFn = (local: PatientStore, incoming: ExportFile, mode: ImportMode) => { store: PatientStore; summary: ImportSummary };

/* ---- search.ts ---- */
/**
 * 氏名・カナ・生年月日で部分一致検索（空の query は全員）。
 * - 氏名: 姓・名・姓名（空白あり無し）
 * - カナ: カタカナ・ひらがな・半角カナの違いを吸収
 * - 生年月日: "1940"、"1940-04"、"1940/4/1"、"1940年4月1日"、和暦（"昭和15年4月1日"、"S15"）のいずれでも
 */
export type SearchPatientsFn = (patients: Patient[], query: string) => Patient[];
/** 表示用: 1940-04-01 → 「1940年4月1日（昭和15年）」。空なら空文字 */
export type FormatBirthDateFn = (birthDate: string) => string;
/** 生年月日から満年齢（基準日を省略したら今日） */
export type CalcAgeFn = (birthDate: string, asOf?: Date) => number | null;
