import { describe, expect, it } from "vitest";
import { INTERVIEW_INTRO, INTERVIEW_STEPS, INTERVIEW_TIPS } from "./script";

describe("想定問答集のデータ", () => {
  it("手順は 16 件で、no が 1..16 の連番", () => {
    expect(INTERVIEW_STEPS).toHaveLength(16);
    expect(INTERVIEW_STEPS.map((s) => s.no)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it.each(INTERVIEW_STEPS.map((s) => [s.no, s] as const))("手順 %i は title・ask・example が空でなく、echo と fields がある", (_no, s) => {
    expect(s.title.trim()).not.toBe("");
    expect(s.ask.trim()).not.toBe("");
    expect(s.example.trim()).not.toBe("");
    expect(s.echo.length).toBeGreaterThanOrEqual(1);
    expect(s.fields.length).toBeGreaterThanOrEqual(1);
    expect(s.echo.every((e) => e.trim() !== "")).toBe(true);
  });

  it.each(INTERVIEW_STEPS.map((s) => [s.no, s] as const))("手順 %i の echo に「です」「ます」「ました」のいずれかで言い切る言い直しが 1 つ以上ある", (_no, s) => {
    expect(s.echo.some((e) => /です|ます|ました/.test(e))).toBe(true);
  });

  it("導入文と運用メモが空でない", () => {
    expect(INTERVIEW_INTRO.trim()).not.toBe("");
    expect(INTERVIEW_TIPS.length).toBeGreaterThan(0);
  });
});
