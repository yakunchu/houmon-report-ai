import { describe, expect, it } from "vitest";
import { createEmptyPatient, createEmptyStore } from "../patients/store";
import { exportForRelay, parseExport } from "../patients/transfer";
import type { Group, Patient } from "../patients/types";
import {
  RELAY_MAX_BYTES,
  RELAY_TTL_MS,
  RelayCryptoError,
  decryptFromRelay,
  encryptForRelay,
  generateCode,
  isRelayCode,
} from "./crypto";
import { BLOCK_MS, MAX_ENTRIES, MAX_FAILS, createRelayStore } from "./server-store";

/* 架空データのみ。
 * 注: server-store と exportForRelay のテストも、担当ファイルの制約で新しいファイルを作れないため、ここにまとめている。 */

const PLAIN = JSON.stringify({ note: "架空の患者 テスト太郎 1940-04-01", list: [1, 2, 3] });

describe("generateCode", () => {
  it("6 桁の数字になり、先頭が 0 のこともある（桁を落とさない）", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
  it("毎回同じ値ではない", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(set.size).toBeGreaterThan(40);
  });
  it("isRelayCode は 6 桁の数字だけ通す", () => {
    expect(isRelayCode("012345")).toBe(true);
    expect(isRelayCode("12345")).toBe(false);
    expect(isRelayCode("1234567")).toBe(false);
    expect(isRelayCode("12345a")).toBe(false);
    expect(isRelayCode("１２３４５６")).toBe(false);
    expect(isRelayCode(123456)).toBe(false);
  });
});

describe("encryptForRelay / decryptFromRelay", () => {
  it("同じコードで往復できる（日本語も）", async () => {
    const p = await encryptForRelay(PLAIN, "123456");
    expect(await decryptFromRelay(p, "123456")).toBe(PLAIN);
  });

  it("iv は 12 バイト、salt は 16 バイト、平文は含まれない。毎回違う暗号文になる", async () => {
    const a = await encryptForRelay(PLAIN, "123456");
    const b = await encryptForRelay(PLAIN, "123456");
    expect(atob(a.iv).length).toBe(12);
    expect(atob(a.salt).length).toBe(16);
    expect(JSON.stringify(a)).not.toContain("テスト");
    expect(a.data).not.toBe(b.data);
    expect(a.salt).not.toBe(b.salt);
  });

  it("別のコードでは復号に失敗する", async () => {
    const p = await encryptForRelay(PLAIN, "123456");
    await expect(decryptFromRelay(p, "123457")).rejects.toBeInstanceOf(RelayCryptoError);
  });

  it("暗号文・iv・salt のどれを 1 文字変えても失敗する（改ざん検出）", async () => {
    const p = await encryptForRelay(PLAIN, "123456");
    const flip = (s: string): string => {
      // base64 の 1 文字目を別の文字に変える
      const c = s[0] === "A" ? "B" : "A";
      return c + s.slice(1);
    };
    await expect(decryptFromRelay({ ...p, data: flip(p.data) }, "123456")).rejects.toBeInstanceOf(RelayCryptoError);
    await expect(decryptFromRelay({ ...p, iv: flip(p.iv) }, "123456")).rejects.toBeInstanceOf(RelayCryptoError);
    await expect(decryptFromRelay({ ...p, salt: flip(p.salt) }, "123456")).rejects.toBeInstanceOf(RelayCryptoError);
  });

  it("末尾を切り詰めても失敗する", async () => {
    const p = await encryptForRelay(PLAIN, "123456");
    const bytes = atob(p.data);
    const cut = btoa(bytes.slice(0, bytes.length - 1));
    await expect(decryptFromRelay({ ...p, data: cut }, "123456")).rejects.toBeInstanceOf(RelayCryptoError);
  });

  it("形式が壊れたデータ・6 桁でないコードは RelayCryptoError", async () => {
    const p = await encryptForRelay(PLAIN, "123456");
    await expect(decryptFromRelay({ ...p, data: "%%%not-base64%%%" }, "123456")).rejects.toBeInstanceOf(RelayCryptoError);
    await expect(decryptFromRelay({ iv: 1, salt: 2, data: 3 } as unknown as typeof p, "123456")).rejects.toBeInstanceOf(RelayCryptoError);
    await expect(decryptFromRelay(p, "12345")).rejects.toBeInstanceOf(RelayCryptoError);
    await expect(encryptForRelay(PLAIN, "abcdef")).rejects.toBeInstanceOf(RelayCryptoError);
  });
});

