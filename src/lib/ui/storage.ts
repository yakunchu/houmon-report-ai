/**
 * localStorage への保存・復元（端末内のみ）。使えない環境（プライベートモード等）でも例外を出さない。
 * 患者名などの実データが入るので、保存先はこの端末のブラウザだけ。サーバーには送らない。
 */
import type { MaskToken } from "@/lib/mask/types";
import { PATIENT_STORE_KEY, type Patient } from "@/lib/patients/types";
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

/** 作業中の入力（基本情報の作業コピー・会話・下書き）を消す。患者リストと薬局名は消さない */
export function clearAllSaved(): void {
  try {
    for (const k of ["basic", "transcript", "session", "workbase"]) window.localStorage.removeItem(PREFIX + k);
  } catch {
    // 無視
  }
}

/** 患者リストと薬局名（端末の設定）も含めて、この端末の保存をすべて消す */
export function clearEverything(): void {
  clearAllSaved();
  try {
    window.localStorage.removeItem(PATIENT_STORE_KEY);
    window.localStorage.removeItem(PREFIX + "pharmacy");
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

/** 薬局名・薬剤師名。患者ではなく端末の設定なので、患者を切り替えても保たれる。保存が無ければ null */
export function loadPharmacy(): string | null {
  return loadRaw("pharmacy");
}

/**
 * 作業中の患者の元データ（id・グループ・メモ・作成日時を保つための土台）。
 * 患者リストに未登録の「新しい患者」でも、再読み込みで同じ id に戻れるよう端末に残す。
 * 値は保存済みの患者リストの作法に合わせて検査する（壊れていれば null）。
 */
export function loadWorkBase(validGroupIds: ReadonlySet<string>): Patient | null {
  const data = parseJson(loadRaw("workbase"));
  if (typeof data !== "object" || data === null) return null;
  const s = data as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id === "") return null;
  const now = new Date().toISOString();
  const groupIds = Array.isArray(s.groupIds)
    ? s.groupIds.filter((g): g is string => typeof g === "string" && validGroupIds.has(g))
    : [];
  // 氏名などの中身は作業コピー（basic）が持つので、ここでは土台の項目だけを使う
  return {
    ...EMPTY_PATIENT_BODY,
    id: s.id,
    groupIds,
    memo: typeof s.memo === "string" ? s.memo : "",
    createdAt: typeof s.createdAt === "string" ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : now,
  };
}

/** 土台の患者に入れておく空の中身（loadWorkBase 用） */
const EMPTY_PATIENT_BODY: Omit<Patient, "id" | "groupIds" | "memo" | "createdAt" | "updatedAt"> = {
  familyName: "",
  givenName: "",
  familyNameKana: "",
  givenNameKana: "",
  birthDate: "",
  sex: "",
  address: "",
  phone: "",
  familyNote: "",
  familyMembers: [],
  otherMaskWords: [],
  recipients: { careManager: "", doctor: "" },
  visitFrequency: { choice: "", note: "" },
  dispensingForm: "",
  medicationManager: "",
  managementMethod: "",
  prescription: { header: "", items: "", concomitant: "" },
  fixedFields: { counselingTarget: "", genericPreference: "", medicineNotebook: "" },
};

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
