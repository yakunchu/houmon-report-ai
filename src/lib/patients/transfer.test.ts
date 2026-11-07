import { describe, expect, it } from "vitest";
import { createEmptyFacility, createEmptyPatient, createEmptyStore } from "./store";
import { MAX_GROUPS, MAX_LIST_ITEMS, MAX_PATIENTS, MAX_STRING_LENGTH, exportFileName, exportStore, mergeStores, parseExport } from "./transfer";
import type { ExportFile, Facility, Group, Patient, PatientStore } from "./types";

/* 架空データのみ */

const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-06-01T00:00:00.000Z";

function patient(id: string, familyName: string, givenName: string, extra: Partial<Patient> = {}): Patient {
  return {
    ...createEmptyPatient(),
    id,
    familyName,
    givenName,
    familyNameKana: "テスト",
    givenNameKana: "タロウ",
    birthDate: "1940-04-01",
    createdAt: OLD,
    updatedAt: OLD,
    ...extra,
  };
}

function group(id: string, name: string, extra: Partial<Group> = {}): Group {
  return { id, name, sortMode: "kana", manualOrder: [], createdAt: OLD, ...extra };
}

function store(patients: Patient[], groups: Group[] = [], selectedPatientId: string | null = null): PatientStore {
  return { ...createEmptyStore(), patients, groups, selectedPatientId };
}

function facility(id: string, name: string, extra: Partial<Facility> = {}): Facility {
  return { ...createEmptyFacility(), id, name, createdAt: OLD, updatedAt: OLD, ...extra };
}

function fileOf(patients: Patient[], groups: Group[] = [], facilities: Facility[] = []): ExportFile {
  return { app: "houmon-report-ai", kind: "patient-list", version: 2, exportedAt: NEW, patients, groups, facilities };
}

/** ファイルの中身を直接組み立てる（parse のテスト用） */
function rawText(over: Record<string, unknown>): string {
  return JSON.stringify({ app: "houmon-report-ai", kind: "patient-list", version: 1, exportedAt: NEW, patients: [], groups: [], ...over });
}

describe("exportStore / exportFileName", () => {
  it("selectedPatientId を含めず、整形した JSON にする", () => {
    const text = exportStore(store([patient("p1", "山田", "太郎")], [], "p1"), NEW);
    const obj = JSON.parse(text);
    expect(obj).toMatchObject({ app: "houmon-report-ai", kind: "patient-list", version: 2, exportedAt: NEW, facilities: [] });
    expect(obj).not.toHaveProperty("selectedPatientId");
    expect(text).toContain("\n  ");
  });

  it("ファイル名はローカル時刻の YYYYMMDD-HHMM", () => {
    const d = new Date(2026, 10, 4, 9, 5, 0); // 2026-11-04 09:05（ローカル）
    expect(exportFileName(d.toISOString())).toBe("houmon-report-ai_患者リスト_20261104-0905.json");
  });
});

describe("export → parse の往復", () => {
  it("患者 2 人・グループ 1 つ・手動並びがそのまま戻る", () => {
    const g = group("g1", "東地区", { sortMode: "manual", manualOrder: ["p2", "p1"] });
    const s = store(
      [
        patient("p1", "山田", "太郎", { groupIds: ["g1"], memo: "架空メモ", familyMembers: [{ name: "山田花子", relation: "妻" }] }),
        patient("p2", "鈴木", "次郎", { groupIds: ["g1"], sex: "男性" }),
      ],
      [g],
    );
    const r = parseExport(exportStore(s, NEW));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.file.exportedAt).toBe(NEW);
    expect(r.file.patients).toEqual(s.patients);
    expect(r.file.groups).toEqual(s.groups);
  });
});

