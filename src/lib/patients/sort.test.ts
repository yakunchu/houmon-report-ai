import { describe, expect, it } from "vitest";
import { facilitiesSorted, patientsInGroup, patientsInScope, sortByKana } from "./sort";
import { createEmptyFacility, createEmptyPatient, createEmptyStore } from "./store";
import type { Facility, Group, Patient, PatientStore } from "./types";

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

describe("patientsInScope / facilitiesSorted（v2）", () => {
  const inFacility = (id: string, name: string, kana: [string, string], facilityId: string | null): Patient => ({
    ...patient(id, name, "一郎", kana),
    residence: { kind: "facility", facilityId },
  });
  const suzuki = inFacility("suzuki", "鈴木", ["スズキ", "イチロウ"], "f1");
  const watanabe = inFacility("watanabe", "渡辺", ["ワタナベ", "イチロウ"], "f1");
  const orphan = inFacility("orphan", "伊藤", ["イトウ", "イチロウ"], null);
  const facility = (id: string, name: string, nameKana: string, extra: Partial<Facility> = {}): Facility => ({
    ...createEmptyFacility(),
    id,
    name,
    nameKana,
    ...extra,
  });
  const all = [yamamoto, sato, tanaka, suzuki, watanabe, orphan];
  const full = (extra: Partial<PatientStore> = {}): PatientStore => ({
    ...createEmptyStore(),
    patients: all,
    groups: [group("g1")],
    facilities: [facility("f1", "ひまわり荘", "ヒマワリソウ"), facility("f2", "あおぞら荘", "アオゾラソウ")],
    ...extra,
  });

  it("home は個人宅の全員だけ（施設の入居者は含まない）をカナ順で返す", () => {
    expect(ids(patientsInScope(full(), { kind: "home" }))).toEqual(["sato", "tanaka", "yamamoto"]);
  });

  it("home の手動並び: homeManualOrder の順 → 残りはカナ順、施設の人・存在しない id は無視", () => {
    const store = full({ homeSortMode: "manual", homeManualOrder: ["yamamoto", "suzuki", "ghost"] });
    expect(ids(patientsInScope(store, { kind: "home" }))).toEqual(["yamamoto", "sato", "tanaka"]);
  });

  it("home の kana のとき homeManualOrder は使わない", () => {
    const store = full({ homeSortMode: "kana", homeManualOrder: ["yamamoto"] });
    expect(ids(patientsInScope(store, { kind: "home" }))).toEqual(["sato", "tanaka", "yamamoto"]);
  });

  it("group は patientsInGroup と同じ（住まいを問わない）", () => {
    const store = full();
    expect(ids(patientsInScope(store, { kind: "group", groupId: "g1" }))).toEqual(ids(patientsInGroup(store, "g1")));
    const withGroup = full({ patients: [...all.slice(0, 5), { ...orphan, groupIds: ["g1"] }] });
    expect(ids(patientsInScope(withGroup, { kind: "group", groupId: "g1" }))).toEqual(["orphan", "sato", "yamamoto"]);
  });

  it("facility はその施設の入居者だけ。manual なら facility.manualOrder に従う", () => {
    expect(ids(patientsInScope(full(), { kind: "facility", facilityId: "f1" }))).toEqual(["suzuki", "watanabe"]);
    const manual = full({
      facilities: [facility("f1", "ひまわり荘", "ヒマワリソウ", { sortMode: "manual", manualOrder: ["watanabe"] }), facility("f2", "あおぞら荘", "アオゾラソウ")],
    });
    expect(ids(patientsInScope(manual, { kind: "facility", facilityId: "f1" }))).toEqual(["watanabe", "suzuki"]);
    expect(patientsInScope(manual, { kind: "facility", facilityId: "f2" })).toEqual([]);
  });

  it("存在しない施設・グループは空", () => {
    expect(patientsInScope(full(), { kind: "facility", facilityId: "none" })).toEqual([]);
    expect(patientsInScope(full(), { kind: "group", groupId: "none" })).toEqual([]);
  });

  it("facilitiesSorted はカナ順（カナが空なら名前）で、元の配列を変えない", () => {
    const store = full({ facilities: [facility("f1", "ひまわり荘", "ヒマワリソウ"), facility("f2", "さくら荘", ""), facility("f3", "あおぞら荘", "アオゾラソウ")] });
    expect(facilitiesSorted(store).map((f) => f.id)).toEqual(["f3", "f2", "f1"]);
    expect(store.facilities.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });
});
