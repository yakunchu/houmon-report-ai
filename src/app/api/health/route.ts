/**
 * GET /api/health: サーバーの設定状況を返す（API は呼ばない）。
 * キーの値・長さは返さない（設定の有無だけ）。画面の「キー設定の確認」用。
 * next.config.ts で cacheComponents が有効なため、connection() で事前レンダリングから外し、
 * 起動後に .env を直して再起動した結果が毎回反映されるようにする。
 */
import { connection } from "next/server";
import { getModelConfig } from "@/lib/claude/client";
import type { HealthResponse } from "@/lib/report/schema";

export async function GET(): Promise<Response> {
  await connection();
  const { model, effort } = getModelConfig();
  const body: HealthResponse = {
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    model,
    effort,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
