/**
 * 報告書の下書きを Claude に作らせる（サーバー専用）。
 *
 * - Structured Outputs（output_config.format）のみ使う。Opus 5.5 は thinking を無効化できず
 *   tool_choice の強制もできないため、tools は使わない。
 * - messages.parse() は max_tokens で JSON が途中切れのとき例外を投げて stop_reason が見えなくなる。
 *   そのため messages.create() で受け取り、stop_reason を先に判定してから同じ zodOutputFormat の
 *   parse() で読む（自動パースと同じ検証をしつつ、refusal / max_tokens を確実に区別するため）。
 * - 会話本文と API キーはログに出さない（console.error はエラー種別と status のみ）。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createClient, getModelConfig, MissingApiKeyError } from "../claude/client";
import { buildSystemBlocks, buildUserMessage } from "./prompt";
import { DraftRequestSchema, ReportDraftSchema, type DraftRequest, type DraftResponse } from "./schema";

type DraftError = Extract<DraftResponse, { ok: false }>;

function fail(error: DraftError["error"], message: string): DraftError {
  return { ok: false, error, message };
}

/** SDK 等の例外を画面に出せる日本語に変換する */
function toDraftError(e: unknown): DraftError {
  if (e instanceof MissingApiKeyError) {
    return fail("server_error", "サーバーに ANTHROPIC_API_KEY が設定されていません。.env に書いてから起動し直してください");
  }
  if (e instanceof Anthropic.RateLimitError) {
    return fail("rate_limited", "リクエストが集中しています。少し待ってからもう一度お試しください");
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return fail("invalid_request", "API キーが認識されませんでした。APIキーを確認してください");
  }
  if (e instanceof Anthropic.BadRequestError) {
    // 残高不足は 400 で返る。入力の問題ではないので別の案内にする（文言は公式一覧で要確認のため部分一致で見る）
    if (isCreditBalanceError(e)) {
      return fail("server_error", "APIの残高が不足しています。管理者に連絡してください");
    }
    return fail("invalid_request", "リクエストの内容に問題がありました。会話テキストや設定を確認してください");
  }
  // モデル名の綴り誤り（404）・キーの権限不足（403）は、待っても直らない
  if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.PermissionDeniedError) {
    return fail("invalid_request", "モデル名またはAPIキーの権限を確認してください");
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return fail("network", "Claude に接続できませんでした。ネットワークを確認して、もう一度お試しください");
  }
  if (e instanceof Anthropic.APIError) {
    return fail("server_error", "Claude 側で一時的な問題が起きています。しばらくしてからもう一度お試しください");
  }
  return fail("unknown", "下書きを作る途中で予期しない問題が起きました。もう一度お試しください");
}

/** 400 のうち、残高不足（credit balance）によるものか */
function isCreditBalanceError(e: Error): boolean {
  return /credit balance/i.test(e.message);
}

/** 本文を含まない形でエラー種別だけ記録する（name / status / API の error.type。e.message は出さない） */
function logError(e: unknown): void {
  const name = e instanceof Error ? e.name : typeof e;
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  const type = e instanceof Anthropic.APIError ? e.type : undefined;
  const credit = e instanceof Anthropic.BadRequestError && isCreditBalanceError(e);
  console.error(
    `[draft] error=${name}${status !== undefined ? ` status=${status}` : ""}${type ? ` type=${type}` : ""}${credit ? " reason=credit_balance" : ""}`,
  );
}

export async function draftReport(req: DraftRequest): Promise<DraftResponse> {
  const parsedReq = DraftRequestSchema.safeParse(req);
  if (!parsedReq.success) {
    return fail("invalid_request", "入力内容が正しくありません。宛先・会話テキスト・基本情報を確認してください");
  }
  const request = parsedReq.data;
  const startedAt = Date.now();

  try {
    const client = createClient();
    const { model, effort } = getModelConfig();
    const format = zodOutputFormat(ReportDraftSchema);

    const message = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort, format },
      system: buildSystemBlocks(),
      messages: [{ role: "user", content: buildUserMessage(request) }],
    });

    if (message.stop_reason === "refusal") {
      return fail("refusal", "安全上の理由で下書きを作れませんでした。会話の内容を確認してください");
    }
    if (message.stop_reason === "max_tokens") {
      return fail("max_tokens", "出力が途中で切れたため下書きを作れませんでした。会話を短くするか、もう一度お試しください");
    }

    // text ブロックは 1 つだけ想定（thinking ブロックは読み飛ばす）
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let draft;
    try {
      draft = format.parse(text);
    } catch {
      draft = null;
    }
    if (!draft) {
      return fail("unknown", "下書きを形式どおりに読み取れませんでした。もう一度お試しください");
    }

    const u = message.usage;
    return {
      ok: true,
      draft,
      model,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    logError(e);
    return toDraftError(e);
  }
}
