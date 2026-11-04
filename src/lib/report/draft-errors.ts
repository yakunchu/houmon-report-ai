/**
 * 下書き作成の失敗を、画面に出す日本語・原因コード・再試行可否に分類する（純関数）。
 * サーバー専用。例外の本文・API キー・会話はここでも出さない（message は固定文のみ。モデル名だけ埋め込む）。
 * SDK のエラークラス: node_modules/@anthropic-ai/sdk/core/error.d.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { MissingApiKeyError } from "../claude/client";
import type { DraftResponse } from "./schema";

export type DraftError = Extract<DraftResponse, { ok: false }>;

function make(
  error: DraftError["error"],
  code: string,
  retryable: boolean,
  message: string,
): DraftError {
  return { ok: false, error, message, code, retryable };
}

/** 残高不足（credit balance）によるエラーか。文言は公式未確認のため部分一致で見る */
export function isCreditBalanceError(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  // billing_error は SDK の ErrorType に含まれる（残高・請求の問題）
  if (e.type === "billing_error") return true;
  if (!(e instanceof Anthropic.BadRequestError)) return false;
  return /credit balance/i.test(e.message);
}

/** 入力の検証エラー（サーバー側で弾いた場合） */
export function badInputError(message: string): DraftError {
  return make("invalid_request", "bad_request", false, message);
}

/** stop_reason が refusal（安全上の理由で下書き不可） */
export function refusalError(): DraftError {
  return make("refusal", "refusal", false, "安全上の理由で下書きを作れませんでした。会話の内容を確認してください");
}

/** stop_reason が max_tokens（出力が途中で切れた） */
export function maxTokensError(): DraftError {
  return make(
    "max_tokens",
    "max_tokens",
    true,
    "出力が途中で切れたため下書きを作れませんでした。会話を短くするか、もう一度お試しください",
  );
}

/** 出力を形式どおりに読み取れなかった */
export function unparsedError(): DraftError {
  return make("unknown", "unknown", true, "下書きを形式どおりに読み取れませんでした。もう一度お試しください");
}

/** SDK 等の例外を DraftError に分類する */
export function classifyDraftError(e: unknown, ctx: { model: string }): DraftError {
  if (e instanceof MissingApiKeyError) {
    return make("invalid_request", "auth", false, "サーバーに API キーが設定されていません。管理者（社長）に連絡してください");
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return make("invalid_request", "auth", false, "API キーが無効です。管理者に連絡してください");
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return make("invalid_request", "permission", false, "API キーの権限がありません。管理者に連絡してください");
  }
  // 残高不足は 400 で返る。BadRequestError の一般処理より先に見る
  if (isCreditBalanceError(e)) {
    return make(
      "server_error",
      "credit_balance",
      false,
      "API の残高が不足しています。管理者（社長）に連絡してください。復旧するまで下書きは作れません",
    );
  }
  if (e instanceof Anthropic.NotFoundError) {
    return make(
      "invalid_request",
      "model_not_found",
      false,
      `モデル名の設定が正しくありません（${ctx.model}）。管理者に連絡してください`,
    );
  }
  if (e instanceof Anthropic.BadRequestError) {
    return make(
      "invalid_request",
      "bad_request",
      false,
      "リクエストの内容に問題がありました。会話を短くするか、内容を確認してください",
    );
  }
  if (e instanceof Anthropic.RateLimitError) {
    return make(
      "rate_limited",
      "rate_limited",
      true,
      "短時間に続けて作成したため、しばらく待つ必要があります。30 秒ほど待ってからもう一度お試しください",
    );
  }
  // 429 以外の 5xx（529 = 過負荷を含む）
  if (e instanceof Anthropic.InternalServerError) {
    return make(
      "server_error",
      e.status === 529 ? "overloaded" : "server_error",
      true,
      "AI のサーバーが混み合っています。少し待ってからもう一度お試しください",
    );
  }
  // タイムアウトは APIConnectionError のサブクラスなので先に判定する
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return make("network", "timeout", true, "時間内に応答がありませんでした。もう一度お試しください");
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return make(
      "network",
      "network",
      true,
      "AI のサーバーに接続できませんでした。パソコン（サーバー）側のインターネット接続を確認してください",
    );
  }
  return make("unknown", "unknown", true, "下書きを作る途中で予期しない問題が起きました。もう一度お試しください");
}
