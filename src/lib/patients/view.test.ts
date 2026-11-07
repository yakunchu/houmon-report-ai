import { describe, expect, it } from "vitest";
import {
  facilitySectionsByGroup,
  facilitySectionsByWeekday,
  kanaRowOf,
  mergeSubsetOrder,
  moveItem,
  sectionsByGroup,
  sectionsByKana,
  sectionsByWeekday,
} from "./view";
import type { Facility, Group, Patient, PatientStore, Weekday } from "./types";

function patient(id: string, kana: string, extra: Partial<Patient> = {}): Patient {
  return {
    id,
    familyName: `姓${id}`,
    givenName: "",
    familyNameKana: kana,
    givenNameKana: "",
    groupIds: [],
    residence: { kind: "home", facilityId: null },
    visitDays: [],
    handoverNote: "",
    ...extra,
  } as unknown as Patient;
}

function facility(id: string, nameKana: string, extra: Partial<Facility> = {}): Facility {
  return {
    id,
    name: `施設${id}`,
    nameKana,
    groupIds: [],
    visitDays: [],
    sortMode: "kana",
    manualOrder: [],
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

function group(id: string, name: string): Group {
  return { id, name, sortMode: "kana", manualOrder: [], createdAt: "" };
}

function store(patients: Patient[], groups: Group[] = [], facilities: Facility[] = []): PatientStore {
  return {
    version: 2,
    patients,
    groups,
    facilities,
    homeSortMode: "kana",
    homeManualOrder: [],
    selectedPatientId: null,
  };
}

describe("kanaRowOf", () => {
  it.each([
    ["アサダ", "あ"],
    ["あべ", "あ"],
    ["ｱｲﾀﾞ", "あ"],
    ["ガトウ", "か"],
    ["ごとう", "か"],
    ["ザイ", "さ"],
    ["ダテ", "た"],
    ["バンバ", "は"],
    ["パク", "は"],
    ["ヴァイ", "あ"],
    ["ッタ", "た"],
    ["ャマ", "や"],
    ["ヲ", "わ"],
    ["ン", "わ"],
    ["ラ", "ら"],
  ])("%s は %s 行", (kana, row) => {
    expect(kanaRowOf(patient("x", kana))).toBe(row);
  });

  it("カナが空・記号・長音から始まるときは「他」", () => {
    expect(kanaRowOf(patient("x", "", { familyName: "" }))).toBe("他");
    expect(kanaRowOf(patient("x", "ー"))).toBe("他");
    expect(kanaRowOf(patient("x", "A"))).toBe("他");
    expect(kanaRowOf(patient("x", "（"))).toBe("他");
  });

  it("カナが空のときはカナで書かれた氏名で代用する", () => {
    expect(kanaRowOf(patient("x", "", { familyName: "さとう" }))).toBe("さ");
    expect(kanaRowOf(patient("x", "", { familyName: "山本" }))).toBe("他");
  });
});

describe("sectionsByKana", () => {
  it("入力の並びを保ち、行の順に並べ、空の行は出さず「他」は最後", () => {
    const ps = [patient("1", "カ"), patient("2", "ガ"), patient("3", ""), patient("4", "ア"), patient("5", "キ")];
    const secs = sectionsByKana(ps);
    expect(secs.map((s) => s.title)).toEqual(["あ", "か", "他"]);
    expect(secs[1].items.map((p) => p.id)).toEqual(["1", "2", "5"]);
    expect(secs[2].items.map((p) => p.id)).toEqual(["3"]);
  });

  it("空の入力は空", () => {
    expect(sectionsByKana([])).toEqual([]);
  });
});

describe("sectionsByWeekday", () => {
  it("月〜日の順、複数曜日は各曜日に出る、最後に曜日なし", () => {
    const ps = [
      patient("1", "ア", { visitDays: [0, 1] as Weekday[] }),
      patient("2", "イ", { visitDays: [3] as Weekday[] }),
      patient("3", "ウ"),
      patient("4", "エ", { visitDays: [1] as Weekday[] }),
    ];
    const secs = sectionsByWeekday(ps);
    expect(secs.map((s) => s.title)).toEqual(["月曜日", "水曜日", "日曜日", "曜日なし"]);
    expect(secs[0].items.map((p) => p.id)).toEqual(["1", "4"]);
    expect(secs[2].items.map((p) => p.id)).toEqual(["1"]);
    expect(secs[3].items.map((p) => p.id)).toEqual(["3"]);
  });

  it("不正な曜日だけの人は曜日なし", () => {
    const ps = [patient("1", "ア", { visitDays: [9] as unknown as Weekday[] })];
    expect(sectionsByWeekday(ps).map((s) => s.title)).toEqual(["曜日なし"]);
  });
});

describe("sectionsByGroup", () => {
  it("グループの順 → グループなし。空のグループは出さない", () => {
    const g1 = group("g1", "A班");
    const g2 = group("g2", "B班");
    const g3 = group("g3", "空");
    const ps = [
      patient("1", "ウ", { groupIds: ["g2"] }),
      patient("2", "ア", { groupIds: ["g1", "g2"] }),
      patient("3", "イ"),
      patient("4", "エ", { groupIds: ["gone"] }),
    ];
    const secs = sectionsByGroup(store(ps, [g1, g2, g3]), ps);
    expect(secs.map((s) => s.title)).toEqual(["A班", "B班", "グループなし"]);
    expect(secs[0].items.map((p) => p.id)).toEqual(["2"]);
    expect(secs[1].items.map((p) => p.id)).toEqual(["2", "1"]); // カナ順（ア → ウ）
    expect(secs[2].items.map((p) => p.id)).toEqual(["3", "4"]);
  });

  it("入力に含まれない人は出さない", () => {
    const g1 = group("g1", "A班");
    const ps = [patient("1", "ア", { groupIds: ["g1"] }), patient("2", "イ", { groupIds: ["g1"] })];
    const secs = sectionsByGroup(store(ps, [g1]), [ps[1]]);
    expect(secs[0].items.map((p) => p.id)).toEqual(["2"]);
  });
});

describe("施設の区分け", () => {
  it("グループ別", () => {
    const g1 = group("g1", "A班");
    const fs = [facility("a", "ア", { groupIds: ["g1"] }), facility("b", "イ"), facility("c", "ウ", { groupIds: ["g1"] })];
    const secs = facilitySectionsByGroup(store([], [g1], fs), fs);
    expect(secs.map((s) => s.title)).toEqual(["A班", "グループなし"]);
    expect(secs[0].items.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("曜日別", () => {
    const fs = [
      facility("a", "ア", { visitDays: [4, 1] as Weekday[] }),
      facility("b", "イ"),
      facility("c", "ウ", { visitDays: [1] as Weekday[] }),
    ];
    const secs = facilitySectionsByWeekday(fs);
    expect(secs.map((s) => s.title)).toEqual(["月曜日", "木曜日", "曜日なし"]);
    expect(secs[0].items.map((f) => f.id)).toEqual(["a", "c"]);
  });
});

describe("moveItem", () => {
  it("前へ・後ろへ動かす（元は変えない）", () => {
    const src = ["a", "b", "c", "d"];
    expect(moveItem(src, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(src, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(src).toEqual(["a", "b", "c", "d"]);
  });

  it("同じ位置・範囲外は変えない", () => {
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("mergeSubsetOrder", () => {
  it("画面に出ていない人の位置を動かさずに入れ替える", () => {
    expect(mergeSubsetOrder(["a", "x", "b", "y", "c"], ["c", "a", "b"])).toEqual(["c", "x", "a", "y", "b"]);
  });

  it("full に無い id は無視する", () => {
    expect(mergeSubsetOrder(["a", "b"], ["b", "zzz", "a"])).toEqual(["b", "a"]);
  });
});
