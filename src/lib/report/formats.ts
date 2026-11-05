/**
 * 確定した下書きを、送り方ごとの形にする純粋関数（報告書ソフト用の formatReport は format.ts）。
 * - buildEmail: メール（件名 + 本文）。件名に患者名は入れない
 * - buildChat: チャット用の短文（改行を除いて 200 字以内）
 * - buildPrintModel: 印刷・FAX 用の A4 1 枚の構造（描画は components/PrintReport.tsx）
 *
 * 入力の文章には【患者A】などの記号が入っていてよい。名前への復元は呼び出し側が unmaskText で行う
 * （PrintModel は mapPrintModelText で全文字列を変換できる）。
 * ただし「患者名を入れない」指定のときは、記号を復元されないよう患者・家族・その他の語を指す記号をここで一般名（続柄・「（省略）」）に置き換える。
 */
import { CHOICE_FIELDS, FIXED_FIELD_LABELS, REPORT_ORDER, type ChoiceFieldKey } from "./fields";
import { calcAge, formatJapaneseDate, type FixedFields, type ReportHeader } from "./format";
import { UNSURE, type RecipientType, type ReportDraft } from "./schema";

export type FormatArgs = {
  draft: ReportDraft;
  /** 宛名（header.addressee）と薬局名・担当（header.pharmacy）もここから取る */
  header: ReportHeader;
  fixedFields: FixedFields;
  recipientType: RecipientType;
  /** 薬局の連絡先（電話・FAX など。空のこともある） */
  pharmacyContact: string;
  /** メール・チャットの本文に患者名を入れるか（印刷・FAX は常に名前が入る） */
  includePatientName: boolean;
  /**
   * 家族の続柄（マスク辞書の family と同じ並び。【家族1】が先頭）。患者名を入れないとき、【家族N】を続柄に置き換えるのに使う。
   * 渡さなければ、家族はすべて「ご家族」になる。
   */
  familyRelations?: readonly string[];
  /**
   * 連絡事項（宛先に合わせた 1〜3 行。下書きの contactNotes＝AI が P から抜き出し、薬剤師が直したもの）。
   * 渡されて空でなければ、印刷の連絡事項・メールの要旨・チャットの要点とお願いにこれを優先して使う
   * （1 件目＝要点・お願い、2 件目以降＝事実）。渡されない・空なら、P の最後の文などから組む。
   */
  contactNotes?: readonly string[];
};

export type EmailParts = { subject: string; body: string };

export const CHAT_MAX_CHARS = 200;

/** メール本文の字数の目安（改行を除く） */
export const EMAIL_BODY_TARGET = 300;

const DASH = "—";

/** どの送り方を選んでいても画面に出す注意書き（OutputSection）。印刷の送信票にも入れる */
export const URGENT_NOTICE = "急ぎ・急変は電話で。";

/** 連絡事項の最大行数 */
export const CONTACT_NOTES_MAX = 3;

/** 渡された連絡事項から、前後の空白と空行を除き、最大 3 件にする。無ければ空配列 */
export function normalizeContactNotes(notes: readonly string[] | undefined): string[] {
  return (notes ?? [])
    .map((n) => n.trim())
    .filter((n) => n !== "")
    .slice(0, CONTACT_NOTES_MAX);
}

/** 連絡事項の 1 文が、相手への依頼（お願い）として読めるか。事実の文と区別して、チャットの【お願い】の見出しを付けるかを決める */
export function isRequestNote(note: string): boolean {
  return /(?:いただきたい|ください|くださいませ|お願い(?:したい|します|いたします|申し上げます)?|ほしい|欲しい|願いたい)。?$/.test(note.trim());
}

// ---------- 小さな部品 ----------

function monthDay(iso: string): { m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return r ? { m: Number(r[2]), d: Number(r[3]) } : null;
}

/** "2026-11-05" → "11月5日"。形式が違えば空文字 */
function jpMonthDay(iso: string): string {
  const md = monthDay(iso);
  return md ? `${md.m}月${md.d}日` : "";
}

/** "2026-11-05" → "11/5"。形式が違えば空文字 */
function slashMonthDay(iso: string): string {
  const md = monthDay(iso);
  return md ? `${md.m}/${md.d}` : "";
}

