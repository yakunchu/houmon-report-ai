import { describe, expect, it } from "vitest";
import type { Patient } from "@/lib/patients/types";
import { UNSURE, type ReportDraft } from "../report/schema";
import {
  basicInfoToPatient,
  isSamePatientContent,
  joinKana,
  patientToBasicInfo,
  splitKana,
  todayIso,
} from "./patient-bridge";
import { autoFillBlanks, buildSuggestionItems, stripMaskTokens } from "./suggestions";
import { EMPTY_BASIC } from "./types";

// すべて架空
const base: Patient = {
  id: "p1",
  familyName: "山本",
  givenName: "花子",
  familyNameKana: "ヤマモト",
  givenNameKana: "ハナコ",
  birthDate: "1940-04-01",
  sex: "女性",
  address: "熊本県熊本市（架空）",
  phone: "",
  familyNote: "長女（別居）",
  familyMembers: [{ name: "山本 良子", relation: "長女" }],
  otherMaskWords: ["みどり在宅クリニック", "あおぞら居宅介護支援事業所"],
  recipients: { careManager: "ケアマネ宛名", doctor: "医師宛名" },
  visitFrequency: { choice: "その他", note: "28日毎" },
  dispensingForm: "一包化（別包有）",
  medicationManager: "本人",
  managementMethod: "",
  prescription: { header: "処方日 2026/11/05", items: "アムロジピン錠 5mg", concomitant: "なし" },
  fixedFields: { counselingTarget: "本人", genericPreference: "希望", medicineNotebook: "シール貼付" },
  groupIds: ["g1"],
  memo: "メモ",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const visit = {
  recipientType: "医療機関" as const,
  reportDate: "2026-11-05",
  nextVisitDate: "2026-12-03",
  pharmacy: "架空薬局",
};

describe("patient-bridge", () => {
  it("患者 → 作業コピー → 患者で中身が保たれる", () => {
    const basic = patientToBasicInfo(base, visit);
    expect(basic.patientKana).toBe("ヤマモト ハナコ");
    expect(basic.otherMaskWords).toBe("みどり在宅クリニック、あおぞら居宅介護支援事業所");
    expect(basic.recipientType).toBe("医療機関");
    expect(basic.pharmacy).toBe("架空薬局");
    const back = basicInfoToPatient(basic, base);
    expect(isSamePatientContent(back, base)).toBe(true);
  });

  it("基本情報の値で上書きし、id・グループ・作成日時・メモは base を保つ", () => {
    const basic = { ...patientToBasicInfo(base, visit), patientFamilyName: "佐藤", patientKana: "サトウ ミワ" };
    const p = basicInfoToPatient(basic, base);
    expect(p.familyName).toBe("佐藤");
    expect(p.familyNameKana).toBe("サトウ");
    expect(p.givenNameKana).toBe("ミワ");
    expect(p.id).toBe("p1");
    expect(p.groupIds).toEqual(["g1"]);
    expect(p.memo).toBe("メモ");
    expect(p.createdAt).toBe(base.createdAt);
    expect(isSamePatientContent(p, base)).toBe(false);
  });

  it("カナは空白で分け、空白が無ければ姓カナに全部入れる", () => {
    expect(splitKana("ヤマモト　ハナコ")).toEqual({ family: "ヤマモト", given: "ハナコ" });
    expect(splitKana("ヤマモトハナコ")).toEqual({ family: "ヤマモトハナコ", given: "" });
    expect(splitKana("  ")).toEqual({ family: "", given: "" });
    expect(joinKana("ヤマモト", "")).toBe("ヤマモト");
  });

  it("訪問ごとの項目は患者に入らない", () => {
    const p = basicInfoToPatient({ ...EMPTY_BASIC, ...visit, patientFamilyName: "山本" }, base);
    expect(JSON.stringify(p)).not.toContain("架空薬局");
    expect(JSON.stringify(p)).not.toContain("2026-12-03");
  });

  it("今日の日付を YYYY-MM-DD で返す", () => {
    expect(todayIso(new Date(2026, 10, 4))).toBe("2026-11-04");
  });
});

type SuggestionOverrides = {
  visitFrequency?: { choice: string; note: string };
  dispensingForm?: { choice: string; note: string };
  family?: string;
};

function draftWith(overrides: SuggestionOverrides = {}): ReportDraft {
  const choice = (c: string, note = "") => ({ choice: c, note });
  const draft = {
    medicationManager: choice("本人", "長女が週末に確認"),
    managementMethod: choice("カレンダー"),
    adherence: choice("悪"),
    leftoverMedications: [],
    mealAmount: choice("普通"),
    mealsPerDay: { value: "3", note: "" },
    swallowing: choice("問題なくできる"),
    urinationFrequency: choice("普通"),
    bowelMovement: choice("便秘"),
    daytimeSleep: { choice: "有", duration: "1時間0分", note: "" },
    nightSleep: choice("良"),
    exercise: choice("大体できる"),
    mobility: choice("あまりできない"),
    dailyTendency: choice("有"),
    soap: { s: "", o: "", a: "", p: "" },
    contactNotes: ["特記事項なし"],
    evidence: { medication: "", meals: "", excretion: "", sleep: "", mobility: "", tendency: "" },
    basicInfoSuggestions: {
      visitFrequency: overrides.visitFrequency ?? choice("その他", "28日毎"),
      dispensingForm: overrides.dispensingForm ?? choice(UNSURE),
      family: overrides.family ?? "長女が週末に服薬を確認",
    },
  };
  return draft as ReportDraft;
}

describe("suggestions", () => {
  it("空欄だけに自動入力し、入れた項目を返す（要確認は入れない）", () => {
    const { basic, filled } = autoFillBlanks({ ...EMPTY_BASIC, patientFamilyName: "山本" }, draftWith());
    expect(basic.visitFrequency).toBe("その他");
    expect(basic.visitFrequencyNote).toBe("28日毎");
    expect(basic.dispensingForm).toBe("");
    expect(basic.currentMedicationManager).toBe("本人");
    expect(basic.currentManagementMethod).toBe("カレンダー");
    expect(basic.family).toBe("長女が週末に服薬を確認");
    expect(filled).toEqual(
      expect.arrayContaining([
        "visitFrequency",
        "visitFrequencyNote",
        "currentMedicationManager",
        "currentManagementMethod",
        "family",
      ]),
    );
    expect(filled).not.toContain("dispensingForm");
  });

  it("値がある項目は上書きしない", () => {
    const start = { ...EMPTY_BASIC, visitFrequency: "1週間毎", currentMedicationManager: "家族", family: "次女" };
    const { basic, filled } = autoFillBlanks(start, draftWith());
    expect(basic.visitFrequency).toBe("1週間毎");
    expect(basic.currentMedicationManager).toBe("家族");
    expect(basic.family).toBe("次女");
    expect(filled).toEqual(["currentManagementMethod"]);
  });

  it("差のある項目は一覧に出る（記録と会話の両方）", () => {
    const start = { ...EMPTY_BASIC, visitFrequency: "1週間毎" };
    const item = buildSuggestionItems(start, draftWith()).find((i) => i.key === "visitFrequency");
    expect(item?.current).toBe("1週間毎");
    expect(item?.suggested).toBe("その他（28日毎）");
  });

  it("記号は基本情報に入れない", () => {
    expect(stripMaskTokens("【家族1】が週末に確認（【患者A】の長女）")).toBe("が週末に確認（の長女）");
    const { basic } = autoFillBlanks(EMPTY_BASIC, draftWith({ family: "長女【家族1】が確認" }));
    expect(basic.family).toBe("長女が確認");
  });
});
