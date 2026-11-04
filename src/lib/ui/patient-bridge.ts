/**
 * 患者リストの患者（Patient）と、画面の作業用コピー（BasicInfo）の相互変換。純関数。
 *
 * - 患者リストが「マスター」。患者を選ぶと BasicInfo に読み込み、保存すると Patient に書き戻す。
 * - 訪問ごとに変わる項目（宛先種別・報告日・次回訪問日）と薬局名は患者に持たない。呼び出し側が visit で渡す。
 */
import type { Patient } from "@/lib/patients/types";
import type { RecipientType } from "@/lib/report/schema";
import { splitWords } from "./basic-info";
import type { BasicInfo } from "./types";

/** 患者に持たない「今回の訪問」の値と、端末の設定（薬局名） */
export type VisitFields = {
  recipientType: RecipientType;
  reportDate: string;
  nextVisitDate: string;
  pharmacy: string;
};

/** カナの 2 つの欄を、画面の 1 欄（"ヤマモト ハナコ"）にまとめる */
export function joinKana(familyKana: string, givenKana: string): string {
  return [familyKana.trim(), givenKana.trim()].filter(Boolean).join(" ");
}

/** 画面の 1 欄のカナを、空白（全角含む）で姓・名に分ける。空白が無ければ全部を姓カナに入れる */
export function splitKana(kana: string): { family: string; given: string } {
  const parts = kana.trim().split(/[\s　]+/).filter(Boolean);
  if (parts.length === 0) return { family: "", given: "" };
  return { family: parts[0], given: parts.slice(1).join(" ") };
}

/** 患者 → 作業用コピー */
export function patientToBasicInfo(patient: Patient, visit: VisitFields): BasicInfo {
  return {
    recipientType: visit.recipientType,
    patientFamilyName: patient.familyName,
    patientGivenName: patient.givenName,
    patientKana: joinKana(patient.familyNameKana, patient.givenNameKana),
    birthDate: patient.birthDate,
    sex: patient.sex,
    address: patient.address,
    phone: patient.phone,
    family: patient.familyNote,
    familyMembers: patient.familyMembers.map((m) => ({ name: m.name, relation: m.relation })),
    otherMaskWords: patient.otherMaskWords.join("、"),
    visitFrequency: patient.visitFrequency.choice,
    visitFrequencyNote: patient.visitFrequency.note,
    dispensingForm: patient.dispensingForm,
    currentMedicationManager: patient.medicationManager,
    currentManagementMethod: patient.managementMethod,
    prescriptionHeader: patient.prescription.header,
    prescription: patient.prescription.items,
    concomitant: patient.prescription.concomitant,
    addresseeCareManager: patient.recipients.careManager,
    addresseeDoctor: patient.recipients.doctor,
    pharmacy: visit.pharmacy,
    reportDate: visit.reportDate,
    nextVisitDate: visit.nextVisitDate,
    counselingTarget: patient.fixedFields.counselingTarget,
    genericPreference: patient.fixedFields.genericPreference,
    medicineNotebook: patient.fixedFields.medicineNotebook,
  };
}

/** 作業用コピー → 患者。base の id・groupIds・createdAt・memo を保ち、フォームの値で上書きする */
export function basicInfoToPatient(basic: BasicInfo, base: Patient): Patient {
  const kana = splitKana(basic.patientKana);
  return {
    ...base,
    familyName: basic.patientFamilyName.trim(),
    givenName: basic.patientGivenName.trim(),
    familyNameKana: kana.family,
    givenNameKana: kana.given,
    birthDate: basic.birthDate,
    sex: basic.sex === "男性" || basic.sex === "女性" ? basic.sex : "",
    address: basic.address,
    phone: basic.phone,
    familyNote: basic.family,
    familyMembers: basic.familyMembers.map((m) => ({ name: m.name, relation: m.relation })),
    otherMaskWords: splitWords(basic.otherMaskWords),
    recipients: { careManager: basic.addresseeCareManager, doctor: basic.addresseeDoctor },
    visitFrequency: { choice: basic.visitFrequency, note: basic.visitFrequencyNote },
    dispensingForm: basic.dispensingForm,
    medicationManager: basic.currentMedicationManager,
    managementMethod: basic.currentManagementMethod,
    prescription: { header: basic.prescriptionHeader, items: basic.prescription, concomitant: basic.concomitant },
    fixedFields: {
      counselingTarget: basic.counselingTarget,
      genericPreference: basic.genericPreference,
      medicineNotebook: basic.medicineNotebook,
    },
  };
}

/** キーの順に依存しない文字列化（比較用） */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 2 つの患者の中身が同じか（更新日時は無視）。「未保存の変更があるか」の判定に使う */
export function isSamePatientContent(a: Patient, b: Patient): boolean {
  return stableStringify({ ...a, updatedAt: "" }) === stableStringify({ ...b, updatedAt: "" });
}

/** 今日の日付（端末のローカル時間）を YYYY-MM-DD で返す */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 新しいグループの id（http の LAN 接続では crypto.randomUUID が使えないことがあるので代替を持つ） */
export function newGroupId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
