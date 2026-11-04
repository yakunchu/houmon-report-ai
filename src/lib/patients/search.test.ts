import { describe, expect, it } from "vitest";
import { calcAge, formatBirthDate, normalizeKana, searchPatients } from "./search";
import { createEmptyPatient } from "./store";
import type { Patient } from "./types";

function patient(id: string, familyName: string, givenName: string, kana: [string, string], birthDate: string): Patient {
  return { ...createEmptyPatient(), id, familyName, givenName, familyNameKana: kana[0], givenNameKana: kana[1], birthDate };
}

// 架空の患者
const yamamoto = patient("yamamoto", "山本", "花子", ["ヤマモト", "ハナコ"], "1940-04-01");
const sato = patient("sato", "佐藤", "太郎", ["サトウ", "タロウ"], "1951-11-23");
const tanaka = patient("tanaka", "田中", "次郎", ["タナカ", "ジロウ"], "1940-12-05");
const all = [yamamoto, sato, tanaka];
const ids = (list: Patient[]) => list.map((p) => p.id);

describe("searchPatients: 氏名・カナ", () => {
  it("空の query は全員", () => {
    expect(ids(searchPatients(all, ""))).toEqual(["yamamoto", "sato", "tanaka"]);
    expect(ids(searchPatients(all, "  　 "))).toEqual(["yamamoto", "sato", "tanaka"]);
  });

  it("姓・名・姓名（空白あり無し）で当たる", () => {
    expect(ids(searchPatients(all, "山本"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "花子"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "山本花子"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "山本 花子"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "山本　花子"))).toEqual(["yamamoto"]);
  });

  it("カナはカタカナ・ひらがな・半角カナのどれでも当たる", () => {
    expect(ids(searchPatients(all, "ヤマモト"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "やまもと"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "ﾔﾏﾓﾄ"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "さとう"))).toEqual(["sato"]);
    expect(ids(searchPatients(all, "やまもとはなこ"))).toEqual(["yamamoto"]);
  });

  it("部分一致する", () => {
    expect(ids(searchPatients(all, "ろう"))).toEqual(["sato", "tanaka"]);
  });

  it("当たらなければ空", () => {
    expect(searchPatients(all, "鈴木")).toEqual([]);
  });
});

describe("searchPatients: 生年月日", () => {
  it("西暦の年・年月・年月日", () => {
    expect(ids(searchPatients(all, "1940"))).toEqual(["yamamoto", "tanaka"]);
    expect(ids(searchPatients(all, "1940-04"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "1940/4/1"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "1940年4月1日"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "1940年4月"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "19401205"))).toEqual(["tanaka"]);
    expect(searchPatients(all, "1940/4/2")).toEqual([]);
  });

  it("4 桁未満の年は前方一致", () => {
    expect(ids(searchPatients(all, "195"))).toEqual(["sato"]);
  });

  it("和暦（昭和15年4月1日・S15.4.1・昭和15）", () => {
    expect(ids(searchPatients(all, "昭和15"))).toEqual(["yamamoto", "tanaka"]);
    expect(ids(searchPatients(all, "昭和15年4月1日"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "S15.4.1"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "s15"))).toEqual(["yamamoto", "tanaka"]);
    expect(ids(searchPatients(all, "昭和26年11月"))).toEqual(["sato"]);
    expect(searchPatients(all, "昭和16")).toEqual([]);
  });

  it("元号の換算（明治・大正・平成・令和・元年）", () => {
    const meiji = patient("m", "明治", "一", ["メイジ", "ハジメ"], "1900-01-01"); // 明治33
    const taisho = patient("t", "大正", "二", ["タイショウ", "ジ"], "1920-01-01"); // 大正9
    const heisei = patient("h", "平成", "三", ["ヘイセイ", "ミ"], "1989-06-01"); // 平成元
    const reiwa = patient("r", "令和", "四", ["レイワ", "シ"], "2019-06-01"); // 令和元
    const list = [meiji, taisho, heisei, reiwa];
    expect(ids(searchPatients(list, "明治33"))).toEqual(["m"]);
    expect(ids(searchPatients(list, "大正9年"))).toEqual(["t"]);
    expect(ids(searchPatients(list, "平成元年"))).toEqual(["h"]);
    expect(ids(searchPatients(list, "令和元"))).toEqual(["r"]);
  });

  it("生年月日が空・不正な患者は日付検索に当たらない", () => {
    const none = patient("none", "鈴木", "一郎", ["スズキ", "イチロウ"], "");
    expect(searchPatients([none], "1940")).toEqual([]);
  });
});

