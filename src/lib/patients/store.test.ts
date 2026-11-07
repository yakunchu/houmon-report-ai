import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyFacility,
  createEmptyPatient,
  createEmptyStore,
  deleteFacility,
  deleteGroup,
  deletePatient,
  loadStore,
  movePatientInGroup,
  movePatientInScope,
  saveStore,
  setGroupSortMode,
  setManualOrder,
  setScopeSortMode,
  updatePatientExtras,
  upsertFacility,
  upsertGroup,
  upsertPatient,
} from "./store";
import { patientsInScope } from "./sort";
import { PATIENT_STORE_KEY, type Facility, type Group, type Patient, type PatientStore } from "./types";

/** 架空の患者を作る（テスト用） */
function patient(id: string, familyName: string, givenName: string, kana: [string, string], groupIds: string[] = []): Patient {
  return { ...createEmptyPatient(), id, familyName, givenName, familyNameKana: kana[0], givenNameKana: kana[1], groupIds };
}

function group(id: string, name: string, extra: Partial<Group> = {}): Group {
  return { id, name, sortMode: "kana", manualOrder: [], createdAt: "2026-11-04T00:00:00.000Z", ...extra };
}

/** localStorage の代わり */
function fakeStorage(initial: Record<string, string> = {}, failOnSet = false) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failOnSet) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("loadStore / saveStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("保存して読み込むと同じ内容に戻る", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    let store: PatientStore = createEmptyStore();
    store = upsertGroup(store, group("g1", "A棟"));
    store = upsertPatient(store, patient("p1", "山本", "花子", ["ヤマモト", "ハナコ"], ["g1"]));
    store = { ...store, selectedPatientId: "p1" };
    expect(saveStore(store)).toBe(true);
    expect(loadStore()).toEqual(store);
  });

  it("window が無くても例外を投げず、空の store と false を返す", () => {
    vi.stubGlobal("window", undefined);
    expect(loadStore()).toEqual(createEmptyStore());
    expect(saveStore(createEmptyStore())).toBe(false);
  });

  it("壊れた JSON は空の store になる", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage({ [PATIENT_STORE_KEY]: "{not json" }) });
    expect(loadStore()).toEqual(createEmptyStore());
  });

  it("version が違う・形が不明なら空の store になる", () => {
    for (const raw of [JSON.stringify({ version: 3, patients: [], groups: [] }), "[]", "null", JSON.stringify({ version: 1 })]) {
      vi.stubGlobal("window", { localStorage: fakeStorage({ [PATIENT_STORE_KEY]: raw }) });
      expect(loadStore()).toEqual(createEmptyStore());
    }
  });

  it("容量超過などで書けなくても例外を投げず false を返す", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage({}, true) });
    expect(saveStore(createEmptyStore())).toBe(false);
  });

  it("欠けた項目は補い、存在しないグループ参照と患者は捨てる", () => {
    const raw = JSON.stringify({
      version: 1,
      patients: [{ id: "p1", familyName: "佐藤", groupIds: ["g1", "gone"] }, { name: "idなし" }, 5],
      groups: [{ id: "g1", name: "A棟" }],
      selectedPatientId: "missing",
    });
    vi.stubGlobal("window", { localStorage: fakeStorage({ [PATIENT_STORE_KEY]: raw }) });
    const store = loadStore();
    expect(store.patients).toHaveLength(1);
    expect(store.patients[0].givenName).toBe("");
    expect(store.patients[0].groupIds).toEqual(["g1"]);
    expect(store.groups[0].sortMode).toBe("kana");
    expect(store.selectedPatientId).toBeNull();
  });
});

