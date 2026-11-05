/**
 * 受け渡しコードのブラウザ側。暗号化・復号は端末の中で行い、/api/sync には暗号文を送る。
 * 注意: 暗号化に使うコードそのものも、預けるとき（POST の本文）と取り出すとき（POST /api/sync/take の本文）にサーバーへ送る。
 *   したがってサーバー（このアプリを動かしている PC）は中身を復号できる。画面の文言もそのとおりに書くこと。
 * 失敗は例外ではなく { ok:false, kind, message } で返す（message は画面にそのまま出せる日本語）。
 */
import { RELAY_MAX_BYTES, RELAY_TTL_MS, RelayCryptoError, decryptFromRelay, encryptForRelay, isRelayCode, type RelayPayload } from "./crypto";

export type RelayErrorKind =
  | "network" // 通信できなかった
  | "not_found" // コードが違う・期限切れ・受け取り済み・この環境では使えない
  | "disabled" // サーバーの設定で受け渡しがオフ
  | "exists" // 同じコードがすでに使われている（別のコードで送り直す）
  | "too_large"
  | "rate_limited"
  | "full"
  | "decrypt" // 復号できない
  | "invalid";

export type SendResult =
  | { ok: true; expiresAt: number; ttlSeconds: number }
  | { ok: false; kind: RelayErrorKind; message: string };

export type ReceiveResult = { ok: true; json: string } | { ok: false; kind: RelayErrorKind; message: string };

const ENDPOINT = "/api/sync";
/** 取り出し。コードは URL ではなく本文で送る（URL はサーバーのログに出るため） */
const TAKE_ENDPOINT = "/api/sync/take";
const TIMEOUT_MS = 20_000;

function fail<K extends RelayErrorKind>(kind: K, message: string): { ok: false; kind: K; message: string } {
  return { ok: false, kind, message };
}

const NETWORK_MESSAGE = "通信できませんでした。同じ Wi-Fi につながっているか確認して、もう一度お試しください。";

async function request(url: string, init: RequestInit): Promise<Response | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function errorBody(res: Response): Promise<{ error?: string; retryAfterSec?: number }> {
  try {
    const j: unknown = await res.json();
    return typeof j === "object" && j !== null ? (j as { error?: string; retryAfterSec?: number }) : {};
  } catch {
    return {};
  }
}

/** 患者リストの JSON をコードで暗号化して、サーバーに 10 分だけ預ける */
export async function sendToRelay(json: string, code: string): Promise<SendResult> {
  if (!isRelayCode(code)) return fail("invalid", "コードは 6 桁の数字です。");

  let payload: RelayPayload;
  try {
    payload = await encryptForRelay(json, code);
  } catch (e) {
    return fail("invalid", e instanceof RelayCryptoError ? e.message : "暗号化できませんでした。もう一度お試しください。");
  }
  if (payload.iv.length + payload.salt.length + payload.data.length > RELAY_MAX_BYTES) {
    return fail("too_large", "データが大きすぎて預けられません（2MB まで）。「いま選んでいる患者だけ」にするか、ファイルで渡してください。");
  }

  const res = await request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, ...payload }),
  });
  if (!res) return fail("network", NETWORK_MESSAGE);

  if (res.status === 202) {
    const b = (await errorBody(res)) as { expiresAt?: unknown; ttlSeconds?: unknown };
    const ttlSeconds = typeof b.ttlSeconds === "number" ? b.ttlSeconds : RELAY_TTL_MS / 1000;
    const expiresAt = typeof b.expiresAt === "number" ? b.expiresAt : Date.now() + ttlSeconds * 1000;
    return { ok: true, expiresAt, ttlSeconds };
  }
  switch (res.status) {
    case 404:
      return fail("disabled", "この環境では受け渡しコードを使えません（サーバーの設定でオフになっています）。ファイルで渡してください。");
    case 409:
      return fail("exists", "同じコードがすでに使われています。もう一度送ってください。");
    case 429: {
      const b = await errorBody(res);
      const sec = typeof b.retryAfterSec === "number" ? b.retryAfterSec : 60;
      return fail("rate_limited", `失敗が続いたため、サーバーが一時的に受け付けを止めています。${sec} 秒ほど待ってからお試しください。`);
    }
    case 413:
      return fail("too_large", "データが大きすぎて預けられません（2MB まで）。「いま選んでいる患者だけ」にするか、ファイルで渡してください。");
    case 503:
      return fail("full", "サーバーが預かれる数がいっぱいです。しばらくしてからもう一度お試しください。");
    case 400:
      return fail("invalid", "送れませんでした。もう一度お試しください。");
    default:
      return fail("network", NETWORK_MESSAGE);
  }
}

