/**
 * 受け渡しコード用の中継（取り出す側）。
 * - POST { code } → 200 { iv, salt, data }（取り出したら削除）／404／429
 * - コードは URL ではなく本文で送る（next dev は届いたリクエストの URL をターミナルに出し、プロキシのアクセスログにも残るため）。
 * - 見つからない・期限切れ・6 桁でない値は、すべて「失敗」として IP ごと・全体の両方で数える（上限は server-store.ts）。
 * - HOUMON_SYNC=on と明示したときだけ有効。それ以外は 404。
 * - このアプリは本文（コード・payload）をログに出さない。
 */
import { connection } from "next/server";
import { isRelayCode } from "@/lib/sync/crypto";
import { clientId, readJsonBody, reply, syncEnabled } from "@/lib/sync/http";
import { getRelayStore } from "@/lib/sync/server-store";

/** { "code": "123456" } が入れば十分。大きな本文は読まない */
const MAX_BODY_CHARS = 1024;

export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!syncEnabled()) return reply(404, { error: "not_found" });

  const body = await readJsonBody(request, MAX_BODY_CHARS);
  if (!body.ok) return reply(body.status, { error: body.error });

  const raw = typeof body.json === "object" && body.json !== null ? (body.json as { code?: unknown }).code : undefined;
  // 6 桁でない値も「失敗」として数える（桁違いの総当たりで制限を避けられないように）
  const code = isRelayCode(raw) ? raw : "";
  const result = getRelayStore().take(code, clientId(request));
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return reply(
        429,
        { error: "rate_limited", retryAfterSec: result.retryAfterSec },
        { "Retry-After": String(result.retryAfterSec) },
      );
    }
    return reply(404, { error: "not_found" });
  }
  return reply(200, result.payload);
}
