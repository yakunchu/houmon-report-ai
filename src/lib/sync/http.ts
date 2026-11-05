/**
 * /api/sync 系のルートで共有する小さな部品（サーバー側）。
 * - syncEnabled: 受け渡しコードの有効・無効。HOUMON_SYNC=on と明示したときだけ有効（既定は無効）。
 * - clientId: 失敗を数える相手の識別。ただし IP は相手が偽れることがあるので、守りの主役は「全体の失敗上限」（server-store.ts）。
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * 受け渡しコードを使ってよい環境か。環境変数 HOUMON_SYNC が "on" のときだけ true。
 * 未設定・空・"off"・"false"・"0"・"no" などはすべて無効（公開先で設定し忘れても開かないようにする）。
 */
export function syncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.HOUMON_SYNC ?? "").trim().toLowerCase() === "on";
}

export function reply(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/**
 * 失敗を数える相手の識別（IP ごとの上限に使う）。X-Forwarded-For の最後の値、無ければ X-Real-IP。
 * Next.js は x-forwarded-for を「無いときだけ」付けるので、next dev / next start で直接 LAN に出している構成では、
 * 相手がこのヘッダーを好きな値で送れる（毎回変えれば IP ごとの上限をすり抜けられる）。
 * そのため IP ごとの上限は補助で、全体の失敗上限（server-store.ts の GLOBAL_MAX_FAILS）が本当の歯止め。
 */
export function clientId(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : "unknown";
}

/** 本文を maxChars 文字までの JSON として読む。大きすぎ・壊れていれば理由を返す */
export async function readJsonBody(
  request: Request,
  maxChars: number,
): Promise<{ ok: true; json: unknown } | { ok: false; status: 400 | 413; error: "invalid" | "too_large" }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxChars) return { ok: false, status: 413, error: "too_large" };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "invalid" };
  }
  if (text.length > maxChars) return { ok: false, status: 413, error: "too_large" };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "invalid" };
  }
}
