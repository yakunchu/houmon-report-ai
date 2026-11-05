import { describe, expect, it } from "vitest";
import { compareContactNotes, compareDraft } from "./compare";
import type { ReportDraft } from "./schema";

describe("compareContactNotes", () => {
  it("見本が無くても落ちず、AI の出力だけを並べる", () => {
    const rows = compareContactNotes(undefined, ["残薬の日数調整をご検討いただきたい。", "特記事項なし"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ index: 1, expected: null, similarity: null });
    expect(rows[1].actual).toBe("特記事項なし");
  });

  it("見本があれば類似度を出し、件数が違えば多い方に合わせる", () => {
    const rows = compareContactNotes(["残薬4日分の日数調整をお願いします。"], ["残薬4日分の日数調整をお願いします。", "服薬状況は悪"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].similarity).toBe(1);
    expect(rows[1]).toMatchObject({ expected: null, similarity: null });
  });

  it("両方空なら行を作らない", () => {
    expect(compareContactNotes(undefined, [])).toEqual([]);
  });
});

describe("compareDraft は contactNotes の無い見本でも動く", () => {
  it("contactNotes を持たない見本どうしで比較できる", () => {
    const choice = { choice: "普通" as const, note: "" };
    const draft: Omit<ReportDraft, "evidence" | "basicInfoSuggestions" | "contactNotes"> = {
      medicationManager: { choice: "本人", note: "" },
      managementMethod: { choice: "カレンダー", note: "" },
      adherence: { choice: "良", note: "" },
      leftoverMedications: [],
      mealAmount: choice,
      mealsPerDay: { value: "3", note: "" },
      swallowing: { choice: "問題なくできる", note: "" },
      urinationFrequency: choice,
      bowelMovement: { choice: "快便", note: "" },
      daytimeSleep: { choice: "無", duration: "", note: "" },
      nightSleep: { choice: "良", note: "" },
      exercise: { choice: "問題なくできる", note: "" },
      mobility: { choice: "問題なくできる", note: "" },
      dailyTendency: { choice: "特になし", note: "" },
      soap: { s: "「はい」", o: "確認した。", a: "問題なし。", p: "経過をみる。" },
    };
    const rows = compareDraft(draft, draft);
    expect(rows.filter((r) => r.kind === "choice").every((r) => r.match === true)).toBe(true);
  });
});