describe("parseExport の拒否", () => {
  it("壊れた JSON", () => {
    const r = parseExport("{not json");
    expect(r).toEqual({ ok: false, message: "ファイルの形式が読めません（JSON ではありません）" });
  });

  it("別アプリ・別種のファイル", () => {
    for (const text of [rawText({ app: "other-app" }), rawText({ kind: "report" }), "[]", "null", '"x"']) {
      const r = parseExport(text);
      expect(r).toEqual({ ok: false, message: "このアプリの患者リストのファイルではありません" });
    }
  });

  it("未知の version", () => {
    expect(parseExport(rawText({ version: 3 }))).toEqual({ ok: false, message: "対応していない版です（version 3）" });
  });

  it("10 MB 超", () => {
    const r = parseExport(" ".repeat(10 * 1024 * 1024 + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("10 MB");
  });

  it("patients / groups が配列でない", () => {
    expect(parseExport(rawText({ patients: {} })).ok).toBe(false);
  });
});

describe("parseExport の件数・長さの上限", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, familyName: "架空", givenName: String(i) }));

  it("患者が上限ちょうどなら通り、超えたら拒否", () => {
    expect(parseExport(rawText({ patients: many(MAX_PATIENTS) })).ok).toBe(true);
    expect(parseExport(rawText({ patients: many(MAX_PATIENTS + 1) }))).toEqual({ ok: false, message: "患者が多すぎます（5,000 人まで）" });
  });

  it("グループが上限を超えたら拒否", () => {
    const groups = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
    expect(parseExport(rawText({ groups }))).toEqual({ ok: false, message: "グループが多すぎます（500 件まで）" });
  });

  it("1 人あたりの家族・マスク語が多すぎる", () => {
    const words = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, i) => `語${i}`);
    const r = parseExport(rawText({ patients: [{ id: "a", familyName: "架空", otherMaskWords: words }] }));
    expect(r.ok).toBe(false);
    const members = words.map((w) => ({ name: w, relation: "長女" }));
    expect(parseExport(rawText({ patients: [{ id: "a", familyName: "架空", familyMembers: members }] })).ok).toBe(false);
  });

  it("文字列が長すぎる（患者・グループ）", () => {
    const long = "あ".repeat(MAX_STRING_LENGTH + 1);
    expect(parseExport(rawText({ patients: [{ id: "a", familyName: "架空", memo: long }] })).ok).toBe(false);
    expect(parseExport(rawText({ groups: [{ id: "g", name: long }] })).ok).toBe(false);
    const ok = "あ".repeat(MAX_STRING_LENGTH);
    expect(parseExport(rawText({ patients: [{ id: "a", familyName: "架空", memo: ok }] })).ok).toBe(true);
  });

  it("グループの手動並びが患者の上限を超える", () => {
    const order = Array.from({ length: MAX_PATIENTS + 1 }, (_, i) => `p${i}`);
    expect(parseExport(rawText({ groups: [{ id: "g", name: "G", manualOrder: order }] })).ok).toBe(false);
  });
});

describe("mergeStores（上限いっぱいでも速い）", () => {
  it("患者 5,000 人・グループ 500 件の追加・更新が 2 秒以内", () => {
    const groups = Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `G${i}`, i % 2 ? { sortMode: "manual" } : {}));
    const patients = Array.from({ length: MAX_PATIENTS }, (_, i) =>
      patient(`p${i}`, `架空${i}`, "太郎", { groupIds: [`g${i % MAX_GROUPS}`, `g${(i + 1) % MAX_GROUPS}`] }),
    );
    const t0 = Date.now();
    const { store: next, summary } = mergeStores(createEmptyStore(), fileOf(patients, groups), "merge");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(summary).toMatchObject({ added: MAX_PATIENTS, groupsAdded: MAX_GROUPS });
    // 手動のグループには所属患者が末尾に入る
    expect(next.groups[1].manualOrder).toHaveLength(20);
  });
});

