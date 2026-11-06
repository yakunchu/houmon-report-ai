import { describe, expect, it } from "vitest";
import {
  parseTranscriptFragment,
  parseTranscriptQuery,
  shortcutCallbackUrl,
  shortcutRunUrl,
  supportsShortcuts,
  SHORTCUT_NAME,
} from "./shortcut";

describe("shortcutRunUrl（Apple の run-shortcut の書式）", () => {
  it("名前を URL エンコードして shortcuts://run-shortcut?name= に付ける", () => {
    expect(shortcutRunUrl()).toBe(`shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`);
    expect(shortcutRunUrl("Lookup Goetta")).toBe("shortcuts://run-shortcut?name=Lookup%20Goetta");
  });
});

describe("shortcutCallbackUrl（x-callback-url で戻り先を渡す）", () => {
  it("x-success はアプリの /#t=、x-cancel はトップ。どちらも URL エンコードされる", () => {
    const url = shortcutCallbackUrl("https://192.168.1.5:3000/");
    expect(url.startsWith("shortcuts://x-callback-url/run-shortcut?")).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("name")).toBe(SHORTCUT_NAME);
    expect(params.get("x-success")).toBe("https://192.168.1.5:3000/#t=");
    expect(params.get("x-cancel")).toBe("https://192.168.1.5:3000/");
    // # はそのままでは別の意味になるので、必ずエンコードされている
    expect(url.includes("#")).toBe(false);
  });
});

describe("parseTranscriptFragment（# の後ろから文字起こしを取り出す）", () => {
  it("#t= の値を URL デコードし、改行をそろえて返す", () => {
    const text = "朝はバタバタして、薬を飲んだか分からんようになる。\r\n3回、普通に食べよる。";
    expect(parseTranscriptFragment(`#t=${encodeURIComponent(text)}`)).toBe(
      "朝はバタバタして、薬を飲んだか分からんようになる。\n3回、普通に食べよる。",
    );
  });
  it("x-callback の戻り（#t=?result=… や #t=&result=…）も読める", () => {
    expect(parseTranscriptFragment("#t=?result=%E3%81%82%E3%81%84")).toBe("あい");
    expect(parseTranscriptFragment("#t=&result=%E3%81%82")).toBe("あ");
    expect(parseTranscriptFragment("#result=%E3%81%82")).toBe("あ");
  });
  it("先頭の # が無くても、他のキーが混ざっていても読める", () => {
    expect(parseTranscriptFragment("x=1&t=%E3%81%82&y=2")).toBe("あ");
  });
  it("無い・空・壊れたエンコードは null", () => {
    expect(parseTranscriptFragment("")).toBeNull();
    expect(parseTranscriptFragment("#")).toBeNull();
    expect(parseTranscriptFragment("#step-2")).toBeNull();
    expect(parseTranscriptFragment("#t=")).toBeNull();
    expect(parseTranscriptFragment("#t=%20%20")).toBeNull();
    expect(parseTranscriptFragment("#t=%E3%81")).toBeNull();
  });
  it("+ は空白にしない（そのまま残す）", () => {
    expect(parseTranscriptFragment("#t=a+b")).toBe("a+b");
  });
});

describe("parseTranscriptQuery（?result= で届いた場合）", () => {
  it("result を読む。他のクエリは無視", () => {
    expect(parseTranscriptQuery("?result=%E3%81%82%0A%E3%81%84")).toBe("あ\nい");
    expect(parseTranscriptQuery("?a=1&result=%E3%81%82")).toBe("あ");
  });
  it("無ければ null", () => {
    expect(parseTranscriptQuery("")).toBeNull();
    expect(parseTranscriptQuery("?a=1")).toBeNull();
    expect(parseTranscriptQuery("?result=")).toBeNull();
  });
});

describe("supportsShortcuts（ショートカット App がある端末か）", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";
  const ipadAsMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
  it("iPhone・iPad（Mac を名乗る場合も）は true", () => {
    expect(supportsShortcuts(iphone)).toBe(true);
    expect(supportsShortcuts(ipadAsMac, "MacIntel")).toBe(true);
  });
  it("Windows・Android は false", () => {
    expect(supportsShortcuts(windows, "Win32")).toBe(false);
    expect(supportsShortcuts(android, "Linux armv8l")).toBe(false);
  });
});
