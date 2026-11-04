import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MissingApiKeyError } from "../claude/client";
import {
  badInputError,
  classifyDraftError,
  isCreditBalanceError,
  maxTokensError,
  refusalError,
  unparsedError,
} from "./draft-errors";

const ctx = { model: "claude-test-model" };

/** HTTP 応答を受けた形の API エラーを作る（SDK の generate が status からクラスを選ぶ） */
function apiError(status: number, message: string, type?: string): Error {
  const body = { type: "error", error: { type: type ?? "api_error", message } };
  return Anthropic.APIError.generate(status, body, undefined, new Headers());
}

describe("classifyDraftError", () => {
  it("キー未設定は auth・再試行不可", () => {
    const r = classifyDraftError(new MissingApiKeyError(), ctx);
    expect(r).toMatchObject({ ok: false, error: "invalid_request", code: "auth", retryable: false });
    expect(r.message).toContain("API キーが設定されていません");
  });

  it("401 は auth（キー無効）", () => {
    const e = apiError(401, "invalid x-api-key", "authentication_error");
    expect(e).toBeInstanceOf(Anthropic.AuthenticationError);
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "invalid_request", code: "auth", retryable: false });
  });

  it("403 は permission", () => {
    const e = apiError(403, "forbidden", "permission_error");
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "invalid_request", code: "permission", retryable: false });
  });

  it("400 + credit balance は残高不足（社長に連絡）", () => {
    const e = apiError(400, "Your credit balance is too low to access the Anthropic API.", "invalid_request_error");
    expect(e).toBeInstanceOf(Anthropic.BadRequestError);
    const r = classifyDraftError(e, ctx);
    expect(r).toMatchObject({ error: "server_error", code: "credit_balance", retryable: false });
    expect(r.message).toContain("残高が不足");
    expect(r.message).toContain("社長");
  });

  it("credit balance は大文字小文字を問わず判定する", () => {
    expect(isCreditBalanceError(apiError(400, "CREDIT BALANCE is too low"))).toBe(true);
  });

  it("billing_error 型も残高不足として扱う", () => {
    const e = apiError(402, "billing problem", "billing_error");
    expect(classifyDraftError(e, ctx)).toMatchObject({ code: "credit_balance", retryable: false });
  });

  it("残高以外の 400 は bad_request", () => {
    const e = apiError(400, "messages: text content blocks must be non-empty", "invalid_request_error");
    expect(isCreditBalanceError(e)).toBe(false);
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "invalid_request", code: "bad_request", retryable: false });
  });

  it("404 は model_not_found でモデル名を案内に含める", () => {
    const e = apiError(404, "model: foo", "not_found_error");
    const r = classifyDraftError(e, ctx);
    expect(r).toMatchObject({ error: "invalid_request", code: "model_not_found", retryable: false });
    expect(r.message).toContain("claude-test-model");
  });

  it("429 は rate_limited・再試行可", () => {
    const e = apiError(429, "rate limited", "rate_limit_error");
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "rate_limited", code: "rate_limited", retryable: true });
  });

  it("529 は overloaded・再試行可", () => {
    const e = apiError(529, "Overloaded", "overloaded_error");
    expect(e).toBeInstanceOf(Anthropic.InternalServerError);
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "server_error", code: "overloaded", retryable: true });
  });

  it("500 は server_error・再試行可", () => {
    const e = apiError(500, "internal", "api_error");
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "server_error", code: "server_error", retryable: true });
  });

  it("タイムアウトは network/timeout・再試行可（接続エラーより先に判定）", () => {
    const r = classifyDraftError(new Anthropic.APIConnectionTimeoutError(), ctx);
    expect(r).toMatchObject({ error: "network", code: "timeout", retryable: true });
  });

  it("接続エラーは network/network・再試行可", () => {
    const r = classifyDraftError(new Anthropic.APIConnectionError({ message: "fetch failed" }), ctx);
    expect(r).toMatchObject({ error: "network", code: "network", retryable: true });
  });

  it("status が無い generate() の結果は接続エラー扱い", () => {
    const e = Anthropic.APIError.generate(undefined, undefined, "boom", undefined);
    expect(classifyDraftError(e, ctx)).toMatchObject({ error: "network", code: "network" });
  });

  it("想定外の例外・非 Error は unknown・再試行可", () => {
    expect(classifyDraftError(new Error("x"), ctx)).toMatchObject({ error: "unknown", code: "unknown", retryable: true });
    expect(classifyDraftError("oops", ctx)).toMatchObject({ error: "unknown", code: "unknown", retryable: true });
  });

  it("message に例外本文や API キーらしき文字列を含めない", () => {
    const e = apiError(401, "invalid key sk-ant-SECRET123", "authentication_error");
    expect(classifyDraftError(e, ctx).message).not.toContain("SECRET123");
  });
});

describe("stop_reason 等の固定エラー", () => {
  it("refusal は再試行不可", () => {
    expect(refusalError()).toMatchObject({ ok: false, error: "refusal", code: "refusal", retryable: false });
  });
  it("max_tokens は再試行可", () => {
    expect(maxTokensError()).toMatchObject({ ok: false, error: "max_tokens", code: "max_tokens", retryable: true });
  });
  it("読み取れなかった出力は unknown・再試行可", () => {
    expect(unparsedError()).toMatchObject({ ok: false, error: "unknown", code: "unknown", retryable: true });
  });
  it("入力不備は bad_request・再試行不可", () => {
    expect(badInputError("x")).toMatchObject({ ok: false, error: "invalid_request", code: "bad_request", retryable: false });
  });
});
