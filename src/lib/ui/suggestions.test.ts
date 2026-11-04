import { describe, expect, it } from "vitest";
import { looksLikePersonName, stripMaskTokens } from "./suggestions";

// すべて架空の例
describe("looksLikePersonName（家族の提案に氏名が混ざっていないか）", () => {
  it("続柄だけの文は氏名とみなさない", () => {
    expect(looksLikePersonName("長女が週末に服薬を確認")).toBe(false);
    expect(looksLikePersonName("娘さんが週末に来る")).toBe(false);
    expect(looksLikePersonName("お母さんと同居。ヘルパーさんが平日に訪問")).toBe(false);
    expect(looksLikePersonName("ケアマネジャーさんが月1回訪問")).toBe(false);
    expect(looksLikePersonName("")).toBe(false);
  });

  it("「○○さん」「○○様」「○○氏」の形があれば氏名とみなす", () => {
    expect(looksLikePersonName("田中さんが週末に確認")).toBe(true);
    expect(looksLikePersonName("長女の佐藤美咲さんが同居")).toBe(true);
    expect(looksLikePersonName("ミサキちゃんが来る")).toBe(true);
    expect(looksLikePersonName("高橋様の付き添い")).toBe(true);
  });
});

describe("stripMaskTokens", () => {
  it("記号を取り除き、空の括弧も消す", () => {
    expect(stripMaskTokens("【家族1】（長女）が週末に確認")).toBe("（長女）が週末に確認");
    expect(stripMaskTokens("長女（【家族1】）が確認")).toBe("長女が確認");
  });
});