/** 「ジロー薬局　薬剤師 前田 二郎」→「ジロー薬局」（最初の空白まで） */
export function pharmacyNameOf(pharmacy: string): string {
  return pharmacy.trim().split(/[\s　]+/)[0] ?? "";
}

function withNote(main: string, note: string): string {
  const n = note.trim();
  return n === "" ? main : `${main}（${n}）`;
}

function orDash(s: string): string {
  return s.trim() === "" ? DASH : s;
}

/** 続柄が分からない家族を指すときの言い方 */
export const FAMILY_FALLBACK = "ご家族";

/**
 * 患者・家族などを指す記号を一般名に置き換える（名前を入れない指定のとき、復元で名前が出ないようにする）。
 * - 【患者A】→「患者様」、【住所】【生年月日】【電話】【郵便番号】【その他N】→「（省略）」
 * - 【家族N】→ 続柄（familyRelations[N-1]。無ければ「ご家族」）。家族の実名は患者と同じ姓のことが多く、患者が特定できてしまうため。
 *   familyRelations は maskText に渡した辞書の family と同じ並び（【家族1】が先頭）。
 */
export function anonymizePatientTokens(text: string, familyRelations: readonly string[] = []): string {
  return text
    .replace(/【患者[A-Z]】/g, "患者様")
    .replace(/【家族(\d+)】/g, (_m, n: string) => familyRelations[Number(n) - 1]?.trim() || FAMILY_FALLBACK)
    .replace(/【(?:住所|生年月日|電話|郵便番号|その他\d+)】/g, "（省略）");
}

/** 「選択（備考）」の文字列。昼寝は「有」のときだけ長さを付ける */
function choiceText(draft: ReportDraft, key: ChoiceFieldKey, withNotes = true): string {
  if (key === "daytimeSleep") {
    const d = draft.daytimeSleep;
    const main = d.choice === "有" && d.duration.trim() !== "" ? `${d.choice} ${d.duration.trim()}` : d.choice;
    return withNotes ? withNote(main, d.note) : main;
  }
  const v = draft[key];
  return withNotes ? withNote(v.choice, v.note) : v.choice;
}

function choiceNote(draft: ReportDraft, key: ChoiceFieldKey): string {
  return (key === "daytimeSleep" ? draft.daytimeSleep.note : draft[key].note).trim();
}

function leftoverText(draft: ReportDraft, withNotes = true): string {
  const rows = draft.leftoverMedications.map((r) => {
    const main = `${r.drugName} ${r.amount}`.trim();
    return withNotes ? withNote(main, r.note) : main;
  });
  return orDash(rows.join("、"));
}

/** 「。」で文を区切る（「」の中の「。」では切らない）。各文は末尾の「。」を含む */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of text.replace(/\s*\n\s*/g, "")) {
    buf += ch;
    if (ch === "「") depth += 1;
    else if (ch === "」") depth = Math.max(0, depth - 1);
    else if (ch === "。" && depth === 0) {
      if (buf.trim() !== "") out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim() !== "") out.push(buf.trim());
  return out;
}

/** P の最初の文。空なら「—」 */
export function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? DASH;
}

/** P の最後の文。文が 1 つなら最初の文と同じ。空なら「—」 */
export function lastSentence(text: string): string {
  const s = splitSentences(text);
  return s[s.length - 1] ?? DASH;
}

/** 最大 max 文字に切り詰める。超えたときは末尾を「…」にする */
export function truncateText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 0) return "";
  return chars.slice(0, max - 1).join("") + "…";
}

function fallbackAddressee(recipientType: RecipientType): string {
  if (recipientType === "医療機関") return "ご担当の先生";
  if (recipientType === "ケアマネ") return "ご担当のケアマネジャー様";
  return "ご担当者様";
}

function patientNameLine(header: ReportHeader): string {
  const p = header.patient;
  const birth = p.birthDate !== "" ? formatJapaneseDate(p.birthDate) : "";
  return birth !== "" ? `${p.name}（${birth}）` : p.name;
}