/* ---------------- server-store ---------------- */

const PAYLOAD = { iv: "AAAAAAAAAAAAAAAA", salt: "AAAAAAAAAAAAAAAAAAAAAA==", data: "QUJDREVGR0hJSktMTU5PUA==" };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("server-store", () => {
  it("預けたものを 1 回だけ取り出せる（one-time）", () => {
    const c = clock();
    const s = createRelayStore(c.now);
    const put = s.put("123456", PAYLOAD, "owner");
    expect(put).toEqual({ ok: true, expiresAt: c.now() + RELAY_TTL_MS });
    const first = s.take("123456", "ip1");
    expect(first).toEqual({ ok: true, payload: PAYLOAD });
    expect(s.take("123456", "ip1")).toEqual({ ok: false, reason: "not_found" });
    expect(s.size()).toBe(0);
  });

  it("10 分たつと取り出せない（9 分 59 秒まではOK）", () => {
    const c = clock();
    const s = createRelayStore(c.now);
    s.put("111111", PAYLOAD, "owner");
    s.put("222222", PAYLOAD, "owner");
    c.advance(RELAY_TTL_MS - 1000);
    expect(s.take("111111", "ip1").ok).toBe(true);
    c.advance(1000);
    expect(s.take("222222", "ip1")).toEqual({ ok: false, reason: "not_found" });
    expect(s.size()).toBe(0);
  });

  it("同じコードの二重登録は断る。取り出し・期限切れのあとは使える", () => {
    const c = clock();
    const s = createRelayStore(c.now);
    s.put("123456", PAYLOAD, "owner");
    expect(s.put("123456", PAYLOAD, "owner")).toEqual({ ok: false, reason: "exists" });
    c.advance(RELAY_TTL_MS);
    expect(s.put("123456", PAYLOAD, "owner").ok).toBe(true);
  });

  it("2 MB を超えると断る。ちょうどなら預かる", () => {
    const s = createRelayStore();
    const fixed = PAYLOAD.iv.length + PAYLOAD.salt.length;
    expect(s.put("123456", { ...PAYLOAD, data: "A".repeat(RELAY_MAX_BYTES - fixed) }, "owner").ok).toBe(true);
    expect(s.put("123457", { ...PAYLOAD, data: "A".repeat(RELAY_MAX_BYTES - fixed + 1) }, "owner")).toEqual({ ok: false, reason: "too_large" });
  });

  it("6 桁でないコードは登録できない", () => {
    const s = createRelayStore();
    expect(s.put("12345", PAYLOAD, "owner")).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("預かる件数の上限を超えたら断る", () => {
    const s = createRelayStore();
    for (let i = 0; i < MAX_ENTRIES; i++) expect(s.put(String(i).padStart(6, "0"), PAYLOAD, "owner").ok).toBe(true);
    expect(s.put("999999", PAYLOAD, "owner")).toEqual({ ok: false, reason: "full" });
  });

  it("取り出し失敗が 1 分に 20 回を超えたら、その IP は 1 分止まる（正しいコードでも）", () => {
    const c = clock();
    const s = createRelayStore(c.now);
    s.put("123456", PAYLOAD, "owner");
    for (let i = 0; i < MAX_FAILS; i++) {
      expect(s.take(String(i).padStart(6, "0"), "bad")).toEqual({ ok: false, reason: "not_found" });
    }
    const blocked = s.take("000099", "bad");
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    // 止まっている間は、正しいコードでも取り出せない（データは残る）
    expect(s.take("123456", "bad")).toMatchObject({ ok: false, reason: "rate_limited" });
    // 別の IP は影響を受けない
    expect(s.take("123456", "good")).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("止まっていた IP は 1 分後に戻る。失敗の数え直しも 1 分ごと", () => {
    const c = clock();
    const s = createRelayStore(c.now);
    for (let i = 0; i <= MAX_FAILS; i++) s.take("000001", "bad");
    expect(s.take("000001", "bad")).toMatchObject({ reason: "rate_limited" });
    c.advance(BLOCK_MS);
    s.put("123456", PAYLOAD, "owner");
    expect(s.take("123456", "bad")).toEqual({ ok: true, payload: PAYLOAD });

    // 窓が過ぎれば失敗の数は 0 に戻る
    const c2 = clock();
    const s2 = createRelayStore(c2.now);
    for (let i = 0; i < MAX_FAILS; i++) s2.take("000001", "ip");
    c2.advance(60_000);
    for (let i = 0; i < MAX_FAILS; i++) expect(s2.take("000001", "ip")).toEqual({ ok: false, reason: "not_found" });
  });

  it("6 桁でない値の取り出しも失敗として数える", () => {
    const s = createRelayStore();
    for (let i = 0; i < MAX_FAILS; i++) s.take("", "ip");
    expect(s.take("", "ip")).toMatchObject({ reason: "rate_limited" });
  });
});

/* ---------------- exportForRelay ---------------- */

function pat(id: string, family: string, groupIds: string[] = []): Patient {
  return {
    ...createEmptyPatient(),
    id,
    familyName: family,
    givenName: "太郎",
    birthDate: "1940-04-01",
    groupIds,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
function grp(id: string, name: string, manualOrder: string[] = []): Group {
  return { id, name, sortMode: "manual", manualOrder, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("exportForRelay", () => {
  const store = {
    ...createEmptyStore(),
    patients: [pat("a", "架空一", ["g1"]), pat("b", "架空二", ["g1", "g2"]), pat("c", "架空三")],
    groups: [grp("g1", "A棟", ["b", "a"]), grp("g2", "B棟", ["b"]), grp("g3", "空")],
  };

  it("全体: 書き出しファイルと同じ形で、parseExport で読み戻せる（整形なし）", () => {
    const json = exportForRelay(store, "2026-11-05T00:00:00.000Z");
    expect(json).not.toBeNull();
    expect(json).not.toContain("\n");
    const r = parseExport(json as string);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.patients).toHaveLength(3);
      expect(r.file.groups).toHaveLength(3);
      expect(r.file.exportedAt).toBe("2026-11-05T00:00:00.000Z");
    }
  });

  it("1 人: その人と、その人が入っているグループだけ（手動並びはその人だけ）", () => {
    const r = parseExport(exportForRelay(store, "2026-11-05T00:00:00.000Z", "a") as string);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.patients.map((p) => p.id)).toEqual(["a"]);
      expect(r.file.groups.map((g) => g.id)).toEqual(["g1"]);
      expect(r.file.groups[0].manualOrder).toEqual(["a"]);
    }
  });

  it("グループの外の人は、グループなしで書き出す", () => {
    const r = parseExport(exportForRelay(store, "2026-11-05T00:00:00.000Z", "c") as string);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.groups).toEqual([]);
      expect(r.file.patients[0].groupIds).toEqual([]);
    }
  });

  it("元の store は変えない。いない id は null", () => {
    const before = JSON.stringify(store);
    exportForRelay(store, "2026-11-05T00:00:00.000Z", "a");
    expect(JSON.stringify(store)).toBe(before);
    expect(exportForRelay(store, "2026-11-05T00:00:00.000Z", "zzz")).toBeNull();
  });

  it("暗号化して復号しても、読み込める内容のまま", async () => {
    const json = exportForRelay(store, "2026-11-05T00:00:00.000Z", "b") as string;
    const back = await decryptFromRelay(await encryptForRelay(json, "424242"), "424242");
    expect(back).toBe(json);
    expect(parseExport(back).ok).toBe(true);
  });
});