describe("searchPatients: 複数語は AND", () => {
  it("氏名と生年月日の組み合わせ", () => {
    expect(ids(searchPatients(all, "山本 1940"))).toEqual(["yamamoto"]);
    expect(ids(searchPatients(all, "田中 昭和15"))).toEqual(["tanaka"]);
    expect(searchPatients(all, "山本 1951")).toEqual([]);
  });

  it("1 語でも当たらない語があれば除外", () => {
    expect(ids(searchPatients(all, "1940 ろう"))).toEqual(["tanaka"]);
  });
});

describe("normalizeKana", () => {
  it("ひらがな・半角カナ・全角スペースをそろえる", () => {
    expect(normalizeKana("やまもと")).toBe("ヤマモト");
    expect(normalizeKana("ﾔﾏﾓﾄ")).toBe("ヤマモト");
    expect(normalizeKana("　ヤマモト　")).toBe("ヤマモト");
    expect(normalizeKana("ヤマ　モト")).toBe("ヤマ モト");
  });
});

describe("formatBirthDate", () => {
  it("西暦と和暦を並べる", () => {
    expect(formatBirthDate("1940-04-01")).toBe("1940年4月1日（昭和15年）");
    expect(formatBirthDate("1951-11-23")).toBe("1951年11月23日（昭和26年）");
    expect(formatBirthDate("1995-02-03")).toBe("1995年2月3日（平成7年）");
    expect(formatBirthDate("2020-01-05")).toBe("2020年1月5日（令和2年）");
    expect(formatBirthDate("1905-03-10")).toBe("1905年3月10日（明治38年）");
    expect(formatBirthDate("1915-03-10")).toBe("1915年3月10日（大正4年）");
  });

  it("元号の境目は日付で判定し、1 年は元年と表示する", () => {
    expect(formatBirthDate("1989-01-07")).toBe("1989年1月7日（昭和64年）");
    expect(formatBirthDate("1989-01-08")).toBe("1989年1月8日（平成元年）");
    expect(formatBirthDate("2019-05-01")).toBe("2019年5月1日（令和元年）");
  });

  it("空は空文字、明治より前と不正な値は西暦だけ（または入力のまま）", () => {
    expect(formatBirthDate("")).toBe("");
    expect(formatBirthDate("1850-01-01")).toBe("1850年1月1日");
    expect(formatBirthDate("1940-02-30")).toBe("1940-02-30");
    expect(formatBirthDate("abc")).toBe("abc");
  });
});

describe("calcAge", () => {
  const asOf = new Date(2026, 10, 4); // 2026-11-04

  it("満年齢を数える（誕生日の前後）", () => {
    expect(calcAge("1940-04-01", asOf)).toBe(86);
    expect(calcAge("1940-11-04", asOf)).toBe(86); // 当日で加算
    expect(calcAge("1940-11-05", asOf)).toBe(85); // 翌日はまだ
    expect(calcAge("1940-12-05", asOf)).toBe(85);
  });

  it("うるう日生まれでも数えられる", () => {
    expect(calcAge("2000-02-29", new Date(2026, 1, 28))).toBe(25);
    expect(calcAge("2000-02-29", new Date(2026, 2, 1))).toBe(26);
  });

  it("空・不正・未来の日付は null", () => {
    expect(calcAge("", asOf)).toBeNull();
    expect(calcAge("abc", asOf)).toBeNull();
    expect(calcAge("1940-02-30", asOf)).toBeNull();
    expect(calcAge("2030-01-01", asOf)).toBeNull();
    expect(calcAge("1940-04-01", new Date("invalid"))).toBeNull();
  });
});
