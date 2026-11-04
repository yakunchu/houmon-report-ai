/**
 * 下書き（ReportDraft）にある「会話から読み取った基本情報」を、患者の基本情報（BasicInfo）に反映する純関数。
 *
 * - 自動入力は「患者の空欄」だけ。既に値がある項目は、記録と会話の差を見せて、薬剤師が [反映] を押したときだけ上書きする。
 * - 「要確認」（会話に根拠が無い）は提案として扱わない。
 * - AI の返した文字列に記号（【家族1】など）が混ざっていても、基本情報には記号を入れない（取り除く）。
 */
import { UNSURE, type ReportDraft } from "../report/schema";
import { formatVisitFrequency } from "./basic-info";
import type { BasicInfo } from "./types";

/** 「AI の提案（会話から）」のバッジを付ける項目（BasicInfo のキー） */
export type AiField =
  | "visitFrequency"
  | "visitFrequencyNote"
  | "dispensingForm"
  | "currentMedicationManager"
  | "currentManagementMethod"
  | "family";

export type SuggestionKey = "visitFrequency" | "dispensingForm" | "medicationManager" | "managementMethod" | "family";

export const SUGGESTION_LABELS: Record<SuggestionKey, string> = {
  visitFrequency: "訪問頻度",
  dispensingForm: "調剤形態",
  medicationManager: "服薬管理者",
  managementMethod: "管理方法",
  family: "家族の関与",
};

export type SuggestionItem = {
  key: SuggestionKey;
  label: string;
  /** 今の基本情報の値（表示用。空なら空文字） */
  current: string;
  /** 会話から読み取れた値（表示用。補足があれば括弧書き） */
  suggested: string;
  /** 反映したときに BasicInfo に入れる値 */
  patch: Partial<BasicInfo>;
  /** 反映したときにバッジを付ける項目 */
  fields: AiField[];
  /** 自動入力も [反映] もしない理由（氏名らしき語を含むなど）。あれば表示だけにする */
  blocked?: string;
};

/** 続柄 + 敬称（娘さん、お母様 など）は氏名ではないので、判定の前に取り除く */
const RELATION_WITH_HONORIFIC =
  /(お?(母|父|祖母|祖父|嫁|婿|ばあ|じい)(ちゃん|さん|様|さま)?|娘|息子|長女|長男|次女|次男|三女|三男|妻|夫|奥|孫|姉|妹|兄|弟|ヘルパー|ケアマネ(ジャー)?|看護師|薬剤師|医師|本人|家族)(さん|様|さま)/g;

/**
 * 氏名らしい語（「○○さん」「○○様」「○○氏」など）を含むか。
 * 家族の関与は続柄だけを記録する約束なので、AI の提案に氏名が混ざっていたら自動入力しない。
 */
export function looksLikePersonName(s: string): boolean {
  const rest = s.replace(RELATION_WITH_HONORIFIC, "");
  return /[一-龥々〆ァ-ヶーぁ-ん]{1,6}(さん|様|さま|氏|くん|君|ちゃん)/.test(rest);
}

/** 記号（【患者A】【家族1】など）を取り除く。基本情報の欄には記号を入れない */
export function stripMaskTokens(s: string): string {
  return s
    .replace(/【[^】]*】/g, "")
    .replace(/[（(][\s　]*[）)]/g, "")
    .replace(/[ 　]{2,}/g, " ")
    .trim();
}

function withNote(main: string, note: string): string {
  const n = stripMaskTokens(note);
  return n === "" ? main : `${main}（${n}）`;
}

/** 会話から読み取れた項目の一覧（読み取れなかった項目は含まない） */
export function buildSuggestionItems(basic: BasicInfo, draft: ReportDraft): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  const sug = draft.basicInfoSuggestions;

  if (sug.visitFrequency.choice !== UNSURE) {
    const choice = sug.visitFrequency.choice;
    // 備考は「その他」のときの間隔（28日毎 など）として使う。それ以外の備考は根拠の補足なので値には入れない
    const note = choice === "その他" ? stripMaskTokens(sug.visitFrequency.note) : "";
    items.push({
      key: "visitFrequency",
      label: SUGGESTION_LABELS.visitFrequency,
      current: formatVisitFrequency(basic.visitFrequency, basic.visitFrequencyNote),
      suggested: formatVisitFrequency(choice, note),
      patch: { visitFrequency: choice, visitFrequencyNote: note },
      fields: choice === "その他" && note !== "" ? ["visitFrequency", "visitFrequencyNote"] : ["visitFrequency"],
    });
  }

  if (sug.dispensingForm.choice !== UNSURE) {
    const choice = sug.dispensingForm.choice;
    items.push({
      key: "dispensingForm",
      label: SUGGESTION_LABELS.dispensingForm,
      current: basic.dispensingForm,
      suggested: choice,
      patch: { dispensingForm: choice },
      fields: ["dispensingForm"],
    });
  }

  if (draft.medicationManager.choice !== UNSURE) {
    const choice = draft.medicationManager.choice;
    items.push({
      key: "medicationManager",
      label: SUGGESTION_LABELS.medicationManager,
      current: basic.currentMedicationManager,
      suggested: withNote(choice, draft.medicationManager.note),
      patch: { currentMedicationManager: choice },
      fields: ["currentMedicationManager"],
    });
  }

  if (draft.managementMethod.choice !== UNSURE) {
    const choice = draft.managementMethod.choice;
    items.push({
      key: "managementMethod",
      label: SUGGESTION_LABELS.managementMethod,
      current: basic.currentManagementMethod,
      suggested: withNote(choice, draft.managementMethod.note),
      patch: { currentManagementMethod: choice },
      fields: ["currentManagementMethod"],
    });
  }

  const family = stripMaskTokens(sug.family);
  if (family !== "") {
    const blocked = looksLikePersonName(family)
      ? "氏名らしき語を含むため、自動入力も反映もしません。家族の欄には続柄だけを手で入力してください。"
      : undefined;
    items.push({
      key: "family",
      label: SUGGESTION_LABELS.family,
      current: basic.family.trim(),
      suggested: family,
      patch: blocked ? {} : { family },
      fields: blocked ? [] : ["family"],
      blocked,
    });
  }

  return items;
}

/** 提案の値が、今の基本情報と同じか（備考つきの表示ではなく、入れる値で比べる） */
export function isSameAsCurrent(basic: BasicInfo, item: SuggestionItem): boolean {
  return Object.entries(item.patch).every(([k, v]) => ((basic as Record<string, unknown>)[k] ?? "") === v);
}

/** 患者の空欄だけに提案を入れる。入れた項目（バッジを付ける項目）も返す */
export function autoFillBlanks(basic: BasicInfo, draft: ReportDraft): { basic: BasicInfo; filled: AiField[] } {
  let next = basic;
  const filled: AiField[] = [];
  for (const item of buildSuggestionItems(basic, draft)) {
    if (item.blocked || item.current.trim() !== "") continue;
    next = { ...next, ...item.patch };
    filled.push(...item.fields);
  }
  return { basic: next, filled };
}
