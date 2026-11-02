/**
 * POST /api/draft: マスク済みの会話 + 宛先を受け取り、報告書の下書きを返す。
 * 本文はログに残さない・保存しない。
 * ※ next.config.ts で cacheComponents が有効なため `export const runtime` は書かない
 *   （Next.js 16 のドキュメント: Cache Components では runtime の export は非対応。既定が Node.js）。
 */
import { draftReport } from "@/lib/report/draft";
import { DraftRequestSchema, type DraftResponse } from "@/lib/report/schema";

type DraftError = Extract<DraftResponse, { ok: false }>;

function invalid(message: string): Response {
  const body: DraftError = { ok: false, error: "invalid_request", message };
  return Response.json(body, { status: 400 });
}

/** エラー種別 → HTTP ステータス。refusal / max_tokens / unknown は 200（UI が message を表示する） */
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

  const result = await draftReport(parsed.data);
  return Response.json(result, { status: statusFor(result) });
}