/** 体調・生活で変化があるもの（便通・睡眠・食事のうち「要確認」でなく備考があるもの。最大 2 件） */
function lifeChanges(draft: ReportDraft): string[] {
  const keys: { key: ChoiceFieldKey; label: string }[] = [
    { key: "bowelMovement", label: "便通" },
    { key: "nightSleep", label: "夜間の睡眠" },
    { key: "daytimeSleep", label: "日中の睡眠" },
    { key: "mealAmount", label: "食事の量" },
    { key: "swallowing", label: "食事の嚥下" },
  ];
  const out: string[] = [];
  for (const k of keys) {
    const choice = k.key === "daytimeSleep" ? draft.daytimeSleep.choice : draft[k.key].choice;
    if (choice.trim() === UNSURE || choiceNote(draft, k.key) === "") continue;
    out.push(`${k.label} ${choiceText(draft, k.key)}`);
    if (out.length === 2) break;
  }
  return out;
}

// ---------- 宛先別の部品 ----------

/** 「ジロー薬局　薬剤師 前田 二郎」→「前田」（薬局名のあとの語のうち、職名でない最初のもの）。無ければ空文字 */
export function staffNameOf(pharmacy: string): string {
  const tokens = pharmacy.trim().split(/[\s　]+/).slice(1);
  return tokens.find((t) => !/[師士]$/.test(t)) ?? "";
}

/** P の中で「医師に提案」を含む文（skip と同じ文は除く）。無ければ空文字 */
function proposedToDoctor(p: string, skip: string): string {
  return splitSentences(p).find((s) => s.includes("医師に提案") && s !== skip) ?? "";
}

function adherenceFact(draft: ReportDraft, withNote: boolean, leftoverNotes: boolean): string {
  return `服薬状況：${choiceText(draft, "adherence", withNote)}／残薬：${leftoverText(draft, leftoverNotes)}`;
}

/** 改行を除いた字数 */
const countChars = (s: string): number => Array.from(s.replace(/\n/g, "")).length;

// ---------- メール ----------

/**
 * メールの要旨に使う文を、報告書の「である調」から丁寧な形にする（語尾だけ。意味は変えない）。
 * 例: 「〜をご検討いただきたい。」→「〜をご検討いただけますと幸いです。」、「〜を医師に提案する。」→「〜を医師に提案します。」
 */
export function politeForEmail(sentence: string): string {
  const s = sentence.trim();
  if (s === "") return s;
  if (/いただきたい。$/.test(s)) return s.replace(/いただきたい。$/, "いただけますと幸いです。");
  if (/する。$/.test(s)) return s.replace(/する。$/, "します。");
  if (/した。$/.test(s)) return s.replace(/した。$/, "しました。");
  return s;
}

/**
 * 要旨 2〜3 行。連絡事項（contactNotes）があれば、それを丁寧な形にして使う（1 件目＝要点・お願い、2 件目以降＝事実。noteCount 件まで）。
 * 無ければ 医師宛て＝処方提案＋事実、ケアマネ宛て＝お願い＋事実＋医師への提案、その他＝お願い＋事実
 */
function emailSummary(
  args: FormatArgs,
  adherenceNote: boolean,
  leftoverNotes: boolean,
  noteCount: number = CONTACT_NOTES_MAX,
): string[] {
  const { draft, recipientType } = args;
  const notes = normalizeContactNotes(args.contactNotes);
  if (notes.length > 0) return notes.slice(0, Math.max(1, noteCount)).map(politeForEmail);
  const req = lastSentence(draft.soap.p);
  const lines = [politeForEmail(req), adherenceFact(draft, adherenceNote, leftoverNotes)];
  if (recipientType === "ケアマネ") {
    const prop = proposedToDoctor(draft.soap.p, req);
    if (prop !== "") lines.push(politeForEmail(prop));
  }
  return lines;
}

