import { describe, expect, it } from "vitest";
import type { ReportDraft } from "../report/schema";
import {
  CONTACT_NOTES_MAX,
  addContactNote,
  fillMissingContactNotes,
  normalizeContactNotes,
  patchContactNote,
  removeContactNote,
  tidyDraft,
} from "./draft-utils";

function withNotes(contactNotes: string[]): ReportDraft {
  return { contactNotes } as ReportDraft;
}

describe("normalizeContactNotes", () => {
  it("空の件と空白だけの件を除き、前後の空白を削る", () => {
    expect(normalizeContactNotes(["  A  ", "", "   ", "B"])).toEqual(["A", "B"]);
  });

  it("先頭 3 件に丸める（空を除いたあとの先頭 3 件）", () => {
    expect(normalizeContactNotes(["1", "", "2", "3", "4", "5"])).toEqual(["1", "2", "3"]);
    expect(CONTACT_NOTES_MAX).toBe(3);
  });

  it("undefined でも落ちない", () => {
    expect(normalizeContactNotes(undefined)).toEqual([]);
  });
});

describe("連絡事項の編集", () => {
  it("書き換え・追加・削除ができる", () => {
    let d = withNotes(["A"]);
    d = addContactNote(d);
    expect(d.contactNotes).toEqual(["A", ""]);
    d = patchContactNote(d, 1, "B");
    expect(d.contactNotes).toEqual(["A", "B"]);
    d = removeContactNote(d, 0);
    expect(d.contactNotes).toEqual(["B"]);
  });

  it("3 件あるときは追加できない", () => {
    const d = withNotes(["1", "2", "3"]);
    expect(addContactNote(d)).toBe(d);
  });

  it("tidyDraft は空の件を除いて丸める（他の欄は変えない）", () => {
    const d = { ...withNotes(["A", "", "B", "C", "D"]), mealsPerDay: { value: "3", note: "" } } as ReportDraft;
    const t = tidyDraft(d);
    expect(t.contactNotes).toEqual(["A", "B", "C"]);
    expect(t.mealsPerDay).toBe(d.mealsPerDay);
  });
});

describe("fillMissingContactNotes（連絡事項を足す前に保存した下書きの読み込み）", () => {
  it("contactNotes が無ければ空配列を補う", () => {
    expect(fillMissingContactNotes({ a: 1 })).toEqual({ a: 1, contactNotes: [] });
  });

  it("あればそのまま。オブジェクト以外もそのまま返す（検証は ReportDraftSchema が行う）", () => {
    const given = { contactNotes: ["x"] };
    expect(fillMissingContactNotes(given)).toBe(given);
    expect(fillMissingContactNotes(null)).toBeNull();
    expect(fillMissingContactNotes("s")).toBe("s");
  });
});
