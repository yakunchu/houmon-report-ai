/**
 * 架空サンプルの一覧（デモ・動作確認用）。すべて架空。
 * - yamamoto: 登録済みの患者の流れ（患者リストに追加して選ぶ。ケアマネ宛）
 * - sasaki: 新しい患者の流れ（氏名・処方だけ入った未登録の状態から、会話で基本情報が自動入力されるのを見せる。医師宛）
 */
import type { BasicInfo } from "@/lib/ui/types";
import type { PatientExtras } from "@/lib/patients/types";
import { SASAKI_EXTRAS, SASAKI_FACILITY_NAME, SASAKI_NEW_PATIENT_BASIC, SASAKI_TRANSCRIPT } from "./sasaki";
import { YAMAMOTO_BASIC, YAMAMOTO_EXTRAS, YAMAMOTO_TRANSCRIPT } from "./yamamoto";

export type SampleId = "yamamoto" | "sasaki";

export type Sample = {
  id: SampleId;
  /** ボタンの表示（短く） */
  label: string;
  /** 何を見せるサンプルか（補足） */
  description: string;
  basic: BasicInfo;
  transcript: string;
  /** true: 患者リストに登録せず「新しい患者」として開く */
  asNewPatient: boolean;
  /** 住まい・訪問曜日・申し送り（施設のときの residence.facilityId は null。施設は facilityName から作る） */
  extras: PatientExtras;
  /** 施設に入るサンプルのときの施設名（架空） */
  facilityName?: string;
};

export const SAMPLES: readonly Sample[] = [
  {
    id: "yamamoto",
    label: "架空サンプル① 山本花子さん",
    description: "登録済みの患者・ケアマネ宛",
    basic: YAMAMOTO_BASIC,
    transcript: YAMAMOTO_TRANSCRIPT,
    asNewPatient: false,
    extras: YAMAMOTO_EXTRAS,
  },
  {
    id: "sasaki",
    label: "架空サンプル② 佐々木清さん",
    description: "新しい患者・医師宛（会話から基本情報が自動入力される）",
    basic: SASAKI_NEW_PATIENT_BASIC,
    transcript: SASAKI_TRANSCRIPT,
    asNewPatient: true,
    extras: SASAKI_EXTRAS,
    facilityName: SASAKI_FACILITY_NAME,
  },
];

export function findSample(id: SampleId): Sample {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown sample: ${id}`);
  return s;
}
