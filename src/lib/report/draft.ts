/**
 * 報告書の下書きを Claude に作らせる（サーバー専用）。
 *
 * - Structured Outputs（output_config.format）のみ使う。Opus 5.5 は thinking を無効化できず
 *   tool_choice の強制もできないため、tools は使わない。
 * - messages.parse() は max_tokens で JSON が途中切れのとき例外を投げて stop_reason が見えなくなる。
 *   そのため messages.create() で受け取り、stop_reason を先に判定してから同じ zodOutputFormat の
 *   parse() で読む（自動パースと同じ検証をしつつ、refusal / max_tokens を確実に区別するため）。
 * - エラー分類は draft-errors.ts（純関数）。画面向けの日本語・code・retryable はそちらで決める。
 * - 会話本文と API キーはログに出さない（console.error はエラー種別・status・code のみ）。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createClient, getModelConfig } from "../claude/client";
import { badInputError, classifyDraftError, maxTokensError, refusalError, unparsedError } from "./draft-errors";
import { buildSystemBlocks, buildUserMessage } from "./prompt";
import { DraftRequestSchema, ReportDraftSchema, type DraftRequest, type DraftResponse } from "./schema";

/** 本文を含まない形でエラー種別だけ記録する（name / status / API の error.type / 分類 code。e.message は出さない） */
function logError(e: unknown, code: string | undefined): void {
  const name = e instanceof Error ? e.name : typeof e;
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  const type = e instanceof Anthropic.APIError ? e.type : undefined;
  console.error(
    `[draft] error=${name}${status !== undefined ? ` status=${status}` : ""}${type ? ` type=${type}` : ""}${code ? ` code=${code}` : ""}`,
  );
}

export type DraftOptions = {
  /** 呼び出し元（画面）が切断・中止したら API 呼び出しも止めるための signal */
  signal?: AbortSignal;
};

export async function draftReport(req: DraftRequest, options: DraftOptions = {}): Promise<DraftResponse> {
  const parsedReq = DraftRequestSchema.safeParse(req);
  if (!parsedReq.success) {
    return badInputError("入力内容が正しくありません。宛先・会話テキスト・基本情報を確認してください");
  }
  const request = parsedReq.data;
  const startedAt = Date.now();

  try {
    const client = createClient();
    const { model, effort } = getModelConfig();
    const format = zodOutputFormat(ReportDraftSchema);

    const message = await client.messages.create(
      {
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort, format },
        system: buildSystemBlocks(),
        messages: [{ role: "user", content: buildUserMessage(request) }],
      },
      { signal: options.signal },
    );

    if (message.stop_reason === "refusal") return refusalError();
    if (message.stop_reason === "max_tokens") return maxTokensError();

    // text ブロックは 1 つだけ想定（thinking ブロックは読み飛ばす）
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let draft;
    try {
      draft = format.parse(text);
    } catch {
      draft = null;
    }
    if (!draft) return unparsedError();

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
    const result = classifyDraftError(e, { model: getModelConfig().model });
    logError(e, result.code);
    return result;
  }
}
