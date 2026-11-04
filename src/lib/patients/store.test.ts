import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyPatient,
  createEmptyStore,
  deleteGroup,
  deletePatient,
  loadStore,
  movePatientInGroup,
  saveStore,
  setGroupSortMode,
  upsertGroup,
  upsertPatient,
} from "./store";
import { PATIENT_STORE_KEY, type Group, type Patient, type PatientStore } from "./types";

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
    for (const raw of [JSON.stringify({ version: 2, patients: [], groups: [] }), "[]", "null", JSON.stringify({ version: 1 })]) {
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