export function buildEmail(args: FormatArgs): EmailParts {
  const { header, recipientType, pharmacyContact, includePatientName, familyRelations } = args;
  const tidy = includePatientName ? (s: string) => s : (s: string) => anonymizePatientTokens(s, familyRelations);
  const pharmacyName = pharmacyNameOf(header.pharmacy);
  const staff = staffNameOf(header.pharmacy);
  const md = jpMonthDay(header.reportDate);

  const subject = `【居宅療養管理指導報告】${md !== "" ? `${md} ` : ""}訪問分${pharmacyName !== "" ? `（${pharmacyName}）` : ""}`;

  const showName = includePatientName && header.patient.name.trim() !== "";
  const who = pharmacyName === "" ? "" : staff !== "" ? `${pharmacyName}の${staff}です。` : `${pharmacyName}です。`;

  const make = (adherenceNote: boolean, leftoverNotes: boolean, noteCount: number): string => {
    const lines: string[] = [];
    lines.push(header.addressee !== "" ? header.addressee : fallbackAddressee(recipientType), "");
    lines.push(`いつもお世話になっております。${who}`);
    lines.push(`${md !== "" ? `${md}に` : ""}訪問した患者様の報告書を、別送（FAX／PDF）にてお送りします。`);
    if (showName) lines.push(`患者：${patientNameLine(header)}`);
    lines.push("");
    lines.push(...emailSummary(args, adherenceNote, leftoverNotes, noteCount).map(tidy));
    lines.push("");
    if (!showName) lines.push("患者様のお名前は別送の報告書に記載しています。");
    lines.push("よろしくお願いいたします。", "");
    lines.push("――――――――――");
    if (header.pharmacy !== "") lines.push(header.pharmacy);
    if (pharmacyContact.trim() !== "") lines.push(pharmacyContact.trim());
    return lines.join("\n") + "\n";
  };

  // 300 字以内を目安に、超えたら事実の行から備考を落とす（連絡事項が渡されているときは、後ろの行から減らす）
  const levels: [boolean, boolean, number][] =
    normalizeContactNotes(args.contactNotes).length > 0
      ? [
          [true, true, 3],
          [true, true, 2],
          [true, true, 1],
        ]
      : [
          [true, true, CONTACT_NOTES_MAX],
          [false, true, CONTACT_NOTES_MAX],
          [false, false, CONTACT_NOTES_MAX],
        ];
  let body = "";
  for (const [an, ln, nc] of levels) {
    body = make(an, ln, nc);
    if (countChars(body) <= EMAIL_BODY_TARGET) break;
  }
  return { subject, body };
}

// ---------- チャット ----------

/** 全体が max 文字（改行を除く）に収まるまで、縮めてよい行（idx）のうち最長のものから切り詰める */
function shrinkLines(lines: string[], shrinkable: number[], max: number): string[] {
  const out = [...lines];
  const len = (i: number): number => Array.from(out[i]).length;
  for (let guard = 0; guard < 500 && countChars(out.join("\n")) > max; guard += 1) {
    const excess = countChars(out.join("\n")) - max;
    let target = -1;
    for (const i of shrinkable) {
      if (len(i) > 8 && (target < 0 || len(i) > len(target))) target = i;
    }
    if (target < 0) break;
    out[target] = truncateText(out[target], Math.max(8, len(target) - excess));
  }
  return out;
}

/**
 * チャット用の短文（改行を除いて max 字以内）。
 * 並び: 要点 → 事実 1〜2 行 → （医師以外）【お願い】→ 署名。
 * 長いときは 体調の行 → 残薬の備考 → 要点の対応 の順に省き、それでも長ければ行を切り詰める。
 */
