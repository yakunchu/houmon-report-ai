/**
 * localStorage への保存・復元（端末内のみ）。使えない環境（プライベートモード等）でも例外を出さない。
 * 患者名などの実データが入るので、保存先はこの端末のブラウザだけ。サーバーには送らない。
 */
import type { MaskToken } from "@/lib/mask/types";
import { RECIPIENT_TYPES, ReportDraftSchema, type RecipientType, type ReportDraft } from "@/lib/report/schema";
import { EMPTY_BASIC, type BasicInfo } from "./types";

const PREFIX = "houmon-report-ai:";

export function loadRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function saveRaw(key: string, value: string | null): void {
  try {
    if (value === null || value === "") window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function clearAllSaved(): void {
  try {
    for (const k of ["basic", "transcript", "session"]) window.localStorage.removeItem(PREFIX + k);
  } catch {
    // 無視
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 保存済みの基本情報。欠けた項目は空文字で補う（型が違う項目は捨てる） */
export function loadBasic(): BasicInfo {
  const data = parseJson(loadRaw("basic"));
  if (typeof data !== "object" || data === null) return EMPTY_BASIC;
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...EMPTY_BASIC };
  for (const key of Object.keys(EMPTY_BASIC)) {
    const v = src[key];
    if (typeof v === typeof (EMPTY_BASIC as Record<string, unknown>)[key]) out[key] = v;
  }
  if (!(RECIPIENT_TYPES as readonly string[]).includes(out.recipientType as string)) {
    out.recipientType = EMPTY_BASIC.recipientType;
  }
  const members = Array.isArray(src.familyMembers) ? src.familyMembers : [];
  out.familyMembers = members
    .filter((m): m is { name: string; relation: string } => typeof m?.name === "string" && typeof m?.relation === "string")
    .map((m) => ({ name: m.name, relation: m.relation }));
  return out as BasicInfo;
}

export function loadTranscript(): string {
  return loadRaw("transcript") ?? "";
}

/** 下書きのセッション。マスク済み会話と記号の対応表を一緒に持つ（復元・引用照合・名前の復元に使う） */
export type DraftSession = {
  draft: ReportDraft;
  /** AI に送ったマスク済み会話 */
  transcript: string;
  tokens: MaskToken[];
  recipientType: RecipientType;
  model: string;
  /** 下書きを作ったときの「辞書・会話・文脈・宛先」の印。今の入力と違えば下書きは古い。無い（旧形式）ときは空文字 */
  sourceKey: string;
};

export function loadSession(): DraftSession | null {
  const data = parseJson(loadRaw("session"));
  if (typeof data !== "object" || data === null) return null;
  const s = data as Record<string, unknown>;
  const draft = ReportDraftSchema.safeParse(s.draft);
  if (!draft.success) return null;
  if (typeof s.transcript !== "string" || !Array.isArray(s.tokens)) return null;
  if (!(RECIPIENT_TYPES as readonly string[]).includes(s.recipientType as string)) return null;
  return {
    draft: draft.data,
    transcript: s.transcript,
    tokens: s.tokens as MaskToken[],
    recipientType: s.recipientType as RecipientType,
    model: typeof s.model === "string" ? s.model : "",
    sourceKey: typeof s.sourceKey === "string" ? s.sourceKey : "",
  };
}