/** コードでサーバーから取り出して、端末の中で復号する（取り出すとサーバーからは消える） */
export async function receiveFromRelay(code: string): Promise<ReceiveResult> {
  if (!isRelayCode(code)) return fail("invalid", "コードは 6 桁の数字です。");

  const res = await request(TAKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res) return fail("network", NETWORK_MESSAGE);

  if (res.status === 404) {
    return fail(
      "not_found",
      "このコードの預かりが見つかりません。コードが違うか、10 分の期限が切れたか、すでに受け取り済みか、このサーバーで受け渡しコードがオフになっています。送る側でもう一度「送る」を押してください。",
    );
  }
  if (res.status === 429) {
    const b = await errorBody(res);
    const sec = typeof b.retryAfterSec === "number" ? b.retryAfterSec : 60;
    return fail("rate_limited", `間違いが続いたため、受け取りを止めています。${sec} 秒ほど待ってからお試しください。`);
  }
  if (!res.ok) return fail("network", NETWORK_MESSAGE);

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return fail("decrypt", "受け取ったデータが壊れています。送る側でもう一度「送る」を押してください。");
  }
  try {
    const json = await decryptFromRelay(payload as RelayPayload, code);
    return { ok: true, json };
  } catch (e) {
    // 取り出した時点でサーバーからは消えているので、送り直してもらう
    const base = e instanceof RelayCryptoError ? e.message : "復号できませんでした。";
    return fail("decrypt", `${base} 預かりはすでに消えているため、送る側でもう一度「送る」を押してください。`);
  }
}

/* ---- 預け先のサーバーが、どこにあるように見えるか（画面の説明用） ---- */

export type ServerPlace = { kind: "lan" | "public"; host: string };

/**
 * 画面を開いているホスト名から、預け先のサーバーが「同じ Wi-Fi の PC」か「インターネット上」かを推定する。
 * localhost・ドットのない機器名・127.*・10.*・172.16〜31.*・192.168.*・169.254.*・*.local・IPv6 のローカルは lan、それ以外は public。
 * あくまで見た目からの推定（VPN やトンネルの先は判断できない）。
 */
export function describeRelayServer(host: string): ServerPlace {
  const trimmed = host.trim();
  // 角かっこ付きの IPv6（[::1]:3000）と、ポート付きのホスト名の両方からホスト部分を取り出す
  const name = (trimmed.startsWith("[") ? trimmed.slice(1, trimmed.indexOf("]")) : trimmed.replace(/:\d+$/, "")).toLowerCase();
  const lan =
    // ドットのない名前（pharmacy-pc など）は、同じネットワーク内の機器名
    (name !== "" && !name.includes(".") && !name.includes(":")) ||
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    name === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(name) ||
    /^fe80:/.test(name) ||
    /^127\.\d+\.\d+\.\d+$/.test(name) ||
    /^10\.\d+\.\d+\.\d+$/.test(name) ||
    /^192\.168\.\d+\.\d+$/.test(name) ||
    /^169\.254\.\d+\.\d+$/.test(name) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(name);
  return { kind: lan ? "lan" : "public", host: trimmed };
}
