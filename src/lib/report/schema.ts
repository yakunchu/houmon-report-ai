/**
 * 報告書の下書き（AI が埋める部分）のスキーマ。
 *
 * - Claude API の Structured Outputs（output_config.format）と、画面・評価スクリプトの型の両方に使う。
 * - 全プロパティを required にし、null や union 型を使わない（Structured Outputs の
 *   複雑度上限: 任意パラメータ 24、union 16 を使い切らないため）。
 * - 選択式の欄は選択肢に「要確認」を含める。会話に根拠が無い欄は「要確認」にする（推測で埋めない）。
 * - キーは ASCII（JSON Schema のコンパイル互換のため）。日本語の欄名は fields.ts に持つ。
 * - スキーマの enum や説明文に個人情報を入れない（公式の注意事項）。
 */
import { z } from "zod";

/** 会話に根拠が無いときの値 */
export const UNSURE = "要確認" as const;

export const MEDICATION_MANAGER = ["本人", "家族", "施設", "ヘルパー"] as const;
export const MANAGEMENT_METHOD = ["カレンダー", "配薬BOX"] as const;
export const ADHERENCE = ["良", "悪"] as const;
export const AMOUNT3 = ["普通", "小", "多"] as const;
export const ABILITY4 = ["問題なくできる", "大体できる", "あまりできない", "全くできない"] as const;
export const BOWEL = ["快便", "便秘", "下痢"] as const;
export const DAYTIME_SLEEP = ["無", "有"] as const;
export const NIGHT_SLEEP = ["良", "不眠傾向あり"] as const;
export const TENDENCY = ["特になし", "有"] as const;

