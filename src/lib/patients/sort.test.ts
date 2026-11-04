import { describe, expect, it } from "vitest";
import { patientsInGroup, sortByKana } from "./sort";
import { createEmptyPatient, createEmptyStore } from "./store";
import type { Group, Patient, PatientStore } from "./types";

function patient(id: string, familyName: string, givenName: string, kana: [string, string], groupIds: string[] = []): Patient {
  return { ...createEmptyPatient(), id, familyName, givenName, familyNameKana: kana[0], givenNameKana: kana[1], groupIds };
}

const yamamoto = patient("yamamoto", "山本", "花子", ["ヤマモト", "ハナコ"], ["g1"]);
const sato = patient("sato", "佐藤", "太郎", ["サトウ", "タロウ"], ["g1", "g2"]);
const tanaka = patient("tanaka", "田中", "次郎", ["タナカ", "ジロウ"]);

function storeWith(groups: Group[], patients: Patient[] = [yamamoto, sato, tanaka]): PatientStore {
  return { ...createEmptyStore(), patients, groups };
}

function group(id: string, extra: Partial<Group> = {}): Group {
  return { id, name: id, sortMode: "kana", manualOrder: [], createdAt: "2026-11-04T00:00:00.000Z", ...extra };
}

const ids = (list: Patient[]) => list.map((p) => p.id);

describe("sortByKana", () => {
  it("ヤマモト・サトウ・タナカ → サトウ・タナカ・ヤマモト", () => {
    expect(ids(sortByKana([yamamoto, sato, tanaka]))).toEqual(["sato", "tanaka", "yamamoto"]);
  });

  it("姓が同じなら名のカナで並べる", () => {
    const a = patient("a", "佐藤", "次郎", ["サトウ", "ジロウ"]);
    const b = patient("b", "佐藤", "花子", ["サトウ", "ハナコ"]);
    const c = patient("c", "佐藤", "愛", ["サトウ", "アイ"]);
    expect(ids(sortByKana([b, a, c]))).toEqual(["c", "a", "b"]);
  });

  it("カナが空の人は氏名で比較して並ぶ", () => {
    const noKana = patient("nokana", "あいかわ", "みどり", ["", ""]);
    expect(ids(sortByKana([yamamoto, sato, noKana]))).toEqual(["nokana", "sato", "yamamoto"]);
  });

  it("元の配列を変更しない", () => {
    const src = [yamamoto, sato];
    sortByKana(src);
    expect(ids(src)).toEqual(["yamamoto", "sato"]);
  });
});

describe("patientsInGroup", () => {
  it("all は全員をカナ順で返す", () => {
    expect(ids(patientsInGroup(storeWith([group("g1")]), "all"))).toEqual(["sato", "tanaka", "yamamoto"]);
  });

  it("ungrouped はどのグループにも入っていない人だけ", () => {
    expect(ids(patientsInGroup(storeWith([group("g1")]), "ungrouped"))).toEqual(["tanaka"]);
  });

  it("グループ ID を渡すとそのグループの人だけ（kana 順）", () => {
    const store = storeWith([group("g1"), group("g2")]);
    expect(ids(patientsInGroup(store, "g1"))).toEqual(["sato", "yamamoto"]);
    expect(ids(patientsInGroup(store, "g2"))).toEqual(["sato"]);
  });

  it("manual は manualOrder の順に並べる", () => {
    const store = storeWith([group("g1", { sortMode: "manual", manualOrder: ["yamamoto", "sato"] })]);
    expect(ids(patientsInGroup(store, "g1"))).toEqual(["yamamoto", "sato"]);
  });

  it("manual で manualOrder に無い人は末尾にカナ順、グループ外の ID は無視する", () => {
    const extra = patient("suzuki", "鈴木", "一郎", ["スズキ", "イチロウ"], ["g1"]);
    const store = storeWith([group("g1", { sortMode: "manual", manualOrder: ["yamamoto", "gone"] })], [yamamoto, sato, extra]);
    expect(ids(patientsInGroup(store, "g1"))).toEqual(["yamamoto", "sato", "suzuki"]);
  });

  it("kana のとき manualOrder は使わない", () => {
    const store = storeWith([group("g1", { sortMode: "kana", manualOrder: ["yamamoto", "sato"] })]);
    expect(ids(patientsInGroup(store, "g1"))).toEqual(["sato", "yamamoto"]);
  });

  it("存在しないグループは空", () => {
    expect(patientsInGroup(storeWith([group("g1")]), "none")).toEqual([]);
  });
});