describe("parseExport の読み飛ばし", () => {
  it("不正な患者は読み飛ばし、warnings に入れる", () => {
    const good = patient("p1", "山田", "太郎");
    const text = rawText({
      patients: [good, { id: "", familyName: "空id" }, { id: "p3", familyName: " ", givenName: "" }, "文字列", null, { ...good, id: "p1" }],
    });
    const r = parseExport(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.patients.map((p) => p.id)).toEqual(["p1"]);
    expect(r.warnings).toContain("患者 4 件を読み飛ばしました（氏名か id がありません）");
    expect(r.warnings).toContain("患者 1 件を読み飛ばしました（id が重複しています）");
  });

  it("不正なグループは読み飛ばし、存在しないグループへの参照と manualOrder の幽霊は捨てる", () => {
    const text = rawText({
      groups: [group("g1", "東", { sortMode: "manual", manualOrder: ["p1", "ghost"] }), { id: "g2" }, { name: "idなし" }],
      patients: [patient("p1", "山田", "太郎", { groupIds: ["g1", "g2", "gX"] })],
    });
    const r = parseExport(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.groups.map((g) => g.id)).toEqual(["g1"]);
    expect(r.file.groups[0].manualOrder).toEqual(["p1"]);
    expect(r.file.patients[0].groupIds).toEqual(["g1"]);
    expect(r.warnings).toContain("グループ 2 件を読み飛ばしました（名前か id がありません）");
  });
});

describe("mergeStores（追加・更新）", () => {
  it("いない人は追加し、元の store は変更しない", () => {
    const local = store([patient("p1", "山田", "太郎")], [], "p1");
    const snapshot = JSON.stringify(local);
    const incoming = fileOf([patient("q1", "鈴木", "次郎")]);
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(next.patients.map((p) => p.id)).toEqual(["p1", "q1"]);
    expect(summary).toEqual({ added: 1, updated: 0, unchanged: 0, groupsAdded: 0, facilitiesAdded: 0, warnings: [] });
    expect(next.selectedPatientId).toBe("p1");
    expect(JSON.stringify(local)).toBe(snapshot);
  });

  it("読み込み側が新しければ更新（id・createdAt は端末側を維持）", () => {
    const local = store([patient("p1", "山田", "太郎", { memo: "古い", createdAt: "2025-01-01T00:00:00.000Z" })]);
    const incoming = fileOf([patient("q9", "山田", "太郎", { memo: "新しい", updatedAt: NEW, createdAt: "2026-05-01T00:00:00.000Z" })]);
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(next.patients).toHaveLength(1);
    expect(next.patients[0]).toMatchObject({ id: "p1", memo: "新しい", updatedAt: NEW, createdAt: "2025-01-01T00:00:00.000Z" });
    expect(summary).toMatchObject({ added: 0, updated: 1, unchanged: 0 });
  });

  it("端末側が新しい・同時刻なら変更なし", () => {
    const local = store([patient("p1", "山田", "太郎", { memo: "端末", updatedAt: NEW }), patient("p2", "鈴木", "次郎", { memo: "端末2" })]);
    const incoming = fileOf([
      patient("q1", "山田", "太郎", { memo: "ファイル", updatedAt: OLD }),
      patient("q2", "鈴木", "次郎", { memo: "ファイル2", updatedAt: OLD }),
    ]);
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(next.patients.map((p) => p.memo)).toEqual(["端末", "端末2"]);
    expect(summary).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
  });

  it("同じ人は氏名 + 生年月日で判定する（id が違っても・全角空白や前後の空白は無視）", () => {
    const local = store([patient("p1", "山田", "太郎", { birthDate: "1940-04-01" })]);
    const same = patient("zzz", " 山田　", "太郎 ", { birthDate: " 1940-04-01 ", updatedAt: NEW });
    const otherBirth = patient("yyy", "山田", "太郎", { birthDate: "1950-01-01" });
    const { store: next, summary } = mergeStores(local, fileOf([same, otherBirth]), "merge");
    expect(next.patients).toHaveLength(2);
    expect(summary).toMatchObject({ added: 1, updated: 1 });
    expect(next.patients[0].id).toBe("p1");
  });

  it("両方とも生年月日が空でも姓名が同じなら同じ人", () => {
    const local = store([patient("p1", "山田", "太郎", { birthDate: "" })]);
    const incoming = fileOf([patient("q1", "山田", "太郎", { birthDate: "", updatedAt: NEW })]);
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(next.patients).toHaveLength(1);
    expect(summary.updated).toBe(1);
  });

  it("ファイル内に同じ人が 2 回いても 1 人にまとめ、warnings に出す", () => {
    const incoming = fileOf([patient("q1", "鈴木", "次郎"), patient("q2", "鈴木", "次郎", { memo: "新", updatedAt: NEW })]);
    const { store: next, summary } = mergeStores(createEmptyStore(), incoming, "merge");
    expect(next.patients).toHaveLength(1);
    expect(next.patients[0].memo).toBe("新");
    expect(summary).toMatchObject({ added: 1, updated: 0, unchanged: 0 });
    expect(summary.warnings).toHaveLength(1);
  });
});