/** 宛先の種別。宛名そのもの（事業所名・氏名）は端末内の基本情報で持ち、API には送らない */
export const RECIPIENT_TYPES = ["医療機関", "ケアマネ", "その他"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

/** 基本情報の選択肢（患者リストの記録と、会話からの提案の両方で使う） */
export const VISIT_FREQUENCY = ["1週間毎", "2週間毎", "1か月毎", "その他"] as const;
export const DISPENSING_FORM = ["一包化（別包有）", "一包化（別包無）", "ヒート"] as const;

const NOTE_DESC = "備考。選択肢で表しきれない補足を短く（例: 週3回程度、夜間2回）。会話に根拠が無ければ空文字";

function choiceField<const T extends readonly [string, ...string[]]>(options: T, label: string) {
  return z.object({
    choice: z
      .enum([...options, UNSURE] as const)
      .describe(`${label}。選択肢から1つ。会話に根拠が無ければ「${UNSURE}」`),
    note: z.string().describe(NOTE_DESC),
  });
}

export const LeftoverMedicationSchema = z.object({
  drugName: z.string().describe("薬剤名または区分（例: 朝食後の一包化分、センノシド錠）。処方内容の表記に合わせる"),
  amount: z.string().describe(`残数（例: 4日分、3錠）。会話に数が出てこなければ「${UNSURE}」`),
  note: z.string().describe("補足（例: 未使用分）。なければ空文字"),
});

export const SoapSchema = z.object({
  s: z.string().describe("S: 本人（または家族）の言葉を「」でそのまま引用。方言もそのまま。要約しない。複数可"),
  o: z.string().describe("O: 薬剤師が観察・確認した客観的事実（残薬数、服薬できていない薬、外用薬の使用状況など）"),
  a: z.string().describe("A: 問題の背景の評価。「〜と考えられる」と書き、診断や処方変更の決定はしない"),
  p: z.string().describe("P: 今回行った対応と、次回・関係者への提案"),
});

export const EvidenceSchema = z.object({
  medication: z.string().describe("服薬管理者・管理方法・服薬状況・残薬の根拠になった発話の引用。複数は「／」区切り。無ければ空文字"),
  meals: z.string().describe("食事（量・回数・嚥下）の根拠の引用"),
  excretion: z.string().describe("排泄（尿頻度・便通）の根拠の引用"),
  sleep: z.string().describe("睡眠（日中・夜間）の根拠の引用"),
  mobility: z.string().describe("運動・移動の根拠の引用"),
  tendency: z.string().describe("日常でみられる傾向の根拠の引用"),
});

/**
 * 会話から読み取れた基本情報の提案。新しい患者の登録時に、空欄を埋める候補として使う（薬剤師が確認して保存）。
 * 会話にはっきり出ている場合だけ埋め、無ければ「要確認」／空文字。報告書の合格ラインには含めない。
 */
export const BasicInfoSuggestionsSchema = z.object({
  visitFrequency: choiceField(VISIT_FREQUENCY, "訪問頻度（会話に出ていれば。「その他」のときは備考に間隔、例: 28日毎）"),
  dispensingForm: choiceField(DISPENSING_FORM, "調剤形態（会話に出ていれば）"),
  family: z.string().describe("家族構成・関与。続柄だけで書く（例: 長女が週末に服薬を確認）。会話に無ければ空文字"),
});
export type BasicInfoSuggestions = z.infer<typeof BasicInfoSuggestionsSchema>;

/** AI が返す下書き全体。プロパティの順は報告書ソフトの欄の並び（見本の順）に合わせている */
export const ReportDraftSchema = z.object({
  medicationManager: choiceField(MEDICATION_MANAGER, "服薬管理者"),
  managementMethod: choiceField(MANAGEMENT_METHOD, "管理方法"),
  adherence: choiceField(ADHERENCE, "服薬状況"),
  leftoverMedications: z
    .array(LeftoverMedicationSchema)
    .describe("残薬。薬剤（または区分）ごとに1件。会話に残薬の話が無ければ空配列"),
  mealAmount: choiceField(AMOUNT3, "食事・量"),
  mealsPerDay: z.object({
    value: z.string().describe(`食事・回数。1日の回数の数字だけ（例: 3）。会話に無ければ「${UNSURE}」`),
    note: z.string().describe(NOTE_DESC),
  }),
  swallowing: choiceField(ABILITY4, "食事・嚥下"),
  urinationFrequency: choiceField(AMOUNT3, "排泄・尿頻度"),
  bowelMovement: choiceField(BOWEL, "排泄・便通"),
  daytimeSleep: z.object({
    choice: z
      .enum([...DAYTIME_SLEEP, UNSURE] as const)
      .describe(`睡眠・日中（昼寝）。選択肢から1つ。会話に根拠が無ければ「${UNSURE}」`),
    duration: z.string().describe("「有」のとき昼寝の長さを「○時間○分」の形で（例: 1時間0分）。それ以外は空文字"),
    note: z.string().describe(NOTE_DESC),
  }),
  nightSleep: choiceField(NIGHT_SLEEP, "睡眠・夜間"),
  exercise: choiceField(ABILITY4, "運動"),
  mobility: choiceField(ABILITY4, "移動"),
  dailyTendency: choiceField(TENDENCY, "日常でみられる傾向"),
  soap: SoapSchema,
  contactNotes: z
    .array(z.string())
    .describe(
      "連絡事項。宛先に向けた要点を1〜3件、各1文（40字前後）。Pの内容から抜き出し、会話に無い事実や依頼は書かない。書くことが無ければ「特記事項なし」の1件",
    ),
  evidence: EvidenceSchema,
  basicInfoSuggestions: BasicInfoSuggestionsSchema,
});

export type ReportDraft = z.infer<typeof ReportDraftSchema>;
export type LeftoverMedication = z.infer<typeof LeftoverMedicationSchema>;
export type Soap = z.infer<typeof SoapSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * 画面 → /api/draft に送る内容。個人を特定できる情報は含めない。
 * transcript はマスク済み（氏名などは【患者A】のような記号に置き換え済み）であること。
 */
export const DraftContextSchema = z.object({
  visitFrequency: z.string().describe("訪問頻度（例: 1週間毎、その他（28日毎））"),
  dispensingForm: z.string().describe("調剤形態（例: 一包化（別包有））"),
  currentMedicationManager: z.string().describe("記録上の服薬管理者（空文字可）"),
  currentManagementMethod: z.string().describe("記録上の管理方法（空文字可）"),
  family: z.string().describe("家族構成・関与の既知情報。続柄のみ（例: 長女（週末に来る））。氏名は含めない"),
  prescription: z.string().describe("処方内容。薬剤名・用量・用法・日数の一覧（処方医名・医療機関名は含めない）"),
});
export type DraftContext = z.infer<typeof DraftContextSchema>;

export const DraftRequestSchema = z.object({
  recipientType: z.enum(RECIPIENT_TYPES),
  transcript: z.string().min(1).max(30000),
  context: DraftContextSchema,
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** /api/draft の応答 */
export type DraftResponse =
  | {
      ok: true;
      draft: ReportDraft;
      model: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
      };
      elapsedMs: number;
    }
  | {
      ok: false;
      /** refusal: 安全上の理由で下書き不可 / max_tokens: 出力が途中で切れた / invalid_request / rate_limited / server_error / network */
      error: "refusal" | "max_tokens" | "invalid_request" | "rate_limited" | "server_error" | "network" | "unknown";
      /** 画面に出す日本語の説明 */
      message: string;
      /**
       * 原因の細分類（画面の案内の出し分けと、社長に伝えるときの手がかり）。
       * auth: API キーが無効・未設定 / credit_balance: 残高不足 / model_not_found: モデル名の誤り /
       * permission: キーの権限 / rate_limited: 短時間の呼びすぎ / overloaded: API の混雑 / timeout: 時間切れ /
       * network: 接続できない / refusal / max_tokens / bad_request / server_error / unknown
       */
      code?: string;
      /** そのまま再試行して直る見込みがあるか（混雑・一時的な障害・通信など） */
      retryable?: boolean;
    };

/** /api/health の応答。キーの値は含めない（設定の有無だけ） */
export type HealthResponse = {
  ok: boolean;
  /** ANTHROPIC_API_KEY がサーバーに設定されている */
  hasApiKey: boolean;
  model: string;
  effort: string;
};
