/**
 * Anthropic クライアント生成とモデル設定（サーバー専用。ブラウザのコードから import しないこと）。
 * API キーは .env の ANTHROPIC_API_KEY。コードやログに出さない。
 */
import Anthropic from "@anthropic-ai/sdk";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export const DEFAULT_MODEL = "claude-opus-5-5";
/**
 * 既定の effort。2026-11-04 の比較（架空台本 2 本、各 1 回）で low は medium と同じ選択式 13/13・
 * 内容理解要確認の判定も同じで、所要が約 20 秒 → 約 10 秒に短くなったため low を既定にした（docs/PLAN.md §4-1）。
 */
export const DEFAULT_EFFORT: Effort = "low";

/** API キーが未設定のときのエラー（draft.ts で画面向けメッセージに変換する） */
export class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY が設定されていません。.env に ANTHROPIC_API_KEY を書いてください。");
    this.name = "MissingApiKeyError";
  }
}

/** 使うモデルと effort。環境変数 HOUMON_MODEL / HOUMON_EFFORT で切り替える（不正な effort は medium） */
export function getModelConfig(): { model: string; effort: Effort } {
  const model = process.env.HOUMON_MODEL?.trim() || DEFAULT_MODEL;
  const raw = process.env.HOUMON_EFFORT?.trim();
  const effort = (EFFORT_LEVELS as readonly string[]).includes(raw ?? "") ? (raw as Effort) : DEFAULT_EFFORT;
  return { model, effort };
}

/**
 * キーが空なら MissingApiKeyError。1 回あたり 3 分で打ち切り、リトライは 1 回まで
 * （画面側は 3 分で中止する。サーバー側が何度も再試行して裏で動き続けないようにする）
 */
export function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new MissingApiKeyError();
  return new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 });
}
