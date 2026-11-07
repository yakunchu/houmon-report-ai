/**
 * 架空サンプル②（佐々木清さん・医師宛）。「新しい患者」の流れのデモ用。すべて架空で、実在の人物・医療機関とは関係ありません。
 * 氏名・カナ・生年月日・宛名・処方だけを入れ、訪問頻度・調剤形態・服薬管理者・管理方法・家族は空欄にしておく
 * （下書きを作ると会話から読み取れた分が「AI の提案」として自動入力されるのを見せるため）。
 * 正本は fixtures/sasaki-kiyoshi/。台本を直すときは fixtures を直してからここへ写すこと。
 */
import profile from "../../../fixtures/sasaki-kiyoshi/profile.json";
import type { PatientExtras } from "@/lib/patients/types";
import type { RecipientType } from "@/lib/report/schema";
import { EMPTY_BASIC, type BasicInfo } from "@/lib/ui/types";

/** 会話台本（架空）。fixtures/sasaki-kiyoshi/transcript.md の写し（先頭の「架空」の明記を含む） */
export const SASAKI_TRANSCRIPT = `# 架空患者 佐々木清さん（83歳男性）訪問時の会話台本（医師宛の報告を想定）

すべて架空です。実在の人物・医療機関とは関係ありません。
（熊本の方言を含みます。妻が同席している場面です）

- 薬剤師：佐々木さん、こんにちは。2週間ぶりですね。お薬の袋、確認させてくださいね。
- 患者：夕方の分がいくらか残っとる。夕方はテレビの前でうとうとして、夜の薬ば忘れてしまう。
- 妻：私がパートで遅い日は、箱にセットしてあっても飲まんままになっとります。
- 薬剤師：夕食後の分が6日分残っていますね。週に2回くらいでしょうか。朝の分はきちんと飲めていますね。体の調子はどうですか？
- 患者：朝の薬ば飲んだ後、立つとふらっとする。それと夜中に4回は起きる。トイレが近か。
- 薬剤師：ふらつきと夜のトイレの回数は、先生に伝えて薬の量や時間を相談しますね。ご飯はどうですか？
- 患者：あんまり食欲がなか。朝は食べんで、昼と夜の2回。量も少なか。
- 妻：マグネシウムの大きか錠剤は飲みにくかごたる。喉に引っかかると言います。それと、お通じがゆるくて日に3回くらい。
- 薬剤師：錠剤が大きくて飲みにくいことと、お通じがゆるいことも先生に相談します。夜は眠れていますか？
- 患者：寝つきはよかばってん、夜中に目が覚めてそれから眠れん。昼寝はせん。
- 薬剤師：家の中の歩き方はどうですか？外には出ていますか？
- 患者：家の中は壁を伝えば歩ける。外は車いすで、こいつが押してくれる。
- 薬剤師：では配薬BOXの夕食後の段に目印を付けておきます。奥さん、夕食の後に一声かけてもらえますか。今日のお薬の説明は大丈夫でしたか？
- 患者：わかった。説明はよう分かった。
- 妻：声かけはします。よろしくお願いします。`;

function slashDate(iso: string): string {
  return iso.replaceAll("-", "/");
}

const [familyName = "", givenName = ""] = profile.patient.name.split(/\s+/);

const recipientType: RecipientType = "医療機関";

/** 入居する施設の名前（架空）。読み込み側が同名の施設を探し、無ければ作って facilityId を入れる */
export const SASAKI_FACILITY_NAME: string = profile.facilityName;

/** 住まい・訪問曜日・申し送り（施設・木曜。facilityId は読み込み側で施設を作ってから入れる。架空） */
export const SASAKI_EXTRAS: PatientExtras = {
  residence: { kind: "facility", facilityId: null },
  visitDays: [4],
  handoverNote: profile.handoverNote,
};

/**
 * 新しい患者として登録する直前の状態（基本情報の一部だけ入っている）。
 * 訪問頻度・調剤形態・服薬管理者・管理方法・家族は空欄＝会話からの提案で埋まる対象。
 */
export const SASAKI_NEW_PATIENT_BASIC: BasicInfo = {
  ...EMPTY_BASIC,
  recipientType,
  patientFamilyName: familyName,
  patientGivenName: givenName,
  patientKana: profile.patient.kana,
  birthDate: profile.patient.birthDate,
  sex: profile.patient.sex,
  address: profile.patient.address,
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
