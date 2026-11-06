import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { READING_LINES, READING_TEXT } from "./script";

describe("読み上げ台本は fixtures/yamamoto-hanako/transcript.md と同じ文", () => {
  it("話者とせりふが 1 行ずつ一致する", () => {
    const md = readFileSync(path.join(process.cwd(), "fixtures", "yamamoto-hanako", "transcript.md"), "utf8");
    const lines = md
      .split(/\r?\n/)
      .map((l) => /^- (薬剤師|患者)：(.+)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ speaker: m[1], text: m[2].trim() }));
    expect(lines.length).toBeGreaterThan(0);
    expect(READING_LINES).toEqual(lines);
  });

  it("正解テキストはせりふだけ（話者名を含まない）", () => {
    expect(READING_TEXT).not.toContain("薬剤師：");
    expect(READING_TEXT.split("\n")).toHaveLength(READING_LINES.length);
  });
});
