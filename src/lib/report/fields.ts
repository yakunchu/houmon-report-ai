/**
 * 報告書の欄の定義（日本語の欄名・選択肢・並び順・根拠グループ）。
 * 画面のフォーム描画、確定後の出力テキスト、評価スクリプトの比較表で共用する。
 * 並び順は見本（fixtures/yamamoto-hanako/expected_report.md）＝報告書ソフトの順。
 */
import {
  ABILITY4,
  ADHERENCE,
  AMOUNT3,
  BOWEL,
  DAYTIME_SLEEP,
  MANAGEMENT_METHOD,
  MEDICATION_MANAGER,
  NIGHT_SLEEP,
  TENDENCY,
  UNSURE,
  type Evidence,
  type ReportDraft,
} from "./schema";

export type EvidenceKey = keyof Evidence;

/** 「選択 + 備考」型の欄 */
export type ChoiceFieldKey =
  | "medicationManager"
  | "managementMethod"
  | "adherence"
  | "mealAmount"
  | "swallowing"
  | "urinationFrequency"
  | "bowelMovement"
  | "daytimeSleep"
  | "nightSleep"
  | "exercise"
  | "mobility"
  | "dailyTendency";

export type ChoiceFieldDef = {
  key: ChoiceFieldKey;
  /** 報告書ソフトの欄名 */
  label: string;
  /** 大分類（画面の見出し） */
  group: string;
  /** 「要確認」を除いた選択肢 */
  options: readonly string[];
  /** 根拠（evidence）のグループ */
  evidence: EvidenceKey;
};

/** 選択式の欄を報告書の並び順で */
export const CHOICE_FIELDS: readonly ChoiceFieldDef[] = [
  { key: "medicationManager", label: "服薬管理者", group: "服薬", options: MEDICATION_MANAGER, evidence: "medication" },
  { key: "managementMethod", label: "管理方法", group: "服薬", options: MANAGEMENT_METHOD, evidence: "medication" },
  { key: "adherence", label: "服薬状況", group: "服薬", options: ADHERENCE, evidence: "medication" },
  { key: "mealAmount", label: "食事・量", group: "食事", options: AMOUNT3, evidence: "meals" },
  { key: "swallowing", label: "食事・嚥下", group: "食事", options: ABILITY4, evidence: "meals" },
  { key: "urinationFrequency", label: "排泄・尿頻度", group: "排泄", options: AMOUNT3, evidence: "excretion" },
  { key: "bowelMovement", label: "排泄・便通", group: "排泄", options: BOWEL, evidence: "excretion" },
  { key: "daytimeSleep", label: "睡眠・日中", group: "睡眠", options: DAYTIME_SLEEP, evidence: "sleep" },
  { key: "nightSleep", label: "睡眠・夜間", group: "睡眠", options: NIGHT_SLEEP, evidence: "sleep" },
  { key: "exercise", label: "運動", group: "運動・移動", options: ABILITY4, evidence: "mobility" },
  { key: "mobility", label: "移動", group: "運動・移動", options: ABILITY4, evidence: "mobility" },
  { key: "dailyTendency", label: "日常でみられる傾向", group: "傾向", options: TENDENCY, evidence: "tendency" },
];

/**
 * 報告書全体の並び（見本の順）。画面と出力テキストはこの順で描く。
 * 選択式でない欄（残薬・食事回数・SOAP）もここに含める。
 */
export const REPORT_ORDER: readonly { key: keyof ReportDraft; label: string; group: string }[] = [
  { key: "medicationManager", label: "服薬管理者", group: "服薬" },
  { key: "managementMethod", label: "管理方法", group: "服薬" },
  { key: "adherence", label: "服薬状況", group: "服薬" },
  { key: "leftoverMedications", label: "残薬", group: "服薬" },
  { key: "mealAmount", label: "食事・量", group: "食事" },
  { key: "mealsPerDay", label: "食事・回数", group: "食事" },
  { key: "swallowing", label: "食事・嚥下", group: "食事" },
  { key: "urinationFrequency", label: "排泄・尿頻度", group: "排泄" },
  { key: "bowelMovement", label: "排泄・便通", group: "排泄" },
  { key: "daytimeSleep", label: "睡眠・日中", group: "睡眠" },
  { key: "nightSleep", label: "睡眠・夜間", group: "睡眠" },
  { key: "exercise", label: "運動", group: "運動・移動" },
  { key: "mobility", label: "移動", group: "運動・移動" },
  { key: "dailyTendency", label: "日常でみられる傾向", group: "傾向" },
  { key: "soap", label: "指導内容（SOAP）", group: "指導内容" },
];

export const EVIDENCE_LABELS: Record<EvidenceKey, string> = {
  medication: "服薬（管理者・方法・状況・残薬）",
  meals: "食事",
  excretion: "排泄",
  sleep: "睡眠",
  mobility: "運動・移動",
  tendency: "日常でみられる傾向",
};

export const SOAP_LABELS = { s: "S（本人の言葉）", o: "O（観察・確認）", a: "A（評価）", p: "P（対応・提案）" } as const;

/** 定型欄（会話からは埋めない。基本情報の既定値をそのまま使う） */
export const FIXED_FIELD_LABELS = {
  counselingTarget: "指導相手",
  genericPreference: "後発品希望",
  medicineNotebook: "お薬手帳",
} as const;

export function isUnsure(value: string): boolean {
  return value.trim() === UNSURE;
}

/** 「要確認」のまま残っている選択式の欄を返す（確定前の確認一覧に使う） */
export function listUnsureFields(draft: ReportDraft): ChoiceFieldDef[] {
  return CHOICE_FIELDS.filter((f) => isUnsure(draft[f.key].choice));
}
