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
