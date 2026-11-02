/**
 * 下書き（ReportDraft）を画面で編集・確認するための小さな純関数。
 */
import { CHOICE_FIELDS, isUnsure, REPORT_ORDER, type ChoiceFieldKey, type EvidenceKey } from "@/lib/report/fields";
import type { LeftoverMedication, ReportDraft } from "@/lib/report/schema";

/** 選択式の欄の一部を書き換えた新しい下書きを返す */
export function patchChoice(
  draft: ReportDraft,
  key: ChoiceFieldKey,
  patch: { choice?: string; note?: string; duration?: string },
): ReportDraft {
  const next: Record<string, string> = { ...draft[key], ...patch };
  // 睡眠・日中が「有」以外になったら、昼寝の長さは消す
  if (key === "daytimeSleep" && patch.choice !== undefined && patch.choice !== "有") next.duration = "";
  return { ...draft, [key]: next } as ReportDraft;
}

export function patchLeftover(draft: ReportDraft, index: number, patch: Partial<LeftoverMedication>): ReportDraft {
  return {
    ...draft,
    leftoverMedications: draft.leftoverMedications.map((r, i) => (i === index ? { ...r, ...patch } : r)),
  };
}

/** 「要確認」のまま残っている欄の名前を、報告書の並び順で返す（確定前の一覧用） */
export function listUnsureLabels(draft: ReportDraft): string[] {
  const labels: string[] = [];
  for (const item of REPORT_ORDER) {
    if (item.key === "leftoverMedications") {
      for (const r of draft.leftoverMedications) {
        if (isUnsure(r.amount)) labels.push(`残薬（${r.drugName || "薬剤名なし"}）の残数`);
      }
    } else if (item.key === "mealsPerDay") {
      if (isUnsure(draft.mealsPerDay.value) || draft.mealsPerDay.value.trim() === "") labels.push(item.label);
    } else if (item.key !== "soap") {
      const def = CHOICE_FIELDS.find((f) => f.key === item.key);
      if (def && isUnsure(draft[def.key].choice)) labels.push(item.label);
    }
  }
  return labels;
}

/** 画面の見出し（大分類）ごとに REPORT_ORDER をまとめる */
export type FieldGroup = { group: string; items: (typeof REPORT_ORDER)[number][] };

export function groupReportOrder(): FieldGroup[] {
  const groups: FieldGroup[] = [];
  for (const item of REPORT_ORDER) {
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return groups;
}

/** 大分類に対応する根拠（evidence）のキー。指導内容には無い */
export function evidenceKeyForGroup(group: string): EvidenceKey | null {
  return CHOICE_FIELDS.find((f) => f.group === group)?.evidence ?? null;
}