export function buildChat(args: FormatArgs, max: number = CHAT_MAX_CHARS): string {
  const { draft, header, recipientType, includePatientName, familyRelations } = args;
  const tidy = includePatientName ? (s: string) => s : (s: string) => anonymizePatientTokens(s, familyRelations);
  const pharmacyName = pharmacyNameOf(header.pharmacy);
  const staff = staffNameOf(header.pharmacy);
  const md = slashMonthDay(header.reportDate);
  const showName = includePatientName && header.patient.name.trim() !== "";
  const doctor = recipientType === "医療機関";
  const req = tidy(lastSentence(draft.soap.p));
  const life = lifeChanges(draft)[0];
  const sign = [pharmacyName, staff].filter((s) => s !== "").join(" ");
  const namePrefix = showName ? `${header.patient.name}様：` : "";

  const make = (withLife: boolean, leftoverNote: boolean, withAction: boolean): { lines: string[]; shrinkable: number[] } => {
    const adherenceNote = choiceNote(draft, "adherence");
    const adh = adherenceNote !== "" ? `${adherenceNote}。` : `服薬状況：${draft.adherence.choice}。`;
    const l1 = doctor
      ? `${namePrefix}${req}`
      : `${namePrefix}${tidy(adh)}${withAction ? tidy(firstSentence(draft.soap.p)) : ""}${md !== "" ? `（${md} 訪問）` : ""}`;
    const lines: string[] = [l1, `・残薬：${tidy(leftoverText(draft, leftoverNote))}`];
    if (withLife && life !== undefined) lines.push(`・${tidy(life)}`);
    const shrinkable = [0];
    if (!doctor) {
      shrinkable.push(lines.length);
      lines.push(`【お願い】${req}`);
    }
    if (sign !== "") lines.push(sign);
    return { lines, shrinkable };
  };

  // 連絡事項（contactNotes）が渡されているとき: 1 件目＝要点（医師宛て）／【お願い】（それ以外）、2 件目以降＝事実の行
  // ケアマネ・その他宛てで 1 件目が依頼文のときだけ【お願い】の行にする。事実の文なら「・」の行にする
  const notes = normalizeContactNotes(args.contactNotes).map(tidy);
  const requestFirst = doctor || isRequestNote(notes[0] ?? "");
  const factNotes = requestFirst ? notes.slice(1) : notes;
  const makeFromNotes = (factCount: number): { lines: string[]; shrinkable: number[] } => {
    const lines: string[] = [];
    const shrinkable: number[] = [];
    if (doctor) {
      shrinkable.push(lines.length);
      lines.push(`${namePrefix}${notes[0]}`);
    } else {
      lines.push(`${namePrefix}${md !== "" ? `${md} 訪問` : "訪問"}の報告です。`);
    }
    for (const fact of factNotes.slice(0, factCount)) {
      shrinkable.push(lines.length);
      lines.push(`・${fact}`);
    }
    if (!doctor && requestFirst) {
      shrinkable.push(lines.length);
      lines.push(`【お願い】${notes[0]}`);
    }
    if (sign !== "") lines.push(sign);
    return { lines, shrinkable };
  };

  let last: { lines: string[]; shrinkable: number[] };
  if (notes.length > 0) {
    // 依頼文が無い（事実だけ）ときは、事実の行を最低 1 件は残す
    const minFacts = doctor || requestFirst ? 0 : 1;
    for (let n = factNotes.length; n >= minFacts; n -= 1) {
      const text = makeFromNotes(n).lines.join("\n");
      if (countChars(text) <= max) return text;
    }
    last = makeFromNotes(minFacts);
  } else {
    const levels: [boolean, boolean, boolean][] = [
      [true, true, true],
      [false, true, true],
      [false, false, true],
      [false, false, false],
    ];
    for (const [a, b, c] of levels) {
      const text = make(a, b, c).lines.join("\n");
      if (countChars(text) <= max) return text;
    }
    last = make(false, false, false);
  }
  const text = shrinkLines(last.lines, last.shrinkable, max).join("\n");
  if (countChars(text) <= max) return text;
  // 最後の手段: 文字数で切る
  let kept = 0;
  let cut = "";
  for (const ch of Array.from(text)) {
    if (ch !== "\n") {
      if (kept >= max) break;
      kept += 1;
    }
    cut += ch;
  }
  return cut;
}

// ---------- 印刷・FAX ----------
// A4 で 1 枚目に処方内容以外、2 枚目（別紙）に処方内容。並びはこの型のキーの順＝紙の上から下の順。

export type PrintPair = { label: string; value: string };

/** 項目｜内容 の 1 行。備考は内容の後ろに「（備考）」として続ける */
export type PrintRow = { item: string; content: string };

export type PrintTable = { title: string; rows: PrintRow[] };

export type PrintModel = {
  // 1. 宛名・報告日
  addressee: string;
  reportDate: string;
  // 2. 表題・発信元（送信票の要素は表題の下に小さく 1〜2 行）
  title: string;
  sender: PrintPair[];
  /** 送信日・枚数・急ぎは電話で（1 行目）／誤送信時の注意文（2 行目） */
  sendNote: string[];
  // 3. 患者・訪問日・次回訪問
  patientTitle: string;
  patient: PrintPair[];
  // 4. 連絡事項（宛先で変わる 1〜3 行の箇条書き。枠で囲む）
  contactTitle: string;
  contact: string[];
  // 5. 服薬管理・生活状況（項目｜内容 の 2 列表。印刷では左右に並べる）
  tableHead: readonly ["項目", "内容"];
  medication: PrintTable;
  life: PrintTable;
  // 6. SOAP
  soapTitle: string;
  soap: PrintPair[];
  // 7. 定型欄
  fixedTitle: string;
  fixed: PrintPair[];
  // 8. 別紙：処方内容（印刷では改ページして 2 枚目）
  appendixTitle: string;
  /** 処方日・処方医の見出し（空なら空文字） */
  prescriptionHeader: string;
  /** 1 行 1 剤 */
  prescriptionItems: string[];
  concomitant: string;
};

