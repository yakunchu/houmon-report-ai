import { describe, expect, it } from "vitest";
import { compareTranscript, normalizeForCer } from "./cer";

describe("normalizeForCer（句読点・空白・全角半角を揃える）", () => {
  it("句読点と空白を除き、全角英数を半角にする", () => {
    expect(normalizeForCer("山本さん、こんにちは。この４週間、お薬は どうでしたか？")).toBe("山本さんこんにちはこの4週間お薬はどうでしたか");
  });
  it("長音「ー」は残す（カレンダー）", () => {
    expect(normalizeForCer("服薬カレンダー")).toBe("服薬カレンダー");
  });
  it("括弧・引用符・中黒も除く", () => {
    expect(normalizeForCer("「3日出なければ飲む」と（紙に）・書く")).toBe("3日出なければ飲むと紙に書く");
  });
  it("数字に挟まれた小数点・桁区切り・時刻のコロンは残す（用量の聞き違いを数えるため）", () => {
    expect(normalizeForCer("1.5錠を10:30に、1,000mg。")).toBe("1.5錠を10:30に1,000mg");
    expect(normalizeForCer("１．５錠")).toBe("1.5錠");
    expect(compareTranscript("1.5錠", "15錠").distance).toBe(1);
    expect(compareTranscript("10:30", "1030").distance).toBe(1);
    // 文末のピリオドや、数字に挟まれていないカンマは除く
    expect(normalizeForCer("3回、普通に食べよる.")).toBe("3回普通に食べよる");
  });
});

describe("compareTranscript（文字誤り率）", () => {
  it("完全一致なら誤り 0・一致率 1", () => {
    const r = compareTranscript("朝はバタバタして、薬を飲んだか分からんようになる。", "朝はバタバタして薬を飲んだか分からんようになる");
    expect(r.distance).toBe(0);
    expect(r.cer).toBe(0);
    expect(r.accuracy).toBe(1);
    expect(r.sub + r.ins + r.del).toBe(0);
    expect(r.segments).toEqual([{ op: "equal", ref: "朝はバタバタして薬を飲んだか分からんようになる", hyp: "朝はバタバタして薬を飲んだか分からんようになる" }]);
  });

  it("置換 1 文字を数える", () => {
    const r = compareTranscript("お通じはいかがですか", "お通じはいかかですか");
    expect(r).toMatchObject({ distance: 1, sub: 1, ins: 0, del: 0, refLength: 10 });
    expect(r.cer).toBeCloseTo(0.1);
    expect(r.segments.map((s) => s.op)).toEqual(["equal", "sub", "equal"]);
  });

  it("抜け（削除）と余分（挿入）を分けて数える", () => {
    const del = compareTranscript("3日に1回くらい", "3日に回くらい");
    expect(del).toMatchObject({ del: 1, ins: 0, sub: 0, distance: 1 });
    const ins = compareTranscript("3日に1回くらい", "3日に1回くらいね");
    expect(ins).toMatchObject({ ins: 1, del: 0, sub: 0, distance: 1 });
    expect(ins.segments[ins.segments.length - 1]).toEqual({ op: "ins", ref: "", hyp: "ね" });
  });

  it("漢数字と算用数字の違いは誤りに数える", () => {
    const r = compareTranscript("この4週間", "この四週間");
    expect(r.distance).toBe(1);
  });

  it("正解が空なら CER 0、文字起こしが空なら全部削除", () => {
    expect(compareTranscript("", "何か").cer).toBe(0);
    const r = compareTranscript("むせたりはせんよ", "");
    expect(r).toMatchObject({ del: 8, distance: 8, cer: 1, accuracy: 0 });
  });

  it("長い文（台本 1 本分）でも距離が対称で安定している", () => {
    const ref = "朝はバタバタして、薬を飲んだか分からんようになる。テレビを見てるうちに忘れてしまうとよ。".repeat(12);
    const hyp = "朝はバタバタして、薬を飲んだか分からんようになる。テレビを見てるうちに忘れてしまうとね。".repeat(12);
    const a = compareTranscript(ref, hyp);
    const b = compareTranscript(hyp, ref);
    expect(a.distance).toBe(12);
    expect(b.distance).toBe(12);
    expect(a.sub).toBe(12);
  });
});
