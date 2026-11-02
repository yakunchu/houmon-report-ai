import { describe, expect, it } from "vitest";
import { checkQuoteInText, findMissingQuotes, splitQuotes } from "./quotes";

// 架空の会話の一部（fixtures/yamamoto-hanako/transcript.md と同じ文面）
const TRANSCRIPT = [
  "- 患者：朝はバタバタして、薬を飲んだか分からんようになる。テレビを見てるうちに忘れてしまうとよ。",
  "- 患者：3日に1回くらい。出んときはおなかが張って、ちょっと苦しか。",
].join("\n");

describe("splitQuotes", () => {
  it("「」で囲まれた引用を分ける", () => {
    expect(splitQuotes("「朝はバタバタして」「出んときはおなかが張って」")).toEqual([
      "朝はバタバタして",
      "出んときはおなかが張って",
    ]);
  });

  it("／で区切られた根拠を分ける", () => {
    expect(splitQuotes("3回、普通に食べよる／むせたりはせんよ")).toEqual(["3回、普通に食べよる", "むせたりはせんよ"]);
  });

  it("「」と／が混ざっていても分け、空要素は捨てる", () => {
    expect(splitQuotes("「A」／「B」\n")).toEqual(["A", "B"]);
    expect(splitQuotes("")).toEqual([]);
  });
});

describe("checkQuoteInText", () => {
  it("空白・句読点・「」を無視して部分一致する", () => {
    expect(checkQuoteInText("朝はバタバタして 薬を飲んだか分からんようになる", TRANSCRIPT)).toBe(true);
    expect(checkQuoteInText("「出んときは、おなかが張って」", TRANSCRIPT)).toBe(true);
  });

  it("原文に無い引用は false", () => {
    expect(checkQuoteInText("毎朝きちんと飲んでいる", TRANSCRIPT)).toBe(false);
  });

  it("全角半角の違いは吸収する", () => {
    expect(checkQuoteInText("３日に１回くらい", TRANSCRIPT)).toBe(true);
  });

  it("省略記号「…」で区切った各断片が原文にあれば true", () => {
    expect(checkQuoteInText("朝はバタバタして…忘れてしまうとよ", TRANSCRIPT)).toBe(true);
    expect(checkQuoteInText("朝はバタバタして…夜は眠れない", TRANSCRIPT)).toBe(false);
  });

  it("記号だけの引用は確かめようがないので true", () => {
    expect(checkQuoteInText("「」、。", TRANSCRIPT)).toBe(true);
  });
});

describe("findMissingQuotes", () => {
  it("原文に無い引用だけを返す", () => {
    const s = "「朝はバタバタして」「夜は眠れない」";
    expect(findMissingQuotes(s, TRANSCRIPT)).toEqual(["夜は眠れない"]);
  });

  it("すべて原文にあれば空配列", () => {
    expect(findMissingQuotes("「ちょっと苦しか」", TRANSCRIPT)).toEqual([]);
  });
});
