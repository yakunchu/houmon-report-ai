import { describe, expect, it } from "vitest";
import { RELAY_TTL_MS } from "./crypto";
import { BLOCK_MS, FAIL_WINDOW_MS, GLOBAL_MAX_FAILS, MAX_FAILS, createRelayStore } from "./server-store";

// すべて架空の値（暗号文の代わりに短い base64 風の文字列）
const PAYLOAD = { iv: "aaaa", salt: "bbbb", data: "cccc" };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("受け渡しの預かり", () => {
  it("預けて 1 回だけ取り出せる（取り出したら消える）", () => {
    const store = createRelayStore(clock().now);
    expect(store.put("123456", PAYLOAD, "a").ok).toBe(true);
    expect(store.take("123456", "b")).toEqual({ ok: true, payload: PAYLOAD });
    expect(store.take("123456", "b")).toEqual({ ok: false, reason: "not_found" });
  });

  it("10 分たつと取り出せない", () => {
    const c = clock();
    const store = createRelayStore(c.now);
    store.put("123456", PAYLOAD, "a");
    c.advance(RELAY_TTL_MS + 1);
    expect(store.take("123456", "b")).toEqual({ ok: false, reason: "not_found" });
  });

  it("同じコードをもう一度預けると exists", () => {
    const store = createRelayStore(clock().now);
    store.put("123456", PAYLOAD, "a");
    expect(store.put("123456", PAYLOAD, "a")).toEqual({ ok: false, reason: "exists" });
  });
});

describe("失敗の数え方（総当たり対策）", () => {
  it("取り出しの失敗が MAX_FAILS を超えた IP は止まる。ほかの IP はまだ使える", () => {
    const store = createRelayStore(clock().now);
    for (let i = 0; i < MAX_FAILS; i++) expect(store.take("000000", "x")).toEqual({ ok: false, reason: "not_found" });
    const r = store.take("000000", "x");
    expect(r.ok === false && r.reason === "rate_limited").toBe(true);
    expect(store.take("000000", "y")).toEqual({ ok: false, reason: "not_found" });
  });

  it("預けるときの exists（409）も失敗として数え、続ければ止まる。止まったあとは存在の確認もできない", () => {
    const store = createRelayStore(clock().now);
    store.put("123456", PAYLOAD, "owner");
    let limited = false;
    for (let i = 0; i < MAX_FAILS + 5; i++) {
      const r = store.put("123456", PAYLOAD, "attacker");
      if (!r.ok && r.reason === "rate_limited") limited = true;
      else expect(r).toEqual({ ok: false, reason: "exists" });
    }
    expect(limited).toBe(true);
    // 止まっている間は、預かり中のコードでも空きのコードでも同じ 429 になり、違いが見えない
    const taken = store.put("123456", PAYLOAD, "attacker");
    const free = store.put("654321", PAYLOAD, "attacker");
    expect(taken).toEqual(free);
    expect(taken.ok === false && taken.reason === "rate_limited").toBe(true);
  });

  it("IP を毎回変えても、全体の失敗が GLOBAL_MAX_FAILS を超えたら全員が止まる", () => {
    const store = createRelayStore(clock().now);
    for (let i = 0; i < GLOBAL_MAX_FAILS; i++) {
      expect(store.take("000000", `spoofed-${i}`)).toEqual({ ok: false, reason: "not_found" });
    }
    const r = store.take("000000", "spoofed-new");
    expect(r.ok === false && r.reason === "rate_limited").toBe(true);
    // 止まっている間は、預けることもできない
    const c = store.put("111111", PAYLOAD, "someone");
    expect(c.ok === false && c.reason === "rate_limited").toBe(true);
  });

  it("全体の失敗には、預けるときの exists も数える（IP を変えて exists を探っても止まる）", () => {
    const store = createRelayStore(clock().now);
    store.put("123456", PAYLOAD, "owner");
    let limitedAt = -1;
    for (let i = 0; i < GLOBAL_MAX_FAILS + 5; i++) {
      const r = store.put("123456", PAYLOAD, `spoofed-${i}`);
      if (!r.ok && r.reason === "rate_limited") {
        limitedAt = i;
        break;
      }
    }
    // GLOBAL_MAX_FAILS 回までは exists、次の失敗（101 回目）で全体が止まる
    expect(limitedAt).toBe(GLOBAL_MAX_FAILS);
  });

  it("止める期間が過ぎれば、また使える", () => {
    const c = clock();
    const store = createRelayStore(c.now);
    for (let i = 0; i <= GLOBAL_MAX_FAILS; i++) store.take("000000", `s-${i}`);
    expect(store.put("111111", PAYLOAD, "a").ok).toBe(false);
    c.advance(BLOCK_MS + 1);
    expect(store.put("111111", PAYLOAD, "a").ok).toBe(true);
    expect(store.take("111111", "b").ok).toBe(true);
  });

  it("成功した取り出しは失敗に数えない", () => {
    const store = createRelayStore(clock().now);
    for (let i = 0; i < MAX_FAILS * 3; i++) {
      const code = String(100000 + i);
      expect(store.put(code, PAYLOAD, "a").ok).toBe(true);
      expect(store.take(code, "b").ok).toBe(true);
    }
    expect(store.take("000000", "b")).toEqual({ ok: false, reason: "not_found" });
  });

  it("失敗を数える窓が過ぎれば、数え直す", () => {
    const c = clock();
    const store = createRelayStore(c.now);
    for (let i = 0; i < MAX_FAILS; i++) store.take("000000", "x");
    c.advance(FAIL_WINDOW_MS + 1);
    for (let i = 0; i < MAX_FAILS; i++) expect(store.take("000000", "x")).toEqual({ ok: false, reason: "not_found" });
  });
});
