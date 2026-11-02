/**
 * 引用照合。AI が返した S（本人の言葉）と根拠（evidence）の引用が、
 * 送ったマスク済み会話に実在するかを確かめる（実在しなければ薬剤師の確認を促す）。
 */

/** 照合時に無視する文字: 空白・句読点・括弧・コロンなど */
const IGNORED = /[\s　、。，．,.・!！?？…‥「」『』（）()［］\[\]【】〜~:：;；"'“”]/g;

/** 照合用に正規化する（全角半角を揃え、空白・句読点・「」を除く） */
export function normalizeForQuote(s: string): string {
  return s.normalize("NFKC").replace(IGNORED, "");
}

/**
 * 引用 quote が text の中にあるかを返す。
 * 空白・句読点・「」を除いた部分一致。引用中の「…」は省略とみなし、各断片が含まれていればよい。
 * 正規化後に空になる引用（記号だけ）は確かめようがないので true を返す。
 */
export function checkQuoteInText(quote: string, text: string): boolean {
  const pieces = quote
    .split(/…+|\.{3,}|⋯/)
    .map(normalizeForQuote)
    .filter((p) => p !== "");
  if (pieces.length === 0) return true;
  const t = normalizeForQuote(text);
  return pieces.every((p) => t.includes(p));
}

/**
 * 「」と「／」（と改行）で引用を分割する。
 * 例: 「A」「B」→ [A, B] / A／B → [A, B] / 「A」／「B」→ [A, B]
 */
export function splitQuotes(s: string): string[] {
  return s
    .split(/[「」／\n]/)
    .map((q) => q.trim())
    .filter((q) => q !== "");
}

/** s の各引用のうち、text に見つからないものを返す */
export function findMissingQuotes(s: string, text: string): string[] {
  return splitQuotes(s).filter((q) => !checkQuoteInText(q, text));
}
