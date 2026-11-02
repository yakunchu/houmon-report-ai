import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { containsOriginal, maskText, unmaskText } from "./mask";
import type { PersonalInfoDictionary } from "./types";

/** 架空の辞書（fixtures/yamamoto-hanako に対応） */
const dict: PersonalInfoDictionary = {
  patient: { familyName: "山本", givenName: "花子", kana: "ヤマモト ハナコ" },
  family: [{ name: "山本 美咲", relation: "長女" }],
  birthDate: "1940-04-01",
};

const transcript = readFileSync(
  fileURLToPath(new URL("../../../fixtures/yamamoto-hanako/transcript.md", import.meta.url)),
  "utf-8",
);

describe("台本のマスクと復元", () => {
  const result = maskText(transcript, dict);

  it("「山本さん」が「【患者A】さん」になり、元の氏名が残らない", () => {
    expect(result.masked).toContain("【患者A】さん、こんにちは");
    expect(result.masked).not.toContain("山本");
    expect(containsOriginal(result.masked, result.tokens)).toBe(false);
  });

  it("続柄語（娘）や一般語は壊さない", () => {
    expect(result.masked).toContain("娘と一緒じゃないと怖か");
    expect(result.masked).toContain("薬剤師：");
  });

  it("unmask で元の文字列と完全一致する（往復）", () => {
    // 見出しの「山本花子」と会話の「山本」は同じ【患者A】になり、1 つの記号は 1 つの元表記にしか戻せない。
    // そのため往復の完全一致は会話部分（「- 」で始まる行）で確認する
    const body = transcript
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .join("\n");
    const r = maskText(body, dict);
    expect(r.masked).toContain("【患者A】さん、こんにちは");
    expect(unmaskText(r.masked, r.tokens)).toBe(body);
  });

  it("全文では、同じ記号に複数の表記があると最初に出た表記へ戻る", () => {
    expect(result.tokens.map((t) => t.original)).toContain("山本花子");
    expect(unmaskText("【患者A】さん", result.tokens)).toBe("山本花子さん");
  });

  it("台本には辞書に無い名前が無いので警告は出ない", () => {
    expect(result.warnings).toEqual([]);
  });
});

