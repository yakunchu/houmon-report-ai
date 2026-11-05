/**
 * 見本（expected）と実際の下書き（actual）の比較。評価スクリプトと将来の UI で使う純関数。
 * - 選択式と食事回数は正規化して完全一致で判定（match: true/false）
 * - 備考・SOAP・昼寝の長さは文字 bigram の Jaccard 類似度（match は null＝人が判定）
 * - 残薬は件数と各件の「要確認」の一致で match、本文の類似度も出す
 * - 引用（S と evidence）は会話テキストに実在するかを別関数で確認する
 * - basicInfoSuggestions（基本情報の提案）は合格ライン（選択式一致率）に含めず、別関数 compareSuggestions で見る
 * - contactNotes（連絡事項）も合格ラインに含めない。見本が無くても動く参考表示（compareContactNotes）
 */
import { CHOICE_FIELDS, EVIDENCE_LABELS, REPORT_ORDER, SOAP_LABELS, type EvidenceKey } from "./fields";
import { UNSURE, type BasicInfoSuggestions, type Evidence, type LeftoverMedication, type ReportDraft } from "./schema";

export type CompareRow = {
  key: string;
  label: string;
  expected: string;
  actual: string;
  /** 完全一致の判定結果。人が判定する欄は null */
  match: boolean | null;
  /** 文字 bigram の Jaccard 類似度（0〜1）。完全一致だけで見る欄は null */
  similarity: number | null;
  /** choice: 完全一致で判定する選択式（一致率の分母） / text: 人が判定 / list: 残薬 */
  kind: "choice" | "text" | "list";
};

/** 基本情報の提案の比較行。合格判定には使わない */
export type SuggestionRow = {
  key: string;
  label: string;
  expected: string;
  actual: string;
  /** 選択式は正規化一致。自由記述の欄は null */
  match: boolean | null;
  /** 自由記述（備考・家族）の文字 bigram 類似度。選択式は null */
  similarity: number | null;
};

/** 連絡事項の参考表示の 1 行。見本が無い（または件数が少ない）ときは expected が null */
export type ContactNoteRow = {
  index: number;
  expected: string | null;
  actual: string | null;
  /** 両方あるときだけ。文字 bigram の Jaccard 類似度。合格判定には使わない */
  similarity: number | null;
};

export type QuoteCheck = { quote: string; found: boolean };
export type EvidenceQuoteCheck = QuoteCheck & { key: EvidenceKey };

