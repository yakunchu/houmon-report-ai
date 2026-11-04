/**
 * 患者リストの契約（型と関数シグネチャ）。実装は src/lib/patients/store.ts, search.ts, sort.ts。
 *
 * - すべて端末内（localStorage）に保存し、サーバーや Claude API には一切送らない。
 * - 患者 1 件 = 基本情報一式（マスク用の実名を含む）。訪問ごとに変わるもの（報告日・次回訪問日・下書き）は
 *   ここには持たない（ReportApp の訪問セッション側）。
 * - 並び順: グループごとに「あいうえお順（カナ）」か「手動（manualOrder）」を選べる。
 */

export type PatientId = string;
export type GroupId = string;

export type FamilyMember = {
  /** 実名（マスク用。端末内のみ） */
  name: string;
  /** 続柄（長女 など。AI に送る文脈ではこちらだけを使う） */
  relation: string;
};

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
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
};

export type GroupSortMode = "kana" | "manual";

export type Group = {
  id: GroupId;
  name: string;
  sortMode: GroupSortMode;
  /** sortMode が manual のときの並び。含まれない患者（新規追加）は末尾にカナ順で続ける */
  manualOrder: PatientId[];
  createdAt: string;
};

export type PatientStore = {
  version: 1;
  patients: Patient[];
  groups: Group[];
  /** 最後に選んだ患者（起動時に復元） */
  selectedPatientId: PatientId | null;
};

/** グループ絞り込みの指定。"all" = 全員、"ungrouped" = どのグループにも入っていない人 */
export type GroupFilter = GroupId | "all" | "ungrouped";

export const PATIENT_STORE_KEY = "houmon-report-ai:patients:v1";

/* ---- store.ts ---- */
/** localStorage から読む。無い・壊れている・使えないときは空の store を返す（例外を投げない） */
export type LoadStoreFn = () => PatientStore;
/** localStorage へ書く。失敗しても例外を投げず false を返す */
export type SaveStoreFn = (store: PatientStore) => boolean;
export type CreateEmptyPatientFn = () => Patient;
export type CreateEmptyStoreFn = () => PatientStore;
/** id が一致すれば置換、無ければ追加。updatedAt を更新し、カナをカタカナに正規化した新しい store を返す（元は変更しない） */
export type UpsertPatientFn = (store: PatientStore, patient: Patient) => PatientStore;
export type DeletePatientFn = (store: PatientStore, id: PatientId) => PatientStore;
export type UpsertGroupFn = (store: PatientStore, group: Group) => PatientStore;
/** グループを消す。患者側の groupIds からも外す */
export type DeleteGroupFn = (store: PatientStore, id: GroupId) => PatientStore;
/** 手動並びで患者を delta（-1 = 上へ、+1 = 下へ）動かす。sortMode を manual にし、manualOrder を現在の表示順で初期化してから動かす */
export type MovePatientInGroupFn = (store: PatientStore, groupId: GroupId, patientId: PatientId, delta: -1 | 1) => PatientStore;
export type SetGroupSortModeFn = (store: PatientStore, groupId: GroupId, mode: GroupSortMode) => PatientStore;

/* ---- sort.ts ---- */
/** カナ（姓→名）であいうえお順。カナが空なら氏名で比較。Intl.Collator("ja") を使う */
export type SortByKanaFn = (patients: Patient[]) => Patient[];
/** フィルタとグループの並び設定を適用した表示順。manual のときは manualOrder → 残りはカナ順 */
export type PatientsInGroupFn = (store: PatientStore, filter: GroupFilter) => Patient[];

/* ---- transfer.ts（書き出し・読み込み。iPhone と PC で患者リストを共有する） ---- */
/**
 * 書き出しファイルの中身。実名を含むので、端末どうし（AirDrop・USB など）で直接やり取りし、サーバーは介さない。
 * 患者の id は端末ごとに違い得るので、読み込みでは「氏名 + 生年月日」で同じ人と判定し、グループは名前で突き合わせる。
 */
export type ExportFile = {
  app: "houmon-report-ai";
  kind: "patient-list";
  version: 1;
  /** ISO 8601 */
  exportedAt: string;
  patients: Patient[];
  groups: Group[];
};

/** merge = 追加・更新（同じ人は updatedAt が新しい方を採用）、replace = 端末のリストを丸ごと置き換える */
export type ImportMode = "merge" | "replace";

export type ImportSummary = {
  added: number;
  updated: number;
  unchanged: number;
  groupsAdded: number;
  /** 読み飛ばした行などの注意（id や氏名が無い患者 など） */
  warnings: string[];
};

/** store を JSON 文字列にする（整形あり。selectedPatientId は含めない） */
export type ExportStoreFn = (store: PatientStore, exportedAt: string) => string;
/** ファイル名: houmon-report-ai_患者リスト_YYYYMMDD-HHMM.json */
export type ExportFileNameFn = (exportedAt: string) => string;
/**
 * 文字列を検査して ExportFile にする。壊れた JSON・別アプリのファイル・version 違いは ok:false と日本語の理由。
 * 形が不正な患者・グループは読み飛ばし、warnings にその旨を入れる（読み込み後の summary.warnings にも引き継ぐ）
 */
export type ParseExportFn = (text: string) => { ok: true; file: ExportFile; warnings: string[] } | { ok: false; message: string };
/**
 * 読み込みの適用（純関数。元の store は変更しない）。
 * - merge: 氏名（姓・名）+ 生年月日が同じ患者は同じ人として、updatedAt が新しい方を採用（id は端末側を維持）。
 *   それ以外は追加。グループは名前が同じなら同じグループ（id は端末側を維持）、無ければ追加。
 *   読み込む患者の groupIds と各グループの manualOrder は、突き合わせ後の id に付け替える。
 * - replace: 読み込んだ患者・グループで置き換える（selectedPatientId は null）。
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
