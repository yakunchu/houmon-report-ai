/**
 * 架空サンプル（山本花子さん）。デモ・動作確認用。すべて架空で、実在の人物・医療機関とは関係ありません。
 * 基本情報は fixtures/yamamoto-hanako/profile.json を読み込み、会話台本は transcript.md の本文を写している。
 * 正本は fixtures/ 側。台本を直すときは fixtures を直してからここへ写すこと。
 */
import profile from "../../../fixtures/yamamoto-hanako/profile.json";
import type { RecipientType } from "@/lib/report/schema";
import { EMPTY_BASIC, type BasicInfo } from "@/lib/ui/types";

/** 会話台本（架空）。fixtures/yamamoto-hanako/transcript.md の写し（先頭の「架空」の明記を含む） */
export const YAMAMOTO_TRANSCRIPT = `# 架空患者 山本花子さん（86歳女性）訪問時の会話台本

すべて架空です。実在の人物・医療機関とは関係ありません。
（熊本の方言を含みます。方言のままでも正しく読み取れることを確認してください）

- 薬剤師：山本さん、こんにちは。この4週間、お薬はどうでしたか？
- 患者：朝はバタバタして、薬を飲んだか分からんようになる。テレビを見てるうちに忘れてしまうとよ。
- 薬剤師：朝の分が4日分残ってますね。週に3回くらいでしょうか。ご飯は1日何回食べられてますか？
- 患者：3回、普通に食べよる。むせたりはせんよ。
- 薬剤師：お通じはいかがですか？
- 患者：3日に1回くらい。出んときはおなかが張って、ちょっと苦しか。寝る前の薬は、いつ飲んだらよかか分からんで、飲んでない。
- 薬剤師：夜は何回くらいトイレに起きますか？よく眠れてますか？
- 患者：2回くらいかな。でも夜はよう眠れるよ。昼ごはんの後に1時間くらい昼寝しよる。
- 薬剤師：腰の貼り薬はどうですか？外には出かけてますか？
- 患者：貼ると楽。家の中は歩けるけど、外は杖ついて、娘と一緒じゃないと怖か。薬は娘が週末に見てくれよる。
- 薬剤師：では服薬カレンダーを食卓の見えるところに掛けましょう。寝る前の薬は「3日出なければ飲む」と紙に書いておきますね。
- 患者：それなら分かりやすか。ありがとうね。`;

/** "2026-11-05" → "2026/11/05" */
function slashDate(iso: string): string {
  return iso.replaceAll("-", "/");
}

/** 氏名「山本 花子」を姓・名に分ける */
const [familyName = "", givenName = ""] = profile.patient.name.split(/\s+/);

const recipientType: RecipientType = "ケアマネ";

/** 架空の基本情報（profile.json から組み立て） */
export const YAMAMOTO_BASIC: BasicInfo = {
  ...EMPTY_BASIC,
  recipientType,
  patientFamilyName: familyName,
  patientGivenName: givenName,
  patientKana: profile.patient.kana,
  birthDate: profile.patient.birthDate,
  sex: profile.patient.sex,
  address: profile.patient.address,
  family: profile.family,
  visitFrequency: profile.visitFrequency.choice,
  visitFrequencyNote: profile.visitFrequency.note,
  dispensingForm: profile.dispensingForm,
  currentMedicationManager: profile.currentMedicationManager,
  currentManagementMethod: profile.currentManagementMethod,
  prescriptionHeader: `処方日 ${slashDate(profile.prescription.date)} ${profile.prescription.prescriber}`,
  prescription: profile.prescription.items
    .map((i) => [i.drug, i.dose, i.usage, i.days].join("　"))
    .join("\n"),
  concomitant: profile.prescription.concomitant,
  addresseeCareManager: profile.recipients.careManager,
  addresseeDoctor: profile.recipients.doctor,
  pharmacy: profile.pharmacy,
  reportDate: profile.reportDate,
  nextVisitDate: profile.nextVisitDate,
  counselingTarget: profile.fixedFields.counselingTarget,
  genericPreference: profile.fixedFields.genericPreference,
  medicineNotebook: profile.fixedFields.medicineNotebook,
};