describe("createEmptyPatient", () => {
  it("id が毎回違い、日時は ISO 形式", () => {
    const a = createEmptyPatient();
    const b = createEmptyPatient();
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe("");
    expect(new Date(a.createdAt).toISOString()).toBe(a.createdAt);
    expect(a.updatedAt).toBe(a.createdAt);
  });

  it("crypto.randomUUID が無くても id を作れる", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(createEmptyPatient().id).not.toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("upsertPatient", () => {
  it("カナをカタカナに正規化する（ひらがな・半角カナ・全角スペース）", () => {
    const store = upsertPatient(createEmptyStore(), patient("p1", "山本", "花子", ["やまもと", "ﾊﾅｺ"]));
    expect(store.patients[0].familyNameKana).toBe("ヤマモト");
    expect(store.patients[0].givenNameKana).toBe("ハナコ");

    const spaced = upsertPatient(createEmptyStore(), patient("p2", "田中", "一郎", ["　たなか ", "いちろう　"]));
    expect(spaced.patients[0].familyNameKana).toBe("タナカ");
    expect(spaced.patients[0].givenNameKana).toBe("イチロウ");
  });

  it("半角カナの濁点も合成される", () => {
    const store = upsertPatient(createEmptyStore(), patient("p1", "後藤", "花子", ["ｺﾞﾄｳ", "ﾊﾞﾊﾟ"]));
    expect(store.patients[0].familyNameKana).toBe("ゴトウ");
    expect(store.patients[0].givenNameKana).toBe("バパ");
  });

  it("同じ id は置換（件数は増えない）、無ければ追加。元の store は変えない", () => {
    const s0 = createEmptyStore();
    const s1 = upsertPatient(s0, patient("p1", "山本", "花子", ["ヤマモト", "ハナコ"]));
    expect(s0.patients).toHaveLength(0);
    const s2 = upsertPatient(s1, { ...s1.patients[0], address: "架空市1-2-3" });
    expect(s2.patients).toHaveLength(1);
    expect(s2.patients[0].address).toBe("架空市1-2-3");
    expect(s1.patients[0].address).toBe("");
    const s3 = upsertPatient(s2, patient("p2", "佐藤", "太郎", ["サトウ", "タロウ"]));
    expect(s3.patients.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("updatedAt を更新し、createdAt は保つ", () => {
    const old = { ...patient("p1", "山本", "花子", ["ヤマモト", "ハナコ"]), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const store = upsertPatient(createEmptyStore(), old);
    expect(store.patients[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(store.patients[0].updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("deletePatient", () => {
  it("グループの manualOrder から外し、選択中なら null にする", () => {
    let store = createEmptyStore();
    store = upsertGroup(store, group("g1", "A棟", { sortMode: "manual", manualOrder: ["p1", "p2"] }));
    store = upsertPatient(store, patient("p1", "山本", "花子", ["ヤマモト", "ハナコ"], ["g1"]));
    store = upsertPatient(store, patient("p2", "佐藤", "太郎", ["サトウ", "タロウ"], ["g1"]));
    store = { ...store, selectedPatientId: "p1" };
    const next = deletePatient(store, "p1");
    expect(next.patients.map((p) => p.id)).toEqual(["p2"]);
    expect(next.groups[0].manualOrder).toEqual(["p2"]);
    expect(next.selectedPatientId).toBeNull();
    expect(store.patients).toHaveLength(2);
  });

  it("別の患者を選んでいれば選択は変わらない", () => {
    let store = upsertPatient(createEmptyStore(), patient("p1", "山本", "花子", ["ヤマモト", "ハナコ"]));
    store = upsertPatient(store, patient("p2", "佐藤", "太郎", ["サトウ", "タロウ"]));
    expect(deletePatient({ ...store, selectedPatientId: "p2" }, "p1").selectedPatientId).toBe("p2");
  });
});

describe("グループ", () => {
  it("upsertGroup は追加と置換ができる", () => {
    let store = upsertGroup(createEmptyStore(), group("g1", "A棟"));
    store = upsertGroup(store, group("g1", "A棟（改）"));
    store = upsertGroup(store, group("g2", "B棟"));
    expect(store.groups.map((g) => g.name)).toEqual(["A棟（改）", "B棟"]);
  });

  it("deleteGroup は患者の groupIds からも外す", () => {
    let store = createEmptyStore();
    store = upsertGroup(store, group("g1", "A棟"));
    store = upsertGroup(store, group("g2", "B棟"));
    store = upsertPatient(store, patient("p1", "山本", "花子", ["ヤマモト", "ハナコ"], ["g1", "g2"]));
    const next = deleteGroup(store, "g1");
    expect(next.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(next.patients[0].groupIds).toEqual(["g2"]);
    expect(store.patients[0].groupIds).toEqual(["g1", "g2"]);
  });

  it("setGroupSortMode は並び方を切り替える", () => {
    const store = upsertGroup(createEmptyStore(), group("g1", "A棟"));
    expect(setGroupSortMode(store, "g1", "manual").groups[0].sortMode).toBe("manual");
    expect(store.groups[0].sortMode).toBe("kana");
  });
});

describe("movePatientInGroup", () => {
  /** サトウ・タナカ・ヤマモトの 3 人が g1 にいる store */
  function threeInGroup(extra: Partial<Group> = {}): PatientStore {
    let store = createEmptyStore();
    store = upsertGroup(store, group("g1", "A棟", extra));
    store = upsertPatient(store, patient("yamamoto", "山本", "花子", ["ヤマモト", "ハナコ"], ["g1"]));
    store = upsertPatient(store, patient("sato", "佐藤", "太郎", ["サトウ", "タロウ"], ["g1"]));
    store = upsertPatient(store, patient("tanaka", "田中", "次郎", ["タナカ", "ジロウ"], ["g1"]));
    return store;
  }

  it("manualOrder が空なら今の表示順（カナ順）で初期化して動かし、manual にする", () => {
    const next = movePatientInGroup(threeInGroup(), "g1", "tanaka", -1);
    expect(next.groups[0].sortMode).toBe("manual");
    expect(next.groups[0].manualOrder).toEqual(["tanaka", "sato", "yamamoto"]);
  });

  it("下へも動かせる", () => {
    const next = movePatientInGroup(threeInGroup(), "g1", "sato", 1);
    expect(next.groups[0].manualOrder).toEqual(["tanaka", "sato", "yamamoto"]);
  });

  it("manualOrder が不完全でも、含まれない人は末尾にカナ順で続けてから動かす", () => {
    const store = threeInGroup({ sortMode: "manual", manualOrder: ["yamamoto"] });
    // 表示順: 山本, 佐藤, 田中
    const next = movePatientInGroup(store, "g1", "tanaka", -1);
    expect(next.groups[0].manualOrder).toEqual(["yamamoto", "tanaka", "sato"]);
  });

  it("端では何もしない（同じ store を返す）", () => {
    const store = threeInGroup();
    expect(movePatientInGroup(store, "g1", "sato", -1)).toBe(store);
    expect(movePatientInGroup(store, "g1", "yamamoto", 1)).toBe(store);
    const manual = threeInGroup({ sortMode: "manual", manualOrder: ["tanaka", "sato", "yamamoto"] });
    expect(movePatientInGroup(manual, "g1", "tanaka", -1)).toBe(manual);
  });

  it("グループに居ない患者・存在しないグループは何もしない", () => {
    const store = threeInGroup();
    expect(movePatientInGroup(store, "g1", "nobody", 1)).toBe(store);
    expect(movePatientInGroup(store, "none", "sato", 1)).toBe(store);
  });

  it("元の store を変更しない", () => {
    const store = threeInGroup();
    movePatientInGroup(store, "g1", "tanaka", -1);
    expect(store.groups[0].sortMode).toBe("kana");
    expect(store.groups[0].manualOrder).toEqual([]);
  });
});

/* ---- v2（画面 v2: 施設・住まい・曜日・申し送り）。架空データのみ ---- */

function facilityOf(id: string, name: string, extra: Partial<Facility> = {}): Facility {
  return { ...createEmptyFacility(), id, name, ...extra };
}

describe("v1 → v2 の補い", () => {
  afterEach(() => vi.unstubAllGlobals());

  function loadRaw(raw: unknown): PatientStore {
    vi.stubGlobal("window", { localStorage: fakeStorage({ [PATIENT_STORE_KEY]: JSON.stringify(raw) }) });
    return loadStore();
  }

  it("createEmptyStore は version 2・施設なし・個人宅は五十音", () => {
    expect(createEmptyStore()).toEqual({
      version: 2,
      patients: [],
      groups: [],
      facilities: [],
      homeSortMode: "kana",
      homeManualOrder: [],
      selectedPatientId: null,
    });
    expect(createEmptyPatient()).toMatchObject({ residence: { kind: "home", facilityId: null }, visitDays: [], handoverNote: "" });
  });

  it("v1 のデータは個人宅・曜日なし・申し送りなし・施設なしで読む", () => {
    const store = loadRaw({ version: 1, patients: [{ id: "p1", familyName: "佐藤" }], groups: [{ id: "g1", name: "A棟" }], selectedPatientId: "p1" });
    expect(store.version).toBe(2);
    expect(store.facilities).toEqual([]);
    expect(store.homeSortMode).toBe("kana");
    expect(store.homeManualOrder).toEqual([]);
    expect(store.patients[0]).toMatchObject({ residence: { kind: "home", facilityId: null }, visitDays: [], handoverNote: "" });
    expect(store.selectedPatientId).toBe("p1");
  });

  it("不正な曜日は捨て、存在しない施設を指す facilityId は null にする", () => {
    const store = loadRaw({
      version: 2,
      patients: [
        { id: "p1", familyName: "佐藤", visitDays: [3, 7, -1, 1.5, "月", 3, 0], residence: { kind: "facility", facilityId: "gone" } },
        { id: "p2", familyName: "田中", residence: { kind: "facility", facilityId: "f1" } },
        { id: "p3", familyName: "鈴木", residence: { kind: "home", facilityId: "f1" } },
      ],
      groups: [],
      facilities: [{ id: "f1", name: "ひまわり荘", visitDays: [4, 99] }, { name: "idなし" }],
    });
    expect(store.patients[0].visitDays).toEqual([0, 3]);
    expect(store.patients[0].residence).toEqual({ kind: "facility", facilityId: null });
    expect(store.patients[1].residence).toEqual({ kind: "facility", facilityId: "f1" });
    expect(store.patients[2].residence).toEqual({ kind: "home", facilityId: null });
    expect(store.facilities).toHaveLength(1);
    expect(store.facilities[0]).toMatchObject({ id: "f1", visitDays: [4], sortMode: "kana", manualOrder: [] });
  });

  it("v2 を保存して読み込むと同じ内容に戻る", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    let store = upsertFacility(createEmptyStore(), facilityOf("f1", "ひまわり荘", { visitDays: [4] }));
    store = upsertPatient(store, {
      ...patient("p1", "佐々木", "清", ["ササキ", "キヨシ"]),
      residence: { kind: "facility", facilityId: "f1" },
      visitDays: [4],
      handoverNote: "右耳が聞こえにくい（架空）",
    });
    store = { ...store, homeSortMode: "manual", homeManualOrder: ["p1"] };
    expect(saveStore(store)).toBe(true);
    expect(loadStore()).toEqual(store);
  });
});

describe("施設", () => {
  it("upsertFacility は追加・置換し、カナをカタカナに、存在しないグループと不正な曜日を捨てる", () => {
    let store = upsertGroup(createEmptyStore(), group("g1", "A棟"));
    store = upsertFacility(store, facilityOf("f1", " ひまわり荘 ", { nameKana: "ひまわりそう", groupIds: ["g1", "gone"], visitDays: [4, 4, 9 as 4] }));
    expect(store.facilities).toHaveLength(1);
    expect(store.facilities[0]).toMatchObject({ name: "ひまわり荘", nameKana: "ヒマワリソウ", groupIds: ["g1"], visitDays: [4] });
    const again = upsertFacility(store, { ...store.facilities[0], name: "ひまわり荘2" });
    expect(again.facilities).toHaveLength(1);
    expect(again.facilities[0].name).toBe("ひまわり荘2");
    expect(store.facilities[0].name).toBe("ひまわり荘"); // 元は変更されない
  });

  it("deleteFacility は入居者を残し、facilityId を null にする（kind は facility のまま）", () => {
    let store = upsertFacility(createEmptyStore(), facilityOf("f1", "ひまわり荘"));
    store = upsertPatient(store, { ...patient("p1", "佐藤", "太郎", ["サトウ", "タロウ"]), residence: { kind: "facility", facilityId: "f1" } });
    const next = deleteFacility(store, "f1");
    expect(next.facilities).toEqual([]);
    expect(next.patients).toHaveLength(1);
    expect(next.patients[0].residence).toEqual({ kind: "facility", facilityId: null });
  });

  it("upsertPatient は個人宅なら facilityId を null に、存在しない施設も null にする", () => {
    const store = upsertFacility(createEmptyStore(), facilityOf("f1", "ひまわり荘"));
    const home = upsertPatient(store, { ...patient("p1", "佐藤", "太郎", ["サトウ", "タロウ"]), residence: { kind: "home", facilityId: "f1" } });
    expect(home.patients[0].residence).toEqual({ kind: "home", facilityId: null });
    const ghost = upsertPatient(store, { ...patient("p2", "田中", "次郎", ["タナカ", "ジロウ"]), residence: { kind: "facility", facilityId: "zzz" } });
    expect(ghost.patients[0].residence).toEqual({ kind: "facility", facilityId: null });
  });

  it("deletePatient は施設の manualOrder と homeManualOrder からも外す", () => {
    let store = upsertFacility(createEmptyStore(), facilityOf("f1", "ひまわり荘", { sortMode: "manual", manualOrder: ["p1", "p2"] }));
    store = { ...store, homeManualOrder: ["p1", "p3"], patients: [patient("p1", "佐藤", "太郎", ["サトウ", "タロウ"])] };
    const next = deletePatient(store, "p1");
    expect(next.facilities[0].manualOrder).toEqual(["p2"]);
    expect(next.homeManualOrder).toEqual(["p3"]);
  });

  it("deleteGroup は施設の groupIds からも外す", () => {
    let store = upsertGroup(createEmptyStore(), group("g1", "A棟"));
    store = upsertGroup(store, group("g2", "B棟"));
    store = upsertFacility(store, facilityOf("f1", "ひまわり荘", { groupIds: ["g1", "g2"] }));
    expect(deleteGroup(store, "g1").facilities[0].groupIds).toEqual(["g2"]);
  });
});

describe("scope ごとの並び替え", () => {
  /** 個人宅 3 人（サトウ・タナカ・ヤマモト）と、ひまわり荘（f1）に 2 人（スズキ・ワタナベ） */
  function mixed(): PatientStore {
    let store = upsertFacility(upsertGroup(createEmptyStore(), group("g1", "A棟")), facilityOf("f1", "ひまわり荘"));
    store = upsertPatient(store, patient("yamamoto", "山本", "花子", ["ヤマモト", "ハナコ"], ["g1"]));
    store = upsertPatient(store, patient("sato", "佐藤", "太郎", ["サトウ", "タロウ"], ["g1"]));
    store = upsertPatient(store, patient("tanaka", "田中", "次郎", ["タナカ", "ジロウ"]));
    const inF = { residence: { kind: "facility", facilityId: "f1" } } as const;
    store = upsertPatient(store, { ...patient("watanabe", "渡辺", "三郎", ["ワタナベ", "サブロウ"]), ...inF });
    store = upsertPatient(store, { ...patient("suzuki", "鈴木", "一郎", ["スズキ", "イチロウ"]), ...inF });
    return store;
  }
  const home = { kind: "home" } as const;
  const fac = { kind: "facility", facilityId: "f1" } as const;
  const ids = (s: PatientStore, scope: Parameters<typeof patientsInScope>[1]) => patientsInScope(s, scope).map((p) => p.id);

  it("home: 手動に切り替えて動かすと homeSortMode / homeManualOrder が変わる（施設の入居者は含まれない）", () => {
    const next = movePatientInScope(mixed(), home, "tanaka", -1);
    expect(next.homeSortMode).toBe("manual");
    expect(next.homeManualOrder).toEqual(["tanaka", "sato", "yamamoto"]);
    expect(ids(next, home)).toEqual(["tanaka", "sato", "yamamoto"]);
  });

  it("facility: 入居者だけを動かし、他の scope は変わらない", () => {
    const store = mixed();
    const next = movePatientInScope(store, fac, "watanabe", 1);
    expect(ids(next, fac)).toEqual(["suzuki", "watanabe"]); // カナ順は スズキ → ワタナベ なので元と同じ、下へ動かせない
    expect(next).toBe(store);
    const moved = movePatientInScope(store, fac, "suzuki", 1);
    expect(moved.facilities[0]).toMatchObject({ sortMode: "manual", manualOrder: ["watanabe", "suzuki"] });
    expect(moved.homeSortMode).toBe("kana");
  });

  it("group: movePatientInGroup と同じ結果になる", () => {
    const store = mixed();
    expect(movePatientInScope(store, { kind: "group", groupId: "g1" }, "yamamoto", -1)).toEqual(movePatientInGroup(store, "g1", "yamamoto", -1));
  });

  it("端・scope 外・存在しない scope は何もしない", () => {
    const store = mixed();
    expect(movePatientInScope(store, home, "sato", -1)).toBe(store);
    expect(movePatientInScope(store, home, "suzuki", 1)).toBe(store); // 施設の人は home に居ない
    expect(movePatientInScope(store, { kind: "facility", facilityId: "none" }, "suzuki", 1)).toBe(store);
  });

  it("setScopeSortMode は mode だけを切り替える（manualOrder は残る）", () => {
    let store = setManualOrder(mixed(), fac, ["watanabe", "suzuki"]);
    store = setScopeSortMode(store, fac, "kana");
    expect(store.facilities[0]).toMatchObject({ sortMode: "kana", manualOrder: ["watanabe", "suzuki"] });
    expect(ids(store, fac)).toEqual(["suzuki", "watanabe"]);
    expect(setScopeSortMode(store, home, "manual").homeSortMode).toBe("manual");
    expect(setScopeSortMode(store, { kind: "group", groupId: "g1" }, "manual").groups[0].sortMode).toBe("manual");
  });

  it("setManualOrder: manual にして並びを保存し、含まれない患者は末尾にカナ順、scope 外・重複は無視", () => {
    const next = setManualOrder(mixed(), home, ["yamamoto", "suzuki", "yamamoto", "ghost"]);
    expect(next.homeSortMode).toBe("manual");
    expect(next.homeManualOrder).toEqual(["yamamoto", "sato", "tanaka"]);
    const fac2 = setManualOrder(mixed(), fac, ["watanabe"]);
    expect(fac2.facilities[0]).toMatchObject({ sortMode: "manual", manualOrder: ["watanabe", "suzuki"] });
    const grp = setManualOrder(mixed(), { kind: "group", groupId: "g1" }, ["yamamoto", "sato"]);
    expect(grp.groups[0]).toMatchObject({ sortMode: "manual", manualOrder: ["yamamoto", "sato"] });
  });

  it("setManualOrder は存在しない scope なら何もしない", () => {
    const store = mixed();
    expect(setManualOrder(store, { kind: "facility", facilityId: "none" }, ["a"])).toBe(store);
  });
});

describe("updatePatientExtras", () => {
  function withP(): PatientStore {
    let store = upsertFacility(createEmptyStore(), facilityOf("f1", "ひまわり荘"));
    store = upsertPatient(store, { ...patient("p1", "佐藤", "太郎", ["サトウ", "タロウ"]), memo: "メモ" });
    return store;
  }

  it("住まい・曜日・申し送りだけを更新し、他の欄は触らない", () => {
    const store = withP();
    const next = updatePatientExtras(store, "p1", {
      residence: { kind: "facility", facilityId: "f1" },
      visitDays: [4, 1, 4],
      handoverNote: "左側から話しかける（架空）",
    });
    expect(next.patients[0]).toMatchObject({
      memo: "メモ",
      familyName: "佐藤",
      residence: { kind: "facility", facilityId: "f1" },
      visitDays: [1, 4],
      handoverNote: "左側から話しかける（架空）",
    });
    expect(store.patients[0].handoverNote).toBe(""); // 元は変更されない
  });

  it("渡した項目だけ変える", () => {
    const store = updatePatientExtras(withP(), "p1", { handoverNote: "A" });
    const next = updatePatientExtras(store, "p1", { visitDays: [2] });
    expect(next.patients[0]).toMatchObject({ handoverNote: "A", visitDays: [2], residence: { kind: "home", facilityId: null } });
  });

  it("個人宅に切り替えると facilityId は null、存在しない施設も null、存在しない患者は何もしない", () => {
    const store = updatePatientExtras(withP(), "p1", { residence: { kind: "facility", facilityId: "f1" } });
    expect(updatePatientExtras(store, "p1", { residence: { kind: "home", facilityId: "f1" } }).patients[0].residence).toEqual({
      kind: "home",
      facilityId: null,
    });
    expect(updatePatientExtras(store, "p1", { residence: { kind: "facility", facilityId: "zzz" } }).patients[0].residence).toEqual({
      kind: "facility",
      facilityId: null,
    });
    expect(updatePatientExtras(store, "nobody", { handoverNote: "x" })).toBe(store);
  });
});
