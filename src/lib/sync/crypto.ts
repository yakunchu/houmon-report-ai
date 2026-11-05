/**
 * 受け渡しコード用の暗号化（WebCrypto だけ。ブラウザでも Node でも globalThis.crypto で動く）。
 * - 6 桁の数字のコードから PBKDF2（SHA-256・200,000 回・salt 16 バイト）で AES-GCM 256 の鍵を作る。
 * - 暗号化は端末の中で行い、サーバーには { iv, salt, data }（すべて base64）だけを預ける。
 *   ただしコードそのものも、預ける・取り出すときにサーバーへ送られる。サーバーは復号できる。暗号化の意味は「平文の患者リストをサーバーのメモリやログにそのまま置かない」程度に限られる（http の LAN ではコードも通信路上で見える）。
 * - 注意: 6 桁は 100 万通りしかない。強さの土台はコードの短さではなく、
 *   「10 分で消える・1 回で消える・失敗が続いたら止める」というサーバー側の制限と、同じ Wi-Fi 内という前提。
 */

/** サーバーに預ける時間（ミリ秒） */
export const RELAY_TTL_MS = 10 * 60 * 1000;
/** 預けられる大きさの上限（iv・salt・data の base64 文字数の合計） */
export const RELAY_MAX_BYTES = 2 * 1024 * 1024;
/** コードの桁数 */
export const RELAY_CODE_LENGTH = 6;

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type RelayPayload = { iv: string; salt: string; data: string };

/** 復号・暗号化に失敗したときの例外（message は画面に出してよい日本語。中身の情報は入れない） */
export class RelayCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayCryptoError";
  }
}

const CODE_PATTERN = /^\d{6}$/;

/** 6 桁の数字か */
export function isRelayCode(code: unknown): code is string {
  return typeof code === "string" && CODE_PATTERN.test(code);
}

/** 6 桁の数字のコードを作る（crypto.getRandomValues。偏りが出ないよう端数は引き直す） */
export function generateCode(): string {
  const space = 10 ** RELAY_CODE_LENGTH;
  const limit = Math.floor(0x1_0000_0000 / space) * space; // これ未満の値だけ使うと 0〜999999 が同じ確率になる
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % space).padStart(RELAY_CODE_LENGTH, "0");
  }
}

/* ---- base64（btoa/atob は Node 16 以降・ブラウザの両方にある） ---- */

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new RelayCryptoError("受け取ったデータの形式が正しくありません");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(code: string, salt: Uint8Array<ArrayBuffer>, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** 平文（JSON 文字列）をコードで暗号化する */
export async function encryptForRelay(plainJson: string, code: string): Promise<RelayPayload> {
  if (!isRelayCode(code)) throw new RelayCryptoError("コードは 6 桁の数字です");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(code, salt, "encrypt");
  const cipher = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainJson));
  return { iv: toBase64(iv), salt: toBase64(salt), data: toBase64(new Uint8Array(cipher)) };
}

/** コードで復号する。コード違い・改ざん・壊れたデータは RelayCryptoError */
export async function decryptFromRelay(payload: RelayPayload, code: string): Promise<string> {
  if (!isRelayCode(code)) throw new RelayCryptoError("コードは 6 桁の数字です");
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.iv !== "string" ||
    typeof payload.salt !== "string" ||
    typeof payload.data !== "string"
  ) {
    throw new RelayCryptoError("受け取ったデータの形式が正しくありません");
  }
  const iv = fromBase64(payload.iv);
  const salt = fromBase64(payload.salt);
  const data = fromBase64(payload.data);
  if (iv.length !== IV_BYTES || salt.length !== SALT_BYTES || data.length < 16) {
    throw new RelayCryptoError("受け取ったデータの形式が正しくありません");
  }
  try {
    const key = await deriveKey(code, salt, "decrypt");
    const plain = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    // AES-GCM は、鍵（コード）が違う・1 バイトでも書き換えられた、のどちらでもここに来る
    throw new RelayCryptoError("復号できませんでした（コードが違うか、データが壊れています）");
  }
}