describe("mergeStores（グループ）", () => {
  it("名前で突き合わせ、groupIds を端末側の id に付け替える", () => {
    const local = store([patient("p1", "山田", "太郎")], [group("lg1", "東地区")]);
    const incoming = fileOf(
      [patient("q1", "鈴木", "次郎", { groupIds: ["ig1", "ig2"] })],
      [group("ig1", " 東地区 "), group("ig2", "西地区")],
    );
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(summary.groupsAdded).toBe(1);
    expect(next.groups.map((g) => g.name)).toEqual(["東地区", "西地区"]);
    const west = next.groups.find((g) => g.name === "西地区")!;
    expect(west.id).toBe("ig2"); // 重複しないので読み込み側の id のまま
    const added = next.patients.find((p) => p.familyName === "鈴木")!;
    expect(added.groupIds).toEqual(["lg1", "ig2"]);
  });

  it("新しいグループの manualOrder を付け替える（患者の id が変わっても追従）", () => {
    const local = store([patient("q1", "別人", "某", { birthDate: "1999-01-01" })]); // id q1 を端末側が使用済み
    const incoming = fileOf(
      [patient("q1", "鈴木", "次郎", { groupIds: ["ig1"] }), patient("q2", "高橋", "三郎", { groupIds: ["ig1"] })],
      [group("ig1", "北地区", { sortMode: "manual", manualOrder: ["q2", "q1"] })],
    );
    const { store: next } = mergeStores(local, incoming, "merge");
    const suzuki = next.patients.find((p) => p.familyName === "鈴木")!;
    expect(suzuki.id).not.toBe("q1");
    const north = next.groups.find((g) => g.name === "北地区")!;
    expect(north.sortMode).toBe("manual");
    expect(north.manualOrder).toEqual(["q2", suzuki.id]);
  });

  it("手動並びの既存グループは端末側の並びを保ち、増えた人は末尾に足す", () => {
    const local = store(
      [patient("p1", "山田", "太郎", { groupIds: ["lg1"] }), patient("p2", "佐藤", "四郎", { groupIds: ["lg1"] })],
      [group("lg1", "東地区", { sortMode: "manual", manualOrder: ["p2", "p1"] })],
    );
    const incoming = fileOf([patient("q9", "鈴木", "次郎", { groupIds: ["ig1"] })], [group("ig1", "東地区", { sortMode: "kana" })]);
    const { store: next } = mergeStores(local, incoming, "merge");
    const east = next.groups.find((g) => g.id === "lg1")!;
    expect(east.sortMode).toBe("manual");
    expect(east.manualOrder).toEqual(["p2", "p1", "q9"]);
  });

  it("グループの id が端末側と重複しても名前が違えば新しい id を振る", () => {
    const local = store([], [group("g1", "東地区")]);
    const incoming = fileOf([patient("q1", "鈴木", "次郎", { groupIds: ["g1"] })], [group("g1", "西地区")]);
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(summary.groupsAdded).toBe(1);
    expect(next.groups).toHaveLength(2);
    const west = next.groups.find((g) => g.name === "西地区")!;
    expect(west.id).not.toBe("g1");
    expect(next.patients[0].groupIds).toEqual([west.id]);
  });
});