export const PRINT_NOTICE =
  "本書には個人情報が含まれます。誤って届いた場合は上記までご連絡のうえ破棄をお願いします。";

/** 枚数の書き方（本紙 1 枚＋別紙 1 枚） */
export const PRINT_PAGES_TEXT = "2 枚（本紙 1 枚＋別紙 1 枚）";

/** 服薬管理の表に入れる欄（調剤形態は基本情報から別に足す） */
const MEDICATION_KEYS: readonly string[] = ["medicationManager", "managementMethod", "adherence", "leftoverMedications"];

/** 「内容（備考）」。内容が空なら「—」。備考が空なら内容だけ */
function contentWithNote(main: string, note: string): string {
  const n = note.trim();
  return n === "" || n === DASH ? orDash(main) : `${orDash(main)}（${n}）`;
}

function printRows(draft: ReportDraft): { medication: PrintRow[]; life: PrintRow[] } {
  const medication: PrintRow[] = [];
  const life: PrintRow[] = [];
  for (const item of REPORT_ORDER) {
    if (item.key === "soap") continue;
    const target = MEDICATION_KEYS.includes(item.key) ? medication : life;
    if (item.key === "leftoverMedications") {
      const notes = draft.leftoverMedications
        .filter((r) => r.note.trim() !== "")
        .map((r) => `${r.drugName}：${r.note.trim()}`);
      target.push({ item: item.label, content: contentWithNote(leftoverText(draft, false), notes.join("、")) });
    } else if (item.key === "mealsPerDay") {
      const m = draft.mealsPerDay;
      const v = m.value.trim();
      const result = v === UNSURE ? UNSURE : v === "" ? DASH : `${v} 回/日`;
      target.push({ item: item.label, content: contentWithNote(result, m.note) });
    } else {
      const def = CHOICE_FIELDS.find((f) => f.key === item.key);
      if (!def) continue;
      target.push({
        item: item.label,
        content: contentWithNote(choiceText(draft, def.key, false), choiceNote(draft, def.key)),
      });
    }
  }
  return { medication, life };
}

/**
 * 連絡事項（1〜3 行）。contactNotes が渡されて空でなければそれを使う。
 * 無ければ 医師宛て＝処方提案＋残薬、ケアマネ宛て＝お願い＋医師への提案＋服薬状況、その他＝お願い＋事実
 */
function contactItems(args: FormatArgs): string[] {
  const { draft, recipientType } = args;
  const given = normalizeContactNotes(args.contactNotes);
  if (given.length > 0) return given;
  const req = lastSentence(draft.soap.p);
  const items: string[] = [];
  if (req !== DASH) items.push(req);
  if (recipientType === "医療機関") {
    if (draft.leftoverMedications.length > 0) items.push(`残薬：${leftoverText(draft)}`);
  } else if (recipientType === "ケアマネ") {
    const prop = proposedToDoctor(draft.soap.p, req);
    if (prop !== "") items.push(prop);
    items.push(`服薬状況：${choiceText(draft, "adherence")}`);
  } else {
    items.push(adherenceFact(draft, true, true));
  }
  return items.slice(0, CONTACT_NOTES_MAX);
}

/** 「ジロー薬局　薬剤師 前田 二郎」→「薬剤師 前田 二郎」（薬局名のあと）。無ければ空文字 */
function staffPartOf(pharmacy: string): string {
  return pharmacy
    .trim()
    .split(/[\s　]+/)
    .slice(1)
    .join(" ");
}

