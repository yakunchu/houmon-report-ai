/**
 * 患者の検索と生年月日の表示・年齢計算（純関数）。
 * 氏名・カナ・生年月日（西暦・和暦）で部分一致。空白区切りの複数語は AND。
 */
import type { CalcAgeFn, FormatBirthDateFn, Patient, SearchPatientsFn } from "./types";

/** 和暦の元号。西暦 = base + 年（令和 = 2018 + 年 など）。start は元号の開始日 */
const ERAS = [
  { name: "令和", initial: "r", base: 2018, start: [2019, 5, 1] },
  { name: "平成", initial: "h", base: 1988, start: [1989, 1, 8] },
  { name: "昭和", initial: "s", base: 1925, start: [1926, 12, 25] },
  { name: "大正", initial: "t", base: 1911, start: [1912, 7, 30] },
  { name: "明治", initial: "m", base: 1867, start: [1868, 1, 25] },
] as const;

/** ひらがな→カタカナ（ゝゞ含む） */
function hiraganaToKatakana(s: string): string {
  return s.replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * カナ欄の正規化: 半角カナ→全角、ひらがな→カタカナ、全角スペース→半角、前後の空白除去。
 * （NFKC で半角カナの濁点・半濁点も合成される）
 */
export function normalizeKana(s: string): string {
  return hiraganaToKatakana(s.normalize("NFKC")).replace(/\s+/g, " ").trim();
}

/** 検索用の畳み込み: NFKC・小文字・ひらがな→カタカナ・空白をすべて除去 */
function fold(s: string): string {
  return hiraganaToKatakana(s.normalize("NFKC").toLowerCase()).replace(/\s+/g, "");
}

type DateParts = { year: number; month: number; day: number };

/** "YYYY-MM-DD"（月日は 1 桁も可）を実在する日付として読む。不正なら null */
function parseIsoDate(value: string): DateParts | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(2000, month - 1, day));
  // Date.UTC は 0〜99 年を 1900 年代に読み替えるので、年は後から入れて確かめ直す
  d.setUTCFullYear(year);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** 日付が属する元号と和暦年。明治より前は null */
function eraOf({ year, month, day }: DateParts): { name: string; year: number } | null {
  const key = year * 10000 + month * 100 + day;
  for (const era of ERAS) {
    const [y, m, d] = era.start;
    if (key >= y * 10000 + m * 100 + d) return { name: era.name, year: year - era.base };
  }
  return null;
}

export const formatBirthDate: FormatBirthDateFn = (birthDate) => {
  const raw = birthDate.trim();
  if (raw === "") return "";
  const parts = parseIsoDate(raw);
  if (!parts) return raw;
  const text = `${parts.year}年${parts.month}月${parts.day}日`;
  const era = eraOf(parts);
  if (!era) return text;
  return `${text}（${era.name}${era.year === 1 ? "元" : era.year}年）`;
};

export const calcAge: CalcAgeFn = (birthDate, asOf = new Date()) => {
  const parts = parseIsoDate(birthDate);
  if (!parts || Number.isNaN(asOf.getTime())) return null;
  let age = asOf.getFullYear() - parts.year;
  const monthDiff = asOf.getMonth() + 1 - parts.month;
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < parts.day)) age -= 1;
  return age < 0 ? null : age;
};

/** 検索語を日付として読んだ結果。year が 4 桁未満なら前方一致（"194" → 194x 年） */
type BirthQuery = { year: string; month?: number; day?: number };

// 区切りは 年/月/日・"."・"/"・"-"。末尾の「日」は省略可
const ERA_PATTERN = /^(明治|大正|昭和|平成|令和|[mthsr])\.?(元|\d{1,2})(?:[年./-](?:(\d{1,2})(?:[月./-](?:(\d{1,2})日?)?)?)?)?$/;
const WESTERN_PATTERN = /^(\d{1,4})(?:[年./-](?:(\d{1,2})(?:[月./-](?:(\d{1,2})日?)?)?)?)?$/;
const COMPACT_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

/** NFKC・小文字済みの 1 語を、西暦・和暦の日付指定として読む。日付でなければ null */
function parseBirthQuery(term: string): BirthQuery | null {
  const num = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s));

  const era = ERA_PATTERN.exec(term);
  if (era) {
    const def = ERAS.find((e) => e.name === era[1] || e.initial === era[1]);
    if (!def) return null;
    const n = era[2] === "元" ? 1 : Number(era[2]);
    if (n < 1) return null;
    return { year: String(def.base + n), month: num(era[3]), day: num(era[4]) };
  }

  const compact = COMPACT_PATTERN.exec(term);
  if (compact) return { year: compact[1], month: Number(compact[2]), day: Number(compact[3]) };

  const western = WESTERN_PATTERN.exec(term);
  if (western) {
    const month = num(western[2]);
    // 4 桁未満の年は前方一致だけ（"4/1" のような月日のみの指定は対象外）
    if (western[1].length < 4 && month !== undefined) return null;
    return { year: western[1], month, day: num(western[3]) };
  }
  return null;
}

function matchesBirth(birthDate: string, q: BirthQuery): boolean {
  const parts = parseIsoDate(birthDate);
  if (!parts) return false;
  const yearOk = q.year.length < 4 ? String(parts.year).startsWith(q.year) : parts.year === Number(q.year);
  if (!yearOk) return false;
  if (q.month !== undefined && parts.month !== q.month) return false;
  if (q.day !== undefined && parts.day !== q.day) return false;
  return true;
}

export const searchPatients: SearchPatientsFn = (patients, query) => {
  // 空白（全角含む）区切りで AND。元号の頭文字を小文字にそろえるため NFKC・小文字にしてから分ける
  const terms = query.normalize("NFKC").toLowerCase().split(/\s+/).filter((t) => t !== "");
  if (terms.length === 0) return patients.slice();

  const prepared = terms.map((term) => ({ text: fold(term), birth: parseBirthQuery(term) }));

  const matches = (p: Patient): boolean => {
    const haystacks = [fold(p.familyName + p.givenName), fold(p.familyNameKana + p.givenNameKana)];
    return prepared.every(
      (t) => haystacks.some((h) => h.includes(t.text)) || (t.birth !== null && matchesBirth(p.birthDate, t.birth)),
    );
  };
  return patients.filter(matches);
};
