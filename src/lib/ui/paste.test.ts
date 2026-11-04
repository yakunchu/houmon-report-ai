import { describe, expect, it } from "vitest";
import { appendTranscript } from "./paste";

describe("appendTranscript", () => {
  it("欄が空なら、貼った文字（前後の空白を落としたもの）に置き換える", () => {
    expect(appendTranscript("", "  薬剤師: こんにちは。\n患者A: はい。  ")).toBe("薬剤師: こんにちは。\n患者A: はい。");
  });

  it("既に文章があれば、空行を 1 つ挟んで後ろに足す", () => {
    expect(appendTranscript("前半の会話。\n", "後半の会話。")).toBe("前半の会話。\n\n後半の会話。");
  });

  it("CRLF の改行は LF にそろえる", () => {
    expect(appendTranscript("", "一行目\r\n二行目\r三行目")).toBe("一行目\n二行目\n三行目");
  });

  it("貼る文字が空白だけなら、何も変えない", () => {
    expect(appendTranscript("そのまま", "   \n ")).toBe("そのまま");
  });
});
