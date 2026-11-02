/**
 * 基本情報（BasicInfo）から、マスク辞書・API に送る文脈・出力用ヘッダーを組み立てる純関数。
 */
import { maskText } from "@/lib/mask";
import type { DraftContext } from "@/lib/report/schema";
import type { MaskToken, MaskWarning, PersonalInfoDictionary } from "@/lib/mask/types";
import type { FixedFields, ReportHeader } from "@/lib/report/format";
import type { BasicInfo } from "./types";

/** 読点・カンマ・改行で区切って空要素を除く */
export function splitWords(s: string): string[] {
  return s
    .split(/[、,，\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** 宛名・処方見出しの中の肩書き・見出し語。名前としては扱わない */
const NOT_NAME_WORDS = new Set([
  "様", "殿", "先生", "御侍史", "侍史", "御中", "ケアマネジャー", "ケアマネージャー", "ケアマネ",
  "主任ケアマネジャー", "医師", "薬剤師", "院長", "副院長", "理事長", "施設長", "管理者", "担当",
  "内科", "外科", "小児科", "皮膚科", "整形外科", "精神科", "神経内科", "循環器内科", "消化器内科",
  "処方日", "処方医", "処方箋", "宛", "各位",
]);

/**
 * 宛名・処方見出しから、氏名と医療機関名・事業所名の候補語を取り出す（マスク辞書の「その他」に足す）。
 * 空白・句読点で区切り、肩書きと日付・数字を含む語を除く。「みどり在宅クリニック」のような施設名は全体を1語で残す。
 */
export function extractNameWords(...texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const raw of text.split(/[\s　、,，:：;；()（）「」『』/／]+/)) {
      const w = raw.replace(/(?:先生御侍史|御侍史|先生|様|殿|御中)$/, "").trim();
      if (w.length < 2 || /\d/.test(w) || NOT_NAME_WORDS.has(w)) continue;
      if (!out.includes(w)) out.push(w);
    }
  }
  return out;
}

/** マスク辞書。基本情報の氏名・住所・生年月日などから組む（端末内のみで使う） */
export function buildDictionary(b: BasicInfo): PersonalInfoDictionary {
  const family = b.familyMembers
    .filter((m) => m.name.trim() !== "")
    .map((m) => ({ name: m.name.trim(), relation: m.relation.trim() }));
  // 手入力の語に加えて、宛名（医師・ケアマネ）と処方見出し（処方医）の氏名・施設名も置き換え対象にする
  const others = [
    ...new Set([
      ...splitWords(b.otherMaskWords),
      ...extractNameWords(b.addresseeDoctor, b.addresseeCareManager, b.prescriptionHeader),
    ]),
  ];
  return {
    patient: {
      familyName: b.patientFamilyName.trim(),
      givenName: b.patientGivenName.trim(),
      kana: b.patientKana.trim() || undefined,
    },
    family: family.length > 0 ? family : undefined,
    address: b.address.trim() || undefined,
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(b.birthDate) ? b.birthDate : undefined,
    phone: b.phone.trim() || undefined,
    others: others.length > 0 ? others : undefined,
  };
}

/** 訪問頻度の表記（例: 1週間毎 / その他（28日毎）） */
export function formatVisitFrequency(choice: string, note: string): string {
  if (choice === "") return "";
  if (choice === "その他" && note.trim() !== "") return `その他（${note.trim()}）`;
  return choice;
}

/** API に送る文脈。氏名・住所・宛名・薬局名などは含めない */
export function buildContext(b: BasicInfo): DraftContext {
  return {
    visitFrequency: formatVisitFrequency(b.visitFrequency, b.visitFrequencyNote),
    dispensingForm: b.dispensingForm,
    currentMedicationManager: b.currentMedicationManager,
    currentManagementMethod: b.currentManagementMethod,
    family: b.family.trim(),
    prescription: b.prescription.trim(),
  };
}

/** 同じ（記号, 元の文字列）を重ねずに、先に渡した方の順で記号の対応表を結合する */
export function mergeTokens(...lists: MaskToken[][]): MaskToken[] {
  const seen = new Set<string>();
  const out: MaskToken[] = [];
  for (const list of lists) {
    for (const t of list) {
      const key = `${t.token}\u0000${t.original}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * API に送る文脈（家族構成・処方内容など）にも、会話と同じ辞書でマスクを掛ける。
 * 氏名などが書かれていても、記号に置き換わってから送られる。
 */
export function maskContext(
  context: DraftContext,
  dictionary: PersonalInfoDictionary,
): { context: DraftContext; tokens: MaskToken[]; warnings: MaskWarning[] } {
  const out: DraftContext = { ...context };
  const lists: MaskToken[][] = [];
  const warnings: MaskWarning[] = [];
  for (const key of Object.keys(context) as (keyof DraftContext)[]) {
    const r = maskText(context[key], dictionary);
    out[key] = r.masked;
    lists.push(r.tokens);
    for (const w of r.warnings) warnings.push({ ...w, reason: `基本情報の文脈欄: ${w.reason}` });
  }
  return { context: out, tokens: mergeTokens(...lists), warnings };
}

/** 送信直前の最終確認。マスク済みの文字列にもう一度マスクを掛けて、まだ置き換わる語（＝元の値の残り）があるかを調べる */
export function hasUnmaskedOriginal(outgoing: string, dictionary: PersonalInfoDictionary): boolean {
  return maskText(outgoing, dictionary).tokens.length > 0;
}

/** 下書きの作成元を見分けるための短い印（FNV-1a 32bit ×2）。文字列そのものは保存しない */
export function fingerprint(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
    b ^= b >>> 13;
  }
  return `${s.length}-${a.toString(36)}${b.toString(36)}`;
}

/** 出力用ヘッダー（宛先種別に応じた宛名を選ぶ） */
export function buildHeader(b: BasicInfo): ReportHeader {
  const addressee =
    b.recipientType === "ケアマネ"
      ? b.addresseeCareManager
      : b.recipientType === "医療機関"
        ? b.addresseeDoctor
        : "";
  return {
    addressee: addressee.trim(),
    reportDate: b.reportDate,
    nextVisitDate: b.nextVisitDate,
    patient: {
      name: [b.patientFamilyName.trim(), b.patientGivenName.trim()].filter(Boolean).join(" "),
      kana: b.patientKana.trim(),
      birthDate: b.birthDate,
      sex: b.sex,
      address: b.address.trim(),
    },
    pharmacy: b.pharmacy.trim(),
    visitFrequency: formatVisitFrequency(b.visitFrequency, b.visitFrequencyNote),
    dispensingForm: b.dispensingForm,
    prescriptionHeader: b.prescriptionHeader.trim(),
    prescriptionItems: b.prescription.trim(),
    concomitant: b.concomitant.trim(),
  };
}

export function buildFixedFields(b: BasicInfo): FixedFields {
  return {
    counselingTarget: b.counselingTarget.trim(),
    genericPreference: b.genericPreference.trim(),
    medicineNotebook: b.medicineNotebook.trim(),
  };
}

/** 患者の姓または名が入っているか（ステップ①の完了判定） */
export function isBasicFilled(b: BasicInfo): boolean {
  return b.patientFamilyName.trim() !== "" || b.patientGivenName.trim() !== "";
}
