import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReportDraftSchema } from "./schema";

function loadExpected(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", name, "expected.json"), "utf8")) as Record<string, unknown>;
}

/** 見本に evidence を足した、スキーマ全体を満たす下書き */
function fullDraft(name: string): Record<string, unknown> {
  const evidence = { medication: "", meals: "", excretion: "", sleep: "", mobility: "", tendency: "" };
  return { ...loadExpected(name), evidence };
}

describe("ReportDraftSchema の連絡事項（contactNotes）", () => {
  it("contactNotes は必須。無いと失敗する", () => {
    const rest = fullDraft("yamamoto-hanako");
    delete rest.contactNotes;
    expect(ReportDraftSchema.safeParse(rest).success).toBe(false);
  });

  it("文字列の配列なら通る（0 件も形式上は通り、件数は画面側で扱う）", () => {
    const base = fullDraft("yamamoto-hanako");
    expect(ReportDraftSchema.safeParse(base).success).toBe(true);
    expect(ReportDraftSchema.safeParse({ ...base, contactNotes: [] }).success).toBe(true);
    expect(ReportDraftSchema.safeParse({ ...base, contactNotes: [1] }).success).toBe(false);
  });

  it("3 本の見本の contactNotes が 1〜3 件で、空文字を含まない", () => {
    for (const name of ["yamamoto-hanako", "yamamoto-hanako-kikikaeshi", "sasaki-kiyoshi"]) {
      const parsed = ReportDraftSchema.parse(fullDraft(name));
      expect(parsed.contactNotes.length).toBeGreaterThanOrEqual(1);
      expect(parsed.contactNotes.length).toBeLessThanOrEqual(3);
      expect(parsed.contactNotes.every((n) => n.trim() !== "")).toBe(true);
    }
  });

  it("JSON Schema にしたとき contactNotes が required に入る（Structured Outputs は全項目 required）", () => {
    const js = z.toJSONSchema(ReportDraftSchema) as { required?: string[] };
    expect(js.required).toContain("contactNotes");
  });
});
