/**
 * サーバー状態（GET /api/health）と、端末のオンライン状態。
 * - キーの値は扱わない。サーバーが返すのは「設定の有無」だけ。
 * - /api/health が無い・失敗のときは null（画面は何も出さず、そのまま動く）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HealthResponse } from "@/lib/report/schema";

/** 応答の形を確かめて HealthResponse にする。形が違えば null */
export function parseHealth(json: unknown): HealthResponse | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.ok !== "boolean" || typeof o.hasApiKey !== "boolean") return null;
  return {
    ok: o.ok,
    hasApiKey: o.hasApiKey,
    model: typeof o.model === "string" ? o.model : "",
    effort: typeof o.effort === "string" ? o.effort : "",
  };
}

/** /api/health を 1 回呼ぶ。失敗・時間切れ・形が違うときは null */
export async function fetchHealth(timeoutMs = 5000): Promise<HealthResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
    return parseHealth(await r.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** サーバー状態を再確認する間隔（ミリ秒）。要対応（キー未設定など）の間だけ回す */
const RECHECK_INTERVAL_MS = 30_000;

export type ServerHealthState = {
  /** 直近に取れた状態。まだ取れていない・取れたことがないときは null */
  health: HealthResponse | null;
  /** 確認している最中 */
  checking: boolean;
  /** 直近の確認が失敗した（サーバーに届かない・応答が不正） */
  failed: boolean;
  /** いますぐ確認し直す */
  refetch: () => Promise<void>;
};

/**
 * サーバー状態を調べる。
 * - 起動時、端末がオンラインに戻ったとき、画面に戻ったときに取り直す。
 * - 状態が取れていない・要対応（API キー未設定など）の間は 30 秒ごとに取り直す（キーを直したあと、画面を読み込み直さなくてよい）。
 * - 取り直しに失敗したときは、前に取れた状態を残す（電波の一時的な切れで「キー未設定」の表示を消さない）。
 */
export function useServerHealth(): ServerHealthState {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const aliveRef = useRef(true);
  // 新しい確認が始まったら、古い確認の結果は捨てる
  const seqRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const n = ++seqRef.current;
    const h = await fetchHealth();
    if (!aliveRef.current || n !== seqRef.current) return;
    setHealth((prev) => h ?? prev);
    setFailed(h === null);
    setChecking(false);
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    setChecking(true);
    await load();
  }, [load]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const recheck = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      aliveRef.current = false;
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [load]);

  const needsRecheck = health === null || !(describeServer(health)?.ready ?? false);
  useEffect(() => {
    if (!needsRecheck) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, RECHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [needsRecheck, load]);

  return { health, checking, failed, refetch };
}

export type ServerStatus = {
  /** true: 準備OK / false: 要対応 */
  ready: boolean;
  /** API キーが未設定（下書きボタンを止める） */
  keyMissing: boolean;
  /** 画面に出す 1 行 */
  label: string;
};

/** 画面表示用に要約する。health が null（不明）なら null を返す＝何も出さない */
export function describeServer(health: HealthResponse | null): ServerStatus | null {
  if (health === null) return null;
  const model = health.model !== "" ? `（${health.model}）` : "";
  if (!health.hasApiKey) return { ready: false, keyMissing: true, label: "サーバー: API キー未設定" };
  if (!health.ok) return { ready: false, keyMissing: false, label: `サーバー: 確認が必要です${model}` };
  return { ready: true, keyMissing: false, label: `サーバー: 準備OK${model}` };
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** navigator.onLine と online / offline イベントに追従する（サーバー描画時は true） */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
