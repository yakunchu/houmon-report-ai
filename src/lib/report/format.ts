/**
 * 確定した下書きを、報告書ソフトに貼れるプレーンテキストにする。
 * 並びは見本（fixtures/yamamoto-hanako/expected_report.md）の順:
 * 宛名 → 基本情報 → 処方内容 → 会話から埋める欄（選択 + 備考） → SOAP → 定型欄
 * 記号（【患者A】など）は変えずに出す。名前への復元は呼び出し側が unmaskText で行う。
 */
import { CHOICE_FIELDS, FIXED_FIELD_LABELS, REPORT_ORDER, type ChoiceFieldKey } from "./fields";
import { UNSURE, type RecipientType, type ReportDraft } from "./schema";

export type ReportHeader = {
  /** 宛名（宛先種別に応じて選んだもの。空なら出さない） */
  addressee: string;
  /** YYYY-MM-DD（報告日 = 訪問日） */
  reportDate: string;
  /** YYYY-MM-DD */
  nextVisitDate: string;
  patient: { name: string; kana: string; birthDate: string; sex: string; address: string };
  pharmacy: string;
  visitFrequency: string;
  dispensingForm: string;
  /** 処方日・処方医の見出し行 */
  prescriptionHeader: string;
  /** 薬剤・量・用法・日数（1行1剤） */
  prescriptionItems: string;
  concomitant: string;
};

export type FixedFields = Record<keyof typeof FIXED_FIELD_LABELS, string>;

/** "2026-11-05" → "2026年11月5日"。形式が違えばそのまま返す */
export function formatJapaneseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 生年月日と基準日（YYYY-MM-DD）から満年齢を求める。求められなければ null */
export function calcAge(birthIso: string, refIso: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthIso);
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(refIso);
  if (!b || !r) return null;
  let age = Number(r[1]) - Number(b[1]);
  if (Number(r[2]) < Number(b[2]) || (Number(r[2]) === Number(b[2]) && Number(r[3]) < Number(b[3]))) age -= 1;
  return age >= 0 ? age : null;
}

/** 「選択（備考）」の形にする */
function withNote(main: string, note: string): string {
  const n = note.trim();
  return n === "" ? main : `${main}（${n}）`;
}

function line(label: string, value: string): string {
  return `${label}：${value.trim() === "" ? "—" : value}`;
}

function formatChoiceField(draft: ReportDraft, key: ChoiceFieldKey): string {
  const v = draft[key];
  if (key === "daytimeSleep") {
    const d = draft.daytimeSleep;
    // 昼寝の長さは「有」のときだけ出す（無・要確認に直したあとに古い長さが残らないように）
    const main = d.choice === "有" && d.duration.trim() !== "" ? `${d.choice} ${d.duration.trim()}` : d.choice;
    return withNote(main, d.note);
  }
  return withNote(v.choice, v.note);
}

function patientLine(h: ReportHeader): string {
  const p = h.patient;
  const age = calcAge(p.birthDate, h.reportDate);
  const parts = [
    p.kana !== "" ? `${p.name}（${p.kana}）` : p.name,
    p.birthDate !== "" ? formatJapaneseDate(p.birthDate) : "",
    age !== null ? `${age}歳` : "",
    p.sex,
    p.address,
  ].filter((s) => s !== "");
  return parts.join("　");
}

export function formatReport(args: {
  draft: ReportDraft;
  header: ReportHeader;
  fixedFields: FixedFields;
  recipientType: RecipientType;
}): string {
  const { draft, header: h, fixedFields, recipientType } = args;
  const out: string[] = [];

  // 宛名
  if (h.addressee !== "") out.push(h.addressee, "");
  out.push("居宅療養管理指導報告書", "");

  // 基本情報
  out.push("【基本情報】");
  out.push(line("宛先", recipientType));
  out.push(line("報告日・訪問日", formatJapaneseDate(h.reportDate)));
  out.push(line("患者", patientLine(h)));
  out.push(line("薬局", h.pharmacy));
  out.push(line("訪問頻度", h.visitFrequency));
  out.push(line("次回訪問日", formatJapaneseDate(h.nextVisitDate)));
  out.push(line("調剤形態", h.dispensingForm));
  out.push("");

  // 処方内容
  out.push("【処方内容】");
  if (h.prescriptionHeader !== "") out.push(h.prescriptionHeader);
  if (h.prescriptionItems !== "") out.push(h.prescriptionItems);
  out.push(line("併用薬", h.concomitant));
  out.push("");

  // 会話から埋める欄（見本の順。SOAP は別枠）
  out.push("【会話から記入する欄】");
  for (const item of REPORT_ORDER) {
    if (item.key === "soap") continue;
    if (item.key === "leftoverMedications") {
      const rows = draft.leftoverMedications.map((r) => {
        const main = `${r.drugName} ${r.amount}`.trim();
        return withNote(main, r.note);
      });
      out.push(line(item.label, rows.join("、")));
    } else if (item.key === "mealsPerDay") {
      const m = draft.mealsPerDay;
      const main = m.value.trim() === UNSURE ? UNSURE : m.value.trim() === "" ? "" : `${m.value.trim()} 回/日`;
      out.push(line(item.label, withNote(main, m.note)));
    } else {
      const def = CHOICE_FIELDS.find((f) => f.key === item.key);
      if (def) out.push(line(item.label, formatChoiceField(draft, def.key)));
    }
  }
  out.push("");

  // SOAP
  out.push("【指導内容】");
  out.push(`【S】${draft.soap.s.trim()}`);
  out.push(`【O】${draft.soap.o.trim()}`);
  out.push(`【A】${draft.soap.a.trim()}`);
  out.push(`【P】${draft.soap.p.trim()}`);
  out.push("");

  // 定型欄
  out.push("【定型欄】");
  out.push(line(FIXED_FIELD_LABELS.counselingTarget, fixedFields.counselingTarget));
  out.push(line(FIXED_FIELD_LABELS.genericPreference, fixedFields.genericPreference));
  out.push(line(FIXED_FIELD_LABELS.medicineNotebook, fixedFields.medicineNotebook));

  return out.join("\n") + "\n";
}
