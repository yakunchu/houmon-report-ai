/**
 * 架空データ（fixtures/ の見本）から FormatArgs を組む。印刷レイアウトの見本ページ（/print-sample/<fixture>）と
 * formats のテストが使う。実在の患者データは入れない。
 * fixtures は src の外にあるので import ではなく fs で読む（Node でだけ動く。ブラウザのコードからは読み込まない）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FixedFields, ReportHeader } from "./format";
import type { FormatArgs } from "./formats";
import type { RecipientType, ReportDraft } from "./schema";

export const SAMPLE_FIXTURES = ["yamamoto-hanako", "sasaki-kiyoshi"] as const;
export type SampleFixture = (typeof SAMPLE_FIXTURES)[number];

/** 見本の薬局の連絡先（架空） */
export const SAMPLE_PHARMACY_CONTACT = "TEL 096-000-0000 / FAX 096-000-0001";

type Profile = {
  patient: ReportHeader["patient"];
  recipients: { careManager: string; doctor: string };
  pharmacy: string;
  reportDate: string;
  nextVisitDate: string;
  visitFrequency: { choice: string; note: string };
  dispensingForm: string;
  prescription: {
    date: string;
    prescriber: string;
    items: { drug: string; dose: string; usage: string; days: string }[];
    concomitant: string;
  };
  fixedFields: FixedFields;
};

// expected.json には根拠（evidence）が無いので空で補う。
const EMPTY_EVIDENCE = { medication: "", meals: "", excretion: "", sleep: "", mobility: "", tendency: "" };

function readJson(fixture: SampleFixture, file: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", fixture, file), "utf-8"));
}

// 読み込みはモジュールの先頭で同期的に行う（cacheComponents の下でも動的 API を使わない）
const LOADED = Object.fromEntries(
  SAMPLE_FIXTURES.map((f) => [f, { expected: readJson(f, "expected.json"), profile: readJson(f, "profile.json") as Profile }]),
) as Record<SampleFixture, { expected: Record<string, unknown>; profile: Profile }>;

/** 山本さん（ケアマネ宛て）・佐々木さん（医療機関宛て）の見本から、出力用の引数を組む（患者名は入れる指定） */
export function sampleFormatArgs(fixture: SampleFixture): FormatArgs {
  const { expected, profile: p } = LOADED[fixture];
  const recipientType: RecipientType = fixture === "yamamoto-hanako" ? "ケアマネ" : "医療機関";
  const header: ReportHeader = {
    addressee: recipientType === "ケアマネ" ? p.recipients.careManager : p.recipients.doctor,
    reportDate: p.reportDate,
    nextVisitDate: p.nextVisitDate,
    patient: {
      name: p.patient.name,
      kana: p.patient.kana,
      birthDate: p.patient.birthDate,
      sex: p.patient.sex,
      address: p.patient.address,
    },
    pharmacy: p.pharmacy,
    visitFrequency: p.visitFrequency.note ? `${p.visitFrequency.choice}（${p.visitFrequency.note}）` : p.visitFrequency.choice,
    dispensingForm: p.dispensingForm,
    prescriptionHeader: `処方日 ${p.prescription.date} ${p.prescription.prescriber}`,
    prescriptionItems: p.prescription.items.map((i) => [i.drug, i.dose, i.usage, i.days].join("　")).join("\n"),
    concomitant: p.prescription.concomitant,
  };
  const notes = expected.contactNotes;
  return {
    draft: { ...expected, evidence: EMPTY_EVIDENCE } as unknown as ReportDraft,
    header,
    fixedFields: p.fixedFields,
    recipientType,
    pharmacyContact: SAMPLE_PHARMACY_CONTACT,
    includePatientName: true,
    contactNotes: Array.isArray(notes) ? notes.filter((n): n is string => typeof n === "string") : undefined,
  };
}