describe("mergeStores（id の採番）", () => {
  it("読み込み側の id が重複していなければそのまま、重複すれば新しい id", () => {
    const local = store([patient("p1", "山田", "太郎")]);
    const incoming = fileOf([patient("p1", "鈴木", "次郎"), patient("q2", "高橋", "三郎")]);
    const { store: next } = mergeStores(local, incoming, "merge");
    const ids = next.patients.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("q2");
    const suzuki = next.patients.find((p) => p.familyName === "鈴木")!;
    expect(suzuki.id).not.toBe("p1");
    expect(suzuki.id).not.toBe("");
  });
});

describe("mergeStores（置き換え）", () => {
  it("読み込んだ患者・グループに置き換え、selectedPatientId は null", () => {
    const local = store([patient("p1", "山田", "太郎")], [group("lg1", "東地区")], "p1");
    const incoming = fileOf([patient("q1", "鈴木", "次郎", { groupIds: ["ig1"] })], [group("ig1", "西地区")]);
    const { store: next, summary } = mergeStores(local, incoming, "replace");
    expect(next.patients.map((p) => p.id)).toEqual(["q1"]);
    expect(next.groups.map((g) => g.id)).toEqual(["ig1"]);
    expect(next.selectedPatientId).toBeNull();
    expect(summary).toEqual({ added: 1, updated: 0, unchanged: 0, groupsAdded: 1, facilitiesAdded: 0, warnings: [] });
    // 元は変更されない
    expect(local.patients[0].id).toBe("p1");
    expect(local.selectedPatientId).toBe("p1");
  });

  it("施設も置き換え、個人宅の並びは五十音に戻す", () => {
    const local = { ...store([patient("p1", "山田", "太郎")]), homeSortMode: "manual" as const, homeManualOrder: ["p1"] };
    const incoming = fileOf(
      [patient("q1", "鈴木", "次郎", { residence: { kind: "facility", facilityId: "if1" } })],
      [],
      [facility("if1", "ひまわり荘", { manualOrder: ["q1"] })],
    );
    const { store: next, summary } = mergeStores(local, incoming, "replace");
    expect(next.version).toBe(2);
    expect(next.facilities.map((f) => f.id)).toEqual(["if1"]);
    expect(next.patients[0].residence).toEqual({ kind: "facility", facilityId: "if1" });
    expect(next.homeSortMode).toBe("kana");
    expect(next.homeManualOrder).toEqual([]);
    expect(summary.facilitiesAdded).toBe(1);
  });
});

