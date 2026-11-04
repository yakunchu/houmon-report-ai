/**
 * 端末診断（/diag）用の検出ロジック。iPhone の Safari で「録音」と「端末内の音声認識」が使えるかを
 * 実機で確かめるためのもの。患者データや会話は一切扱わない。
 *
 * 方針（docs/PLAN.md §4-5, §4-6）: 音声認識は端末内処理（processLocally）を指定できる場合だけ使う。
 * 指定できない端末では、生の音声が外部サーバーに送られる可能性があるため、テストも行わない。
 */

export type SpeechAvailability = "available" | "downloadable" | "downloading" | "unavailable";

export type SpeechResultLike = { isFinal: boolean; length: number; 0?: { transcript: string; confidence: number } };

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionCtor = {
  new (): SpeechRecognitionLike;
  /** 新しい仕様の静的メソッド。無いブラウザもある */
  available?: (options: { langs: string[]; processLocally?: boolean }) => Promise<SpeechAvailability>;
};

export type SpeechSupport = {
  /** window 上の名前。無ければ null */
  ctorName: "SpeechRecognition" | "webkitSpeechRecognition" | null;
  ctor: SpeechRecognitionCtor | null;
  /** SpeechRecognition.available() が実装されているか */
  hasAvailable: boolean;
  /** インスタンスに processLocally があるか（端末内処理を指定できるか） */
  hasProcessLocally: boolean;
};

type SpeechGlobals = { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };

export function detectSpeechSupport(): SpeechSupport {
  const g = window as unknown as SpeechGlobals;
  const ctorName = g.SpeechRecognition ? "SpeechRecognition" : g.webkitSpeechRecognition ? "webkitSpeechRecognition" : null;
  const ctor = ctorName ? (g[ctorName] ?? null) : null;
  let hasProcessLocally = false;
  if (ctor) {
    try {
      hasProcessLocally = "processLocally" in new ctor();
    } catch {
      hasProcessLocally = false;
    }
  }
  return { ctorName, ctor, hasAvailable: typeof ctor?.available === "function", hasProcessLocally };
}

/** available() を呼ぶ。未実装なら「未実装」、失敗なら「エラー: …」の文字で返す */
export async function querySpeechAvailability(ctor: SpeechRecognitionCtor | null, processLocally: boolean): Promise<string> {
  if (!ctor || typeof ctor.available !== "function") return "未実装";
  try {
    return await ctor.available({ langs: ["ja-JP"], processLocally });
  } catch (e) {
    return `エラー: ${errorText(e)}`;
  }
}

/** 録音形式の候補。iOS Safari は audio/mp4、Chrome は audio/webm を返すことが多い */
export const RECORDER_TYPES = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/aac",
] as const;

export function supportedRecorderTypes(): string[] {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return [];
  return RECORDER_TYPES.filter((t) => {
    try {
      return MediaRecorder.isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

export type DiagRow = { label: string; value: string; ok: boolean | null };

export type DiagSnapshot = {
  rows: DiagRow[];
  /** 端末内処理を指定した音声認識のテストをしてよいか */
  canTestSpeech: boolean;
  /** テストできない理由（できるときは空） */
  speechNote: string;
  /** 調べた日時（表示用の文字）。描画中に new Date() を呼ばないよう、ここで一度だけ作る */
  at: string;
};

/** 画面を開いた直後に集める情報。マイクの許可は求めない（ボタンを押したときだけ） */
export async function collectDiag(): Promise<DiagSnapshot> {
  const speech = detectSpeechSupport();
  const [availLocal, availAny] = await Promise.all([
    querySpeechAvailability(speech.ctor, true),
    querySpeechAvailability(speech.ctor, false),
  ]);
  const types = supportedRecorderTypes();
  const hasRecorder = typeof MediaRecorder !== "undefined";
  const hasGum = typeof navigator.mediaDevices?.getUserMedia === "function";
  const secure = window.isSecureContext;
  const availabilityOk = (v: string): boolean | null => (v === "available" ? true : speech.hasAvailable ? false : null);

  const rows: DiagRow[] = [
    { label: "開いている URL", value: `${location.protocol}//${location.host}`, ok: location.protocol === "https:" },
    { label: "安全なコンテキスト（isSecureContext）", value: secure ? "はい" : "いいえ（録音・マイクは使えません）", ok: secure },
    { label: "マイク取得（getUserMedia）", value: hasGum ? "あり" : "なし", ok: hasGum },
    {
      label: "録音（MediaRecorder）",
      value: hasRecorder ? (types.length ? `あり（${types.join(" / ")}）` : "あり（対応形式は不明）") : "なし",
      ok: hasRecorder,
    },
    { label: "音声認識（SpeechRecognition）", value: speech.ctorName ?? "なし", ok: speech.ctorName !== null },
    {
      label: "端末内処理の指定（processLocally）",
      value: speech.hasProcessLocally ? "指定できる" : "指定できない",
      ok: speech.hasProcessLocally,
    },
    { label: "available() の有無", value: speech.hasAvailable ? "あり" : "なし", ok: speech.hasAvailable },
    { label: "日本語・端末内処理（available）", value: availLocal, ok: availabilityOk(availLocal) },
    { label: "日本語・処理場所を問わない（available）", value: availAny, ok: availabilityOk(availAny) },
    { label: "ブラウザ（userAgent）", value: navigator.userAgent, ok: null },
  ];

  let speechNote = "";
  if (!speech.ctor) speechNote = "このブラウザに音声認識（SpeechRecognition）がありません。";
  else if (!speech.hasProcessLocally)
    speechNote =
      "この端末の Safari では端末内処理（processLocally）を指定できません。音声が外部に送られる可能性を避けるため、音声認識のテストは行いません。文字起こしはキーボードの音声入力を使う方針になります。";
  else if (availLocal === "unavailable") speechNote = "日本語の端末内音声認識はこの端末では使えません（available: unavailable）。";
  else if (!secure) speechNote = "https で開いていないため、マイクが使えません。";

  return { rows, canTestSpeech: speechNote === "", speechNote, at: new Date().toLocaleString("ja-JP") };
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === "object" && e !== null && "error" in e) return String((e as { error: unknown }).error);
  return String(e);
}

/**
 * コピー用の文章。○ = 使える、× = 使えない、・ = 可否ではない情報。
 * at は collectDiag() が作った日時の文字（まだ無ければ null）。描画中に new Date() を呼ぶと
 * Next.js の事前描画（Cache Components）が「不安定な値」としてエラーにするため、ここでは作らない。
 */
export function formatDiagText(rows: DiagRow[], tests: Record<string, string>, at: string | null): string {
  const lines = ["端末診断（在宅レポAI /diag）", ...(at ? [`日時: ${at}`] : []), ""];
  for (const r of rows) lines.push(`${mark(r.ok)} ${r.label}: ${r.value}`);
  const names = Object.keys(tests);
  if (names.length > 0) {
    lines.push("", "テスト:");
    for (const k of names) lines.push(`- ${k}: ${tests[k]}`);
  }
  return lines.join("\n");
}

function mark(ok: boolean | null): string {
  return ok === null ? "・" : ok ? "○" : "×";
}