describe("氏名・家族", () => {
  it("姓名・姓・名・カナ・ひらがながすべて【患者A】になり、tokens は重複しない", () => {
    const r = maskText("山本 花子、山本花子、山本、花子、ヤマモト ハナコ、ハナコ、やまもとさん", dict);
    expect(r.masked).toBe("【患者A】、【患者A】、【患者A】、【患者A】、【患者A】、【患者A】、【患者A】さん");
    const keys = r.tokens.map((t) => `${t.token}|${t.original}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.tokens.every((t) => t.token === "【患者A】" && t.kind === "patient")).toBe(true);
  });

  it("全角スペース・全角英数字でも一致し、他の文字は変えない", () => {
    const r = maskText("山本　花子さんＡ１", dict);
    expect(r.masked).toBe("【患者A】さんＡ１");
  });

  it("家族「美咲さん」は【家族1】さん、姓名も【家族1】", () => {
    const r = maskText("美咲さんが週末に来る。山本美咲は長女。", dict);
    expect(r.masked).toBe("【家族1】さんが週末に来る。【家族1】は長女。");
    expect(r.tokens.find((t) => t.token === "【家族1】")?.kind).toBe("family");
  });

  it("家族が複数でも配列順に【家族1】【家族2】", () => {
    const d: PersonalInfoDictionary = {
      ...dict,
      family: [
        { name: "山本 美咲", relation: "長女" },
        { name: "田中 太郎", relation: "孫" },
      ],
    };
    const r = maskText("太郎くんと美咲さんと田中さん", d);
    expect(r.masked).toBe("【家族2】くんと【家族1】さんと【家族2】さん");
  });

  it("1 文字の名前は敬称が続くときだけ置換する（一包化を壊さない）", () => {
    const d: PersonalInfoDictionary = { patient: { familyName: "林", givenName: "一" } };
    const r = maskText("一包化。林さんと一さん。", d);
    expect(r.masked).toBe("一包化。【患者A】さんと【患者A】さん。");
  });
});

describe("住所・その他", () => {
  const d: PersonalInfoDictionary = {
    ...dict,
    address: "熊本県熊本市中央区○○1丁目2番3号（架空）",
    others: ["みどり在宅クリニック", "あおぞら居宅介護支援事業所"],
  };

  it("住所はそのまま・番地までのゆるい一致で【住所】になる", () => {
    expect(maskText("熊本県熊本市中央区○○1丁目2番3号（架空）にお住まい", d).masked).toBe("【住所】にお住まい");
    expect(maskText("熊本市中央区○○1-2-3にお住まい", d).masked).toBe("【住所】にお住まい");
  });

  it("その他の語は【その他1】【その他2】", () => {
    const r = maskText("みどり在宅クリニックとあおぞら居宅介護支援事業所", d);
    expect(r.masked).toBe("【その他1】と【その他2】");
  });
});

describe("生年月日", () => {
  it.each(["昭和15年4月1日", "昭和１５年４月１日", "1940年4月1日", "1940/4/1", "1940-04-01", "S15.4.1"])(
    "%s は【生年月日】になる",
    (s) => {
      const r = maskText(`生まれは${s}です`, dict);
      expect(r.masked).toBe("生まれは【生年月日】です");
      expect(containsOriginal(r.masked, r.tokens)).toBe(false);
      expect(unmaskText(r.masked, r.tokens)).toBe(`生まれは${s}です`);
    },
  );

  it("辞書と違う日付（訪問日・次回日）は変えない", () => {
    const s = "訪問日は2026年11月5日、次回は令和8年12月3日、2026/11/5です";
    expect(maskText(s, dict).masked).toBe(s);
  });

  it("令和の元年表記も西暦に直して比較する", () => {
    const d: PersonalInfoDictionary = { patient: { familyName: "山本", givenName: "太郎" }, birthDate: "2019-05-01" };
    expect(maskText("令和元年5月1日", d).masked).toBe("【生年月日】");
    expect(maskText("令和1年5月2日", d).masked).toBe("令和1年5月2日");
  });
});

describe("電話・郵便番号", () => {
  it.each(["096-123-4567", "09012345678", "０９０−１２３４−５６７８", "(096)123-4567", "096 123 4567"])(
    "電話 %s は【電話】になる",
    (s) => {
      const r = maskText(`連絡先は${s}です`, dict);
      expect(r.masked).toBe("連絡先は【電話】です");
      expect(unmaskText(r.masked, r.tokens)).toBe(`連絡先は${s}です`);
    },
  );

  it.each(["〒860-0001", "860-0001", "８６０−０００１"])("郵便番号 %s は【郵便番号】になる", (s) => {
    const r = maskText(`宛先 ${s} です`, dict);
    expect(r.masked).toBe("宛先 【郵便番号】 です");
  });

  it("桁数が合わない数字は電話にしない", () => {
    const s = "28日分、4週間、1234567890123";
    expect(maskText(s, dict).masked).toBe(s);
  });
});

describe("警告（辞書に無い名前の可能性）", () => {
  it("辞書に無い「田中さん」が出る（index はマスク後テキスト内の位置）", () => {
    const r = maskText("山本さんの隣の田中さんが来た", dict);
    expect(r.masked).toBe("【患者A】さんの隣の田中さんが来た");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].text).toBe("田中");
    expect(r.masked.slice(r.warnings[0].index, r.warnings[0].index + 2)).toBe("田中");
  });

  it("様・先生・ちゃんも対象。カタカナの名前も出る", () => {
    const r = maskText("佐藤様、高橋先生、ミサキちゃん", dict);
    expect(r.warnings.map((w) => w.text)).toEqual(["佐藤", "高橋", "ミサキ"]);
  });

  it("薬剤師・娘・ヘルパーなどの一般語・続柄語は出ない", () => {
    const text =
      "薬剤師さん、娘さん、息子さん、ヘルパーさん、ケアマネさん、看護師さん、患者さん、お母さん、お父さん、" +
      "ご主人、お嬢さん、奥さん、先生、お疲れ様でした、皆様、たくさん、ちゃんと、様子";
    expect(maskText(text, dict).warnings).toEqual([]);
  });

  it("辞書で置換済みの人名は警告に出ない", () => {
    expect(maskText("山本さん、美咲さん", dict).warnings).toEqual([]);
  });
});

describe("空白なしの家族氏名", () => {
  const d: PersonalInfoDictionary = {
    patient: { familyName: "山本", givenName: "花子" },
    family: [{ name: "山本美咲", relation: "長女" }],
  };

  it("患者と同じ姓で始まれば、残りを名として置換する", () => {
    expect(maskText("山本美咲さん、美咲", d).masked).toBe("【家族1】さん、【家族1】");
    expect(maskText("美咲さん", d)).toMatchObject({ masked: "【家族1】さん", warnings: [] });
    expect(maskText("山本 美咲さん", d).masked).toBe("【家族1】さん");
  });

  it("患者と別の姓でも、末尾の部分文字列（名の候補）を置換する", () => {
    const d2: PersonalInfoDictionary = {
      patient: { familyName: "山本", givenName: "花子" },
      family: [{ name: "田中太郎", relation: "長男" }],
    };
    const r = maskText("田中太郎さん、太郎さん、田中 太郎", d2);
    expect(r.masked).not.toContain("太郎");
    expect(r.warnings).toEqual([]);
  });
});

describe("冪等性・復元", () => {
  it("2 回かけても同じ結果（記号の内側は触らない）", () => {
    const d: PersonalInfoDictionary = {
      ...dict,
      address: "熊本県熊本市（架空）",
      others: ["住所", "電話"],
    };
    const text = `${transcript}\n山本 花子 1940年4月1日 096-123-4567 〒860-0001 熊本県熊本市（架空）`;
    const once = maskText(text, d);
    const twice = maskText(once.masked, d);
    expect(twice.masked).toBe(once.masked);
    expect(twice.tokens).toEqual([]);
  });

  it("unmask は同じ記号が何回出ても全部戻し、tokens に無い記号は残す", () => {
    const tokens = maskText("山本さん、美咲さん", dict).tokens;
    expect(unmaskText("【患者A】さん／【患者A】さん／【家族1】さん／【家族9】", tokens)).toBe(
      "山本さん／山本さん／美咲さん／【家族9】",
    );
  });

  it("containsOriginal: 元の文字列が残っていれば true（空白の表記ゆれも）", () => {
    const { tokens } = maskText("山本さん", dict);
    expect(containsOriginal("山本さんが来た", tokens)).toBe(true);
    expect(containsOriginal("山 本さん", tokens)).toBe(true); // 空白を挟んだ表記ゆれも漏れとして扱う
    expect(containsOriginal("【患者A】さん", tokens)).toBe(false);
    expect(containsOriginal("山本 美咲", maskText("山本美咲", dict).tokens)).toBe(true);
  });
});
