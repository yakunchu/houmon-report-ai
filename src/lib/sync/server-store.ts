/**
 * 受け渡しコードで預かる暗号化済みデータの置き場（サーバーのメモリだけ。ディスクには書かない）。
 * - 10 分で消える・1 回取り出したら消える（one-time）・2 MB まで。
 * - 「失敗」とは、取り出しで見つからない・期限切れ・6 桁でない、または預けるときに同じコードがすでに使われている（exists）こと。
 *   exists は「いま預かり中のコード」が分かってしまうので、取り出しの失敗と同じ扱いで数える。
 * - 失敗が 1 分に 20 回を超えた IP は 1 分間、預ける・取り出すのどちらもできない。
 * - IP は相手が偽れることがあるので（http.ts の clientId を参照）、IP に関係なく全体でも数える。
 *   全体で 1 分に 100 回失敗したら、全員を 1 分間止める（総当たりの速さを、IP を変えても一定以下にする）。
 * - payload（暗号文）も code も、ログには出さない。このファイルは console を使わない。
 * サーバーを再起動すると預かり分は消える（それでよい）。
 */
import { RELAY_MAX_BYTES, RELAY_TTL_MS, isRelayCode, type RelayPayload } from "./crypto";

/** 同時に預かる件数の上限（メモリを食いつぶされないように） */
export const MAX_ENTRIES = 200;
/** 失敗を数える期間と、止める期間 */
export const FAIL_WINDOW_MS = 60_000;
export const BLOCK_MS = 60_000;
/** 1 つの窓の中で IP ごとに許す失敗の回数（これを超えたら止める） */
export const MAX_FAILS = 20;
/** 1 つの窓の中で、IP に関係なく全体で許す失敗の回数（これを超えたら全員を止める） */
export const GLOBAL_MAX_FAILS = 100;
/** 失敗を覚えておく IP の上限 */
const MAX_TRACKED_CLIENTS = 5000;

type Entry = { payload: RelayPayload; expiresAt: number; fetches: number };
type Fail = { windowStart: number; count: number; blockedUntil: number };

export type PutResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "invalid_code" | "too_large" | "exists" | "full" }
  | { ok: false; reason: "rate_limited"; retryAfterSec: number };

export type TakeResult =
  | { ok: true; payload: RelayPayload }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "rate_limited"; retryAfterSec: number };

export type RelayStore = {
  put(code: string, payload: RelayPayload, clientId: string): PutResult;
  take(code: string, clientId: string): TakeResult;
  /** 預かっている件数（期限切れを除く） */
  size(): number;
};

/** payload の大きさ（base64 の文字数の合計） */
export function payloadSize(p: RelayPayload): number {
  return p.iv.length + p.salt.length + p.data.length;
}

export function createRelayStore(now: () => number = Date.now): RelayStore {
  const entries = new Map<string, Entry>();
  const fails = new Map<string, Fail>();
  const globalFail: Fail = { windowStart: 0, count: 0, blockedUntil: 0 };

  const idle = (f: Fail, t: number) => f.blockedUntil <= t && f.windowStart + FAIL_WINDOW_MS <= t;

  function sweep(t: number): void {
    for (const [code, e] of entries) if (e.expiresAt <= t) entries.delete(code);
    for (const [id, f] of fails) if (idle(f, t)) fails.delete(id);
  }

  /** この窓の失敗を 1 つ数える。上限を超えたら止める期間に入る */
  function bump(f: Fail, max: number, t: number): void {
    f.count++;
    if (f.count > max) {
      f.blockedUntil = t + BLOCK_MS;
      f.windowStart = t;
      f.count = 0;
    }
  }

  function recordFail(clientId: string, t: number): void {
    // 全体
    if (globalFail.blockedUntil <= t && globalFail.windowStart + FAIL_WINDOW_MS <= t) {
      globalFail.windowStart = t;
      globalFail.count = 0;
    }
    bump(globalFail, GLOBAL_MAX_FAILS, t);

    // IP ごと
    let f = fails.get(clientId);
    if (!f || idle(f, t)) {
      if (!f && fails.size >= MAX_TRACKED_CLIENTS) {
        sweep(t);
        if (fails.size >= MAX_TRACKED_CLIENTS) {
          const oldest = fails.keys().next().value;
          if (oldest !== undefined) fails.delete(oldest);
        }
      }
      f = { windowStart: t, count: 0, blockedUntil: 0 };
      fails.delete(clientId);
      fails.set(clientId, f);
    }
    bump(f, MAX_FAILS, t);
  }

  /** 止められているなら、あと何秒か（止められていなければ 0） */
  function blockedSec(clientId: string, t: number): number {
    const until = Math.max(globalFail.blockedUntil, fails.get(clientId)?.blockedUntil ?? 0);
    return until > t ? Math.max(1, Math.ceil((until - t) / 1000)) : 0;
  }

  return {
    put(code, payload, clientId) {
      const t = now();
      const wait = blockedSec(clientId, t);
      if (wait > 0) return { ok: false, reason: "rate_limited", retryAfterSec: wait };
      if (!isRelayCode(code)) return { ok: false, reason: "invalid_code" };
      if (payloadSize(payload) > RELAY_MAX_BYTES) return { ok: false, reason: "too_large" };
      sweep(t);
      if (entries.has(code)) {
        // 「そのコードは使われている」と教える応答なので、取り出しの失敗と同じく数える
        recordFail(clientId, t);
        const after = blockedSec(clientId, t);
        if (after > 0) return { ok: false, reason: "rate_limited", retryAfterSec: after };
        return { ok: false, reason: "exists" };
      }
      if (entries.size >= MAX_ENTRIES) return { ok: false, reason: "full" };
      const expiresAt = t + RELAY_TTL_MS;
      entries.set(code, { payload: { iv: payload.iv, salt: payload.salt, data: payload.data }, expiresAt, fetches: 0 });
      return { ok: true, expiresAt };
    },

    take(code, clientId) {
      const t = now();
      const wait = blockedSec(clientId, t);
      if (wait > 0) return { ok: false, reason: "rate_limited", retryAfterSec: wait };
      const e = isRelayCode(code) ? entries.get(code) : undefined;
      if (e && e.expiresAt > t) {
        e.fetches++;
        entries.delete(code); // one-time: 取り出したら消す
        return { ok: true, payload: e.payload };
      }
      if (e) entries.delete(code); // 期限切れ
      recordFail(clientId, t);
      const after = blockedSec(clientId, t);
      if (after > 0) return { ok: false, reason: "rate_limited", retryAfterSec: after };
      return { ok: false, reason: "not_found" };
    },

    size() {
      sweep(now());
      return entries.size;
    },
  };
}

/** サーバー全体で 1 つ。開発中のモジュール再読み込みで中身が消えないよう globalThis に置く */
const GLOBAL_KEY = "__houmonRelayStore";

export function getRelayStore(): RelayStore {
  const g = globalThis as unknown as Record<string, RelayStore | undefined>;
  let s = g[GLOBAL_KEY];
  if (!s) {
    s = createRelayStore();
    g[GLOBAL_KEY] = s;
  }
  return s;
}
