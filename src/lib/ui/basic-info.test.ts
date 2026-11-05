import { describe, expect, it } from "vitest";
import { riskyPrescriptionLines } from "./basic-info";
import { REASON_DOCTOR, REASON_PATIENT } from "./prescription";

// すべて架空の行
describe("riskyPrescriptionLines（処方内容の欄に残った、人名・医療機関名・患者情報らしい行）", () => {
  it("手で打った・長押しで貼った医師名・医療機関名の行を見つける", () => {
    const r = riskyPrescriptionLines("アムロジピン錠5mg 朝食後\n熊本医療センター 田中\nセンノシド錠12mg 就寝前");
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe(REASON_DOCTOR);
    expect(r[0].line).toContain("熊本医療センター");
  });

  it("患者情報らしい行も見つける", () => {
    const r = riskyPrescriptionLines("氏名 架空 花子\nムコスタ錠100mg 朝食後");
    expect(r.map((x) => x.reason)).toEqual([REASON_PATIENT]);
  });

  it("見出し・空白行だけなら、確認は要らない", () => {
    expect(riskyPrescriptionLines("処方箋\n\nRp1\nムコスタ錠100mg 朝食後\n以下余白")).toEqual([]);
  });

  it("薬剤の行だけなら空", () => {
    expect(riskyPrescriptionLines("アムロジピン錠5mg 朝食後\nムコスタ錠100mg 朝食後")).toEqual([]);
    expect(riskyPrescriptionLines("")).toEqual([]);
  });
});
