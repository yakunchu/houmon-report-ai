/**
 * 受け渡しコード用の中継（預ける側）。暗号化済みのデータ（iv・salt・data）を、サーバーのメモリに 10 分だけ預ける。
 * - POST { code, iv, salt, data } → 202 { expiresAt, ttlSeconds }
 *   同じコードがすでに預かり中なら 409。これは「そのコードが使われている」と分かる応答なので、
 *   取り出しの失敗と同じカウンター（IP ごと・全体）で数え、数えすぎれば 429 にする。
 * - 取り出しは POST /api/sync/take（./take/route.ts）。コードを URL に載せないため、GET は用意しない。
 * - HOUMON_SYNC=on と明示したときだけ有効。それ以外（未設定・off など）は 404（公開先で設定し忘れても開かない）。
 * 注意: サーバーは復号に使うコード（code）も受け取るので、預かった中身を復号できる。
 *   暗号化の意味は「平文の患者リストをサーバーのメモリやログにそのまま置かない」程度で、サーバーを動かす PC の持ち主には読める。
 *   このアプリは本文（コード・payload）をログに出さない。
 * ※ next.config.ts で cacheComponents が有効なため `export const runtime` は書かない
 *   （Cache Components では runtime の export は非対応。既定が Node.js）。
 */
import { connection } from "next/server";
import { z } from "zod";
import { RELAY_MAX_BYTES, RELAY_TTL_MS } from "@/lib/sync/crypto";
import { clientId, readJsonBody, reply, syncEnabled } from "@/lib/sync/http";
import { getRelayStore } from "@/lib/sync/server-store";

/** JSON の枠（キー名など）の余裕 */
const BODY_OVERHEAD = 1024;

const b64 = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/);

const PostBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  iv: b64(64),
  salt: b64(64),
  data: b64(RELAY_MAX_BYTES),
});

export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!syncEnabled()) return reply(404, { error: "not_found" });

  const body = await readJsonBody(request, RELAY_MAX_BYTES + BODY_OVERHEAD);
  if (!body.ok) return reply(body.status, { error: body.error });
  const parsed = PostBodySchema.safeParse(body.json);
  if (!parsed.success) return reply(400, { error: "invalid" });

  const { code, iv, salt, data } = parsed.data;
  const result = getRelayStore().put(code, { iv, salt, data }, clientId(request));
  if (!result.ok) {
    switch (result.reason) {
      case "too_large":
        return reply(413, { error: "too_large" });
      case "exists":
        return reply(409, { error: "exists" });
      case "full":
        return reply(503, { error: "full" });
      case "rate_limited":
        return reply(
          429,
          { error: "rate_limited", retryAfterSec: result.retryAfterSec },
          { "Retry-After": String(result.retryAfterSec) },
        );
      default:
        return reply(400, { error: "invalid" });
    }
  }
  return reply(202, { expiresAt: result.expiresAt, ttlSeconds: RELAY_TTL_MS / 1000 });
}
