/**
 * Claude に送るプロンプトの組み立て。
 * system は報告書ルール（正本: prompts/report-rules.md）をキャッシュ対象のブロックとして渡し、
 * user には宛先・基本情報・処方内容・マスク済みの会話を見出し付きで並べる。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { REPORT_RULES } from "../prompt/rules.generated";
import type { DraftRequest } from "./schema";

/** system ブロック。prompt caching のため文字列ではなく配列で渡す */
export function buildSystemBlocks(): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: REPORT_RULES, cache_control: { type: "ephemeral" } }];
}

/** 空文字は「（記録なし）」と明示する（空欄のままだと読み落としやすいため） */
function orNone(value: string): string {
  return value.trim() === "" ? "（記録なし）" : value.trim();
}

export function buildUserMessage(req: DraftRequest): string {
  const c = req.context;
  return [
    "## 宛先の種別",
    req.recipientType,
    "",
    "## 基本情報",
    `- 訪問頻度: ${orNone(c.visitFrequency)}`,
    `- 調剤形態: ${orNone(c.dispensingForm)}`,
    `- 記録上の服薬管理者: ${orNone(c.currentMedicationManager)}`,
    `- 記録上の管理方法: ${orNone(c.currentManagementMethod)}`,
    `- 家族: ${orNone(c.family)}`,
    "",
    "## 処方内容",
    orNone(c.prescription),
    "",
    "## 会話テキスト（訪問時の文字起こし）",
    "<transcript>",
    req.transcript.trim(),
    "</transcript>",
    "",
    "JSON スキーマどおりに報告書の下書きを返してください。",
  ].join("\n");
}