describe("v1 ファイルの読み込み", () => {
  it("施設・住まいが無い version 1 を v2 の形に補う", () => {
    const v1Patient = { id: "p1", familyName: "山田", givenName: "太郎", visitDays: [1, 9, "x", 3, 3] };
    const r = parseExport(rawText({ version: 1, patients: [v1Patient] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.version).toBe(2);
    expect(r.file.facilities).toEqual([]);
    expect(r.file.patients[0].residence).toEqual({ kind: "home", facilityId: null });
    expect(r.file.patients[0].visitDays).toEqual([1, 3]); // 不正な曜日は捨てる
    expect(r.file.patients[0].handoverNote).toBe("");
  });

  it("v1 の読み込みを merge しても落ちない", () => {
    const r = parseExport(rawText({ version: 1, patients: [{ id: "p1", familyName: "山田", givenName: "太郎" }] }));
    if (!r.ok) throw new Error("parse failed");
    const { store: next, summary } = mergeStores(createEmptyStore(), r.file, "merge");
    expect(next.patients).toHaveLength(1);
    expect(summary).toMatchObject({ added: 1, facilitiesAdded: 0 });
  });
});

describe("施設の書き出し・読み込み", () => {
  it("export → parse で施設と住まいが戻る", () => {
    const s = {
      ...store([patient("p1", "山田", "太郎", { residence: { kind: "facility", facilityId: "f1" } })]),
      facilities: [facility("f1", "ひまわり荘", { visitDays: [4], manualOrder: ["p1"] })],
    };
    const r = parseExport(exportStore(s, NEW));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.facilities).toEqual(s.facilities);
    expect(r.file.patients[0].residence).toEqual({ kind: "facility", facilityId: "f1" });
  });

  it("存在しない施設を指す住まいは facilityId null、名前の無い施設は読み飛ばす", () => {
    const r = parseExport(
      rawText({
        version: 2,
        patients: [patient("p1", "山田", "太郎", { residence: { kind: "facility", facilityId: "gone" } })],
        facilities: [facility("f1", " "), facility("f2", "あおぞら荘")],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.facilities.map((f) => f.id)).toEqual(["f2"]);
    expect(r.file.patients[0].residence).toEqual({ kind: "facility", facilityId: null });
    expect(r.warnings).toContain("施設 1 件を読み飛ばしました（名前か id がありません）");
  });
});

describe("mergeStores（施設）", () => {
  it("名前で突き合わせ、入居者の facilityId を端末側の id に付け替える", () => {
    const local = {
      ...store([patient("p1", "山田", "太郎", { residence: { kind: "facility", facilityId: "lf1" } })]),
      facilities: [facility("lf1", "ひまわり荘")],
    };
    const incoming = fileOf(
      [
        patient("q1", "鈴木", "次郎", { residence: { kind: "facility", facilityId: "if1" } }),
        patient("q2", "高橋", "三郎", { residence: { kind: "facility", facilityId: "if2" } }),
      ],
      [],
      [facility("if1", " ひまわり荘 "), facility("if2", "あおぞら荘")],
    );
    const { store: next, summary } = mergeStores(local, incoming, "merge");
    expect(summary.facilitiesAdded).toBe(1);
    expect(next.facilities.map((f) => f.name)).toEqual(["ひまわり荘", "あおぞら荘"]);
    const suzuki = next.patients.find((p) => p.familyName === "鈴木")!;
    expect(suzuki.residence).toEqual({ kind: "facility", facilityId: "lf1" });
    const takahashi = next.patients.find((p) => p.familyName === "高橋")!;
    expect(takahashi.residence).toEqual({ kind: "facility", facilityId: "if2" });
  });

  it("新しい施設の manualOrder を付け替える（患者の id が変わっても追従）", () => {
    const local = store([patient("q1", "別人", "某", { birthDate: "1999-01-01" })]); // id q1 は端末側が使用済み
    const incoming = fileOf(
      [
        patient("q1", "鈴木", "次郎", { residence: { kind: "facility", facilityId: "if1" } }),
        patient("q2", "高橋", "三郎", { residence: { kind: "facility", facilityId: "if1" } }),
      ],
      [],
      [facility("if1", "北荘", { sortMode: "manual", manualOrder: ["q2", "q1"] })],
    );
    const { store: next } = mergeStores(local, incoming, "merge");
    const suzuki = next.patients.find((p) => p.familyName === "鈴木")!;
    expect(suzuki.id).not.toBe("q1");
    const north = next.facilities.find((f) => f.name === "北荘")!;
    expect(north.sortMode).toBe("manual");
    expect(north.manualOrder).toEqual(["q2", suzuki.id]);
  });

  it("端末側の個人宅の並びは保つ", () => {
    const local = { ...store([patient("p1", "山田", "太郎")]), homeSortMode: "manual" as const, homeManualOrder: ["p1"] };
    const { store: next } = mergeStores(local, fileOf([patient("q1", "鈴木", "次郎")]), "merge");
    expect(next.homeSortMode).toBe("manual");
    expect(next.homeManualOrder).toEqual(["p1"]);
  });

  it("施設のグループ参照は端末側の id に付け替える", () => {
    const local = store([], [group("lg1", "東地区")]);
    const incoming = fileOf([], [group("ig1", "東地区")], [facility("if1", "南荘", { groupIds: ["ig1"] })]);
    const { store: next } = mergeStores(local, incoming, "merge");
    expect(next.facilities[0].groupIds).toEqual(["lg1"]);
  });
});