export function buildPrintModel(args: FormatArgs): PrintModel {
  const { draft, header: h, fixedFields, recipientType, pharmacyContact } = args;
  const p = h.patient;
  const age = calcAge(p.birthDate, h.reportDate);
  const rows = printRows(draft);
  const date = orDash(formatJapaneseDate(h.reportDate));

  return {
    addressee: h.addressee !== "" ? h.addressee : fallbackAddressee(recipientType),
    reportDate: date,
    title: "居宅療養管理指導報告書",
    sender: [
      { label: "薬局", value: orDash(pharmacyNameOf(h.pharmacy)) },
      { label: "担当", value: orDash(staffPartOf(h.pharmacy)) },
      { label: "連絡先", value: orDash(pharmacyContact.trim()) },
    ],
    sendNote: [`送信日 ${date}　枚数 ${PRINT_PAGES_TEXT}　${URGENT_NOTICE}`, PRINT_NOTICE],
    patientTitle: "患者・訪問",
    patient: [
      { label: "患者", value: orDash(p.kana !== "" ? `${p.name}（${p.kana}）` : p.name) },
      { label: "生年月日", value: orDash(p.birthDate !== "" ? formatJapaneseDate(p.birthDate) : "") },
      { label: "年齢", value: age !== null ? `${age}歳` : DASH },
      { label: "性別", value: orDash(p.sex) },
      { label: "訪問日", value: orDash(formatJapaneseDate(h.reportDate)) },
      { label: "次回訪問", value: orDash(formatJapaneseDate(h.nextVisitDate)) },
      { label: "訪問頻度", value: orDash(h.visitFrequency) },
      { label: "処方医", value: orDash(h.prescriptionHeader) },
    ],
    contactTitle: "連絡事項",
    contact: contactItems(args),
    tableHead: ["項目", "内容"],
    medication: {
      title: "服薬管理",
      rows: [{ item: "調剤形態", content: orDash(h.dispensingForm) }, ...rows.medication],
    },
    life: { title: "生活状況", rows: rows.life },
    soapTitle: "指導内容",
    soap: [
      { label: "S", value: orDash(draft.soap.s.trim()) },
      { label: "O", value: orDash(draft.soap.o.trim()) },
      { label: "A", value: orDash(draft.soap.a.trim()) },
      { label: "P", value: orDash(draft.soap.p.trim()) },
    ],
    fixedTitle: "定型欄",
    fixed: [
      { label: FIXED_FIELD_LABELS.counselingTarget, value: orDash(fixedFields.counselingTarget) },
      { label: FIXED_FIELD_LABELS.genericPreference, value: orDash(fixedFields.genericPreference) },
      { label: FIXED_FIELD_LABELS.medicineNotebook, value: orDash(fixedFields.medicineNotebook) },
    ],
    appendixTitle: "別紙：処方内容",
    prescriptionHeader: h.prescriptionHeader,
    prescriptionItems:
      h.prescriptionItems === "" ? [] : h.prescriptionItems.split(/\r?\n/).filter((s) => s.trim() !== ""),
    concomitant: orDash(h.concomitant),
  };
}

/** PrintModel のすべての文字列に fn を掛ける（名前を戻す unmaskText の適用に使う） */
export function mapPrintModelText(model: PrintModel, fn: (s: string) => string): PrintModel {
  const pair = (x: PrintPair): PrintPair => ({ label: fn(x.label), value: fn(x.value) });
  const row = (r: PrintRow): PrintRow => ({ item: fn(r.item), content: fn(r.content) });
  const table = (t: PrintTable): PrintTable => ({ title: fn(t.title), rows: t.rows.map(row) });
  return {
    ...model,
    addressee: fn(model.addressee),
    reportDate: fn(model.reportDate),
    title: fn(model.title),
    sender: model.sender.map(pair),
    sendNote: model.sendNote.map(fn),
    patientTitle: fn(model.patientTitle),
    patient: model.patient.map(pair),
    contactTitle: fn(model.contactTitle),
    contact: model.contact.map(fn),
    medication: table(model.medication),
    life: table(model.life),
    soapTitle: fn(model.soapTitle),
    soap: model.soap.map(pair),
    fixedTitle: fn(model.fixedTitle),
    fixed: model.fixed.map(pair),
    appendixTitle: fn(model.appendixTitle),
    prescriptionHeader: fn(model.prescriptionHeader),
    prescriptionItems: model.prescriptionItems.map(fn),
    concomitant: fn(model.concomitant),
  };
}

/** PrintModel を 1 つの文字列にする（名前に戻せなかった記号が残っていないかの検査用） */
export function printModelToText(model: PrintModel): string {
  return JSON.stringify(model);
}