/** 完全一致用の正規化: NFKC（全角英数字→半角、全角スペース→半角）、連続空白を1つに、前後の空白を除く */
export function normalizeValue(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** 類似度・引用照合用の正規化: NFKC で揃え、空白・句読点・括弧類を除く */
function stripForMatch(s: string): string {
  return s.normalize("NFKC").replace(/[\s、。，．,.!?！？・:：;；「」『』()（）［］[\]【】"“”‘’~〜…]/g, "");
}

function bigrams(s: string): Set<string> {
  const t = stripForMatch(s);
  const set = new Set<string>();
  if (t.length === 0) return set;
  if (t.length === 1) {
    set.add(t);
    return set;
  }
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

/** 文字 bigram の Jaccard 類似度（0〜1）。両方空なら 1、片方だけ空なら 0 */
export function bigramJaccard(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function choiceRow(key: string, label: string, expected: string, actual: string): CompareRow {
  return { key, label, expected, actual, match: normalizeValue(expected) === normalizeValue(actual), similarity: null, kind: "choice" };
}

function textRow(key: string, label: string, expected: string, actual: string): CompareRow {
  return { key, label, expected, actual, match: null, similarity: bigramJaccard(expected, actual), kind: "text" };
}

function formatLeftover(items: readonly LeftoverMedication[]): string {
  if (items.length === 0) return "（なし）";
  return items.map((m) => `${m.drugName} ${m.amount}${m.note ? `（${m.note}）` : ""}`).join("、");
}

/** 見本の各件に、薬剤名が最も近い実際の件を 1 対 1 で割り当てる（順序の違いを許す） */
function pairLeftovers(expected: readonly LeftoverMedication[], actual: readonly LeftoverMedication[]) {
  const used = new Set<number>();
  return expected.map((e) => {
    let best = -1;
    let bestScore = 0;
    actual.forEach((a, i) => {
      if (used.has(i)) return;
      const score = bigramJaccard(e.drugName, a.drugName);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) used.add(best);
    return { expected: e, actual: best >= 0 ? actual[best] : null };
  });
}

function leftoverRow(expected: readonly LeftoverMedication[], actual: readonly LeftoverMedication[]): CompareRow {
  const pairs = pairLeftovers(expected, actual);
  const amountOk = pairs.every(
    (p) => p.actual !== null && (normalizeValue(p.expected.amount) === UNSURE) === (normalizeValue(p.actual.amount) === UNSURE),
  );
  const e = formatLeftover(expected);
  const a = formatLeftover(actual);
  return {
    key: "leftoverMedications",
    label: "残薬",
    expected: e,
    actual: a,
    match: expected.length === actual.length && amountOk,
    similarity: bigramJaccard(e, a),
    kind: "list",
  };
}

/** 見本と下書きを欄ごとに比較する。行の並びは報告書の並び（見本の順）。basicInfoSuggestions は見ない */
type ComparableDraft = Omit<ReportDraft, "evidence" | "basicInfoSuggestions" | "contactNotes">;
export function compareDraft(expected: ComparableDraft, actual: ComparableDraft): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const def of REPORT_ORDER) {
    const label = def.label;
    switch (def.key) {
      case "leftoverMedications":
        rows.push(leftoverRow(expected.leftoverMedications, actual.leftoverMedications));
        break;
      case "mealsPerDay":
        rows.push(choiceRow("mealsPerDay.value", label, expected.mealsPerDay.value, actual.mealsPerDay.value));
        rows.push(textRow("mealsPerDay.note", `${label}・備考`, expected.mealsPerDay.note, actual.mealsPerDay.note));
        break;
      case "daytimeSleep":
        rows.push(choiceRow("daytimeSleep.choice", label, expected.daytimeSleep.choice, actual.daytimeSleep.choice));
        rows.push(textRow("daytimeSleep.duration", `${label}・長さ`, expected.daytimeSleep.duration, actual.daytimeSleep.duration));
        rows.push(textRow("daytimeSleep.note", `${label}・備考`, expected.daytimeSleep.note, actual.daytimeSleep.note));
        break;
      case "soap":
        for (const k of ["s", "o", "a", "p"] as const) {
          rows.push(textRow(`soap.${k}`, SOAP_LABELS[k], expected.soap[k], actual.soap[k]));
        }
        break;
      default: {
        const field = CHOICE_FIELDS.find((f) => f.key === def.key);
        if (!field) break;
        rows.push(choiceRow(`${field.key}.choice`, label, expected[field.key].choice, actual[field.key].choice));
        rows.push(textRow(`${field.key}.note`, `${label}・備考`, expected[field.key].note, actual[field.key].note));
      }
    }
  }
  return rows;
}

/** 基本情報の提案（訪問頻度・調剤形態・家族）を見本と比べる。選択式は正規化一致、備考と家族は bigram 類似度 */
export function compareSuggestions(expected: BasicInfoSuggestions, actual: BasicInfoSuggestions): SuggestionRow[] {
  const choice = (key: string, label: string, e: string, a: string): SuggestionRow => ({
    key,
    label,
    expected: e,
    actual: a,
    match: normalizeValue(e) === normalizeValue(a),
    similarity: null,
  });
  const text = (key: string, label: string, e: string, a: string): SuggestionRow => ({
    key,
    label,
    expected: e,
    actual: a,
    match: null,
    similarity: bigramJaccard(e, a),
  });
  return [
    choice("visitFrequency.choice", "訪問頻度", expected.visitFrequency.choice, actual.visitFrequency.choice),
    text("visitFrequency.note", "訪問頻度・備考", expected.visitFrequency.note, actual.visitFrequency.note),
    choice("dispensingForm.choice", "調剤形態", expected.dispensingForm.choice, actual.dispensingForm.choice),
    text("dispensingForm.note", "調剤形態・備考", expected.dispensingForm.note, actual.dispensingForm.note),
    text("family", "家族", expected.family, actual.family),
  ];
}

/**
 * 連絡事項（AI）を件ごとに並べる。見本（expected）は任意で、無くても落ちない。
 * 件数が違うときは多い方に合わせて行を作る。人が読むための表で、合格判定には使わない。
 */
export function compareContactNotes(expected: readonly string[] | undefined, actual: readonly string[]): ContactNoteRow[] {
  const n = Math.max(expected?.length ?? 0, actual.length);
  const rows: ContactNoteRow[] = [];
  for (let i = 0; i < n; i++) {
    const e = expected?.[i] ?? null;
    const a = actual[i] ?? null;
    rows.push({ index: i + 1, expected: e, actual: a, similarity: e !== null && a !== null ? bigramJaccard(e, a) : null });
  }
  return rows;
}

/** 「」で区切った引用を取り出す。「」が無ければ全体を 1 件の引用とみなす */
function extractQuotes(text: string): string[] {
  const quoted = [...text.matchAll(/「([^」]*)」/g)].map((m) => m[1]);
  const quotes = quoted.length > 0 ? quoted : [text];
  return quotes.filter((q) => stripForMatch(q) !== "");
}

/** S の引用が会話テキストに実在するか（空白・句読点・「」を無視した部分一致） */
export function checkQuotes(soapS: string, transcript: string): QuoteCheck[] {
  const hay = stripForMatch(transcript);
  return extractQuotes(soapS).map((quote) => ({ quote, found: hay.includes(stripForMatch(quote)) }));
}

/** evidence の各グループを「／」で分割し、同じ方法で会話テキストに実在するか確認する */
export function checkEvidence(evidence: Evidence, transcript: string): EvidenceQuoteCheck[] {
  const hay = stripForMatch(transcript);
  const out: EvidenceQuoteCheck[] = [];
  for (const key of Object.keys(EVIDENCE_LABELS) as EvidenceKey[]) {
    for (const part of evidence[key].split("／")) {
      for (const quote of extractQuotes(part)) {
        out.push({ key, quote, found: hay.includes(stripForMatch(quote)) });
      }
    }
  }
  return out;
}

/** 選択式の一致率（一致数 / 選択式欄数） */
export function summarize(rows: readonly CompareRow[]): { matched: number; total: number; rate: number; mismatched: string[] } {
  const choice = rows.filter((r) => r.kind === "choice");
  const matched = choice.filter((r) => r.match === true).length;
  return {
    matched,
    total: choice.length,
    rate: choice.length === 0 ? 0 : matched / choice.length,
    mismatched: choice.filter((r) => r.match !== true).map((r) => r.label),
  };
}
