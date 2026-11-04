/**
 * 画面で持つ「基本情報」の型と選択肢（今回の訪問の作業用コピー）。
 * 患者リスト（src/lib/patients）が患者ごとのマスターで、選ぶとここに読み込み、保存すると書き戻す。
 * localStorage（端末内）にだけ保存し、
 * AI に送るのは buildContext() が選んだ項目だけ（氏名・住所・生年月日・宛名・薬局名は送らない）。
 */
import type { FamilyMember } from "@/lib/patients/types";
import type { RecipientType } from "@/lib/report/schema";

/**
 * 訪問頻度（「その他」は備考に「28日毎」のように書く）と調剤形態の選択肢。
 * 正本は schema.ts（患者リストと会話からの提案でも同じ値を使う）。名前は互換のため残している。
 */
export { VISIT_FREQUENCY as VISIT_FREQUENCIES, DISPENSING_FORM as DISPENSING_FORMS } from "../report/schema";

/** 性別（出力の患者欄に使う。任意） */
export const SEX_OPTIONS = ["女性", "男性"] as const;

/** 家族の実名と続柄（型は患者リストと同じ） */
export type { FamilyMember };

export type BasicInfo = {
  recipientType: RecipientType;

  // 患者（マスク用 + 出力の基本情報。API には送らない）
  patientFamilyName: string;
  patientGivenName: string;
  patientKana: string;
  /** YYYY-MM-DD */
  birthDate: string;
  sex: string;
  address: string;
  phone: string;

  // 家族
  /** 家族構成・関与（続柄のみ。API に送る） */
  family: string;
  /** 家族の実名と続柄（マスク用。API には送らない） */
  familyMembers: FamilyMember[];
  /** その他マスクしたい語（医療機関名など）。読点・カンマ・改行区切り */
  otherMaskWords: string;

  // AI に送る文脈
  visitFrequency: string;
  /** 訪問頻度が「その他」のときの補足（例: 28日毎） */
  visitFrequencyNote: string;
  dispensingForm: string;
  currentMedicationManager: string;
  currentManagementMethod: string;

  // 処方内容
  /** 出力用の見出し（処方日・処方医）。API には送らない */
  prescriptionHeader: string;
  /** 薬剤・量・用法・日数の一覧（1行1剤）。API に送る */
  prescription: string;
  /** 併用薬（出力用） */
  concomitant: string;

  // 出力用（API には送らない）
  addresseeCareManager: string;
  addresseeDoctor: string;
  pharmacy: string;
  /** YYYY-MM-DD（報告日 = 訪問日） */
  reportDate: string;
  /** YYYY-MM-DD */
  nextVisitDate: string;

  // 定型欄
  counselingTarget: string;
  genericPreference: string;
  medicineNotebook: string;
};

export const EMPTY_BASIC: BasicInfo = {
  recipientType: "ケアマネ",
  patientFamilyName: "",
  patientGivenName: "",
  patientKana: "",
  birthDate: "",
  sex: "",
  address: "",
  phone: "",
  family: "",
  familyMembers: [],
  otherMaskWords: "",
  visitFrequency: "",
  visitFrequencyNote: "",
  dispensingForm: "",
  currentMedicationManager: "",
  currentManagementMethod: "",
  prescriptionHeader: "",
  prescription: "",
  concomitant: "",
  addresseeCareManager: "",
  addresseeDoctor: "",
  pharmacy: "",
  reportDate: "",
  nextVisitDate: "",
  counselingTarget: "",
  genericPreference: "",
  medicineNotebook: "",
};
