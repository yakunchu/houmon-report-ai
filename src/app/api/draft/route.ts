/**
 * POST /api/draft: マスク済みの会話 + 宛先を受け取り、報告書の下書きを返す。
 * 本文はログに残さない・保存しない。
 * ※ next.config.ts で cacheComponents が有効なため `export const runtime` は書かない
 *   （Next.js 16 のドキュメント: Cache Components では runtime の export は非対応。既定が Node.js）。
 */
import { badInputError } from "@/lib/report/draft-errors";
import { draftReport } from "@/lib/report/draft";
import { DraftRequestSchema, type DraftResponse } from "@/lib/report/schema";

function invalid(message: string): Response {
  return Response.json(badInputError(message), { status: 400 });
}

/**
 * エラー種別 → HTTP ステータス。refusal / max_tokens / unknown は 200（UI が message を表示する）。
 * code / retryable は本文にそのまま入っているので、UI は status ではなくそちらを見る。
 */
function statusFor(res: DraftResponse): number {
  if (res.ok) return 200;
  switch (res.error) {
    case "invalid_request":
      return 400;
    case "rate_limited":
      return 429;
    case "network":
    case "server_error":
      return 502;
    default:
      return 200;
  }
}

export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return invalid("リクエストの形式が正しくありません（JSON を送ってください）");
  }

  const parsed = DraftRequestSchema.safeParse(json);
  if (!parsed.success) {
    return invalid("入力内容が正しくありません。宛先・会話テキスト（30000文字以内）・基本情報を確認してください");
  }

  // 画面が中止・切断したら API 呼び出しも止める（request.signal を渡す）
  const result = await draftReport(parsed.data, { signal: request.signal });
  // ok:false の code / retryable を含め、分類結果をそのまま返す
  return Response.json(result, { status: statusFor(result) });
}
