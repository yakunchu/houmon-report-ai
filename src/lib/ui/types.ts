/**
 * 画面で持つ「基本情報」の型と選択肢。
 * 薬局側の既存データ（レセコン相当）を手入力する欄。localStorage（端末内）にだけ保存し、
 * AI に送るのは buildContext() が選んだ項目だけ（氏名・住所・生年月日・宛名・薬局名は送らない）。
 */
import type { RecipientType } from "@/lib/report/schema";

/** 訪問頻度の選択肢（CLAUDE.md の表。「その他」は備考に「28日毎」のように書く） */
export const VISIT_FREQUENCIES = ["1週間毎", "2週間毎", "1か月毎", "その他"] as const;

/** 調剤形態の選択肢 */
export const DISPENSING_FORMS = ["一包化（別包有）", "一包化（別包無）", "ヒート"] as const;

/** 性別（出力の患者欄に使う。任意） */
export const SEX_OPTIONS = ["女性", "男性"] as const;

export type FamilyMember = {
  /** 実名（端末内のみ。マスク用） */
  name: string;
  /** 続柄（長女 など） */
  relation: string;
};

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
