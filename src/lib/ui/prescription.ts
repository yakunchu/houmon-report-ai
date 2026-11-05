/**
 * 処方内容の貼り付けを整える（純関数）。
 * レセコンや処方箋の文字をそのまま貼ると、医師名・医療機関名・患者情報・見出しが混ざる。
 * AI に送る「処方内容」には薬剤の行だけを残し、外した行は理由つきで返す（画面で見せて、1 行ずつ戻せる）。
 *
 * 判定は「らしい」行を外すだけの簡易なもの。人名そのものを見つけるわけではない。
 * 外した行を戻すかどうかは薬剤師が決める。マスク辞書の扱い・AI に送る経路は変えない。
 */

export type RemovedLine = { line: string; reason: string };

export type NormalizedPrescription = {
  /** 薬剤行（先頭の番号を外し、空白を整えたもの） */
  lines: string[];
  /** 外した行（空行は含めない）。line は空白を整えた元の行 */
  removed: RemovedLine[];
};

export const REASON_DOCTOR = "医師名・医療機関名らしい";
export const REASON_PATIENT = "患者情報らしい";
export const REASON_HEADING = "見出し・空白行";

/**
 * 医師名・医療機関名らしい語。
 * - Dr は単語として現れたときだけ（Dry syrup などを巻き込まない）。
 * - 「医療」は単独では当てず、医療センター・医療法人・医療機関のときだけ（「医療用…」の薬剤名を巻き込まない）。
 * - 診療科は「内科・外科・小児科・皮膚科・整形外科・眼科・耳鼻咽喉科・精神科・歯科」など「〜科」の形（直後が「用・的」でないとき）。
 * - clinic / hospital は英字の施設名（薬剤名に出ない）。院長は肩書き。
 */
const DOCTOR_RE = new RegExp(
  [
    "処方医",
    "医師",
    "先生",
    "院長",
    "クリニック",
    "病院",
    "医院",
    "診療所",
    "医療(?:機関|センター|法人)",
    "(?:内|外|小児|皮膚|整形外|眼|耳鼻咽喉|精神|歯|産婦人|泌尿器|脳神経外|神経内|循環器内|消化器内|呼吸器内|糖尿病内)科(?![用的])",
    "clinic",
    "hospital",
    "\\bDr\\b",
  ].join("|"),
  "i",
);

/** 患者情報らしい語 */
const PATIENT_WORD_RE = /患者|氏名|生年月日|保険|公費|〒/;

/** 「様」で終わる行（宛名・氏名の行） */
const SAMA_END_RE = /様[\s\u3000]*$/;

/** 電話番号らしい 0 始まりの 10〜11 桁（ハイフン・かっこ区切り可）。NFKC 後の文字列に使う */
const PHONE_RE = /(?:^|[^0-9])0(?:[-\u2010\u2011\u2212\u30fc\u2015()]?[0-9]){9,10}(?![0-9])/;

/** 見出しかどうかを見るとき、飾りとして落とす文字 */
const DECORATION_RE = /[\s\u3000\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2500\u30fc=*#\[\]()<>【】〔〕「」『』〈〉《》・:.,、。_~〜]/g;

/** 見出しの語だけの行（飾りを落としたあとで比べる）。数字だけ（「1.」など）も見出し扱い */
const HEADING_RE = /^(?:処方箋|rp[0-9]*|以下余白|[0-9]{1,2})$/i;

/**
 * 先頭の番号: 「1.」「1)」「1）」「1:」「1、」「(1)」「①」「Rp1」「Rp.1」「Rp 」。
 * 全角の数字・Ｒｐも対象。「1.5錠」のように小数が続くものは番号とみなさない。
 */
const LEADING_NUMBER_RE =
  /^(?:[rRＲｒ][pPＰｐ](?![a-zA-Zａ-ｚＡ-Ｚ])[.．]?[\s\u3000]*[0-9０-９]{0,2}[\s\u3000]*[)）:：、]?|[(（][0-9０-９]{1,2}[)）]|[\u2460-\u2473]|[0-9０-９]{1,2}(?:[.．](?![0-9０-９])|[)）:：、]))[\s\u3000]*/;

/** 先頭の番号を外す（無ければそのまま） */
export function stripLeadingNumber(line: string): string {
  return line.replace(LEADING_NUMBER_RE, "");
}

/** タブ・連続する空白（半角・全角・NBSP）を全角スペース 1 つにそろえ、前後の空白を落とす */
function tidySpaces(line: string): string {
  return line.trim().replace(/[\s\u3000\u00a0]+/g, "\u3000");
}

function classify(line: string): { removed: string } | { drug: string } {
  // 判定には全角英数・全角記号を半角にそろえた文字列を使う（表示・返す文字は元のまま）
  const n = line.normalize("NFKC");
  const core = n.replace(DECORATION_RE, "");
  if (core === "" || HEADING_RE.test(core)) return { removed: REASON_HEADING };
  if (DOCTOR_RE.test(n)) return { removed: REASON_DOCTOR };
  if (PATIENT_WORD_RE.test(n) || SAMA_END_RE.test(n) || PHONE_RE.test(n)) return { removed: REASON_PATIENT };
  const drug = stripLeadingNumber(line).trim();
  if (drug === "") return { removed: REASON_HEADING };
  return { drug };
}

/**
 * 貼り付けた処方内容を、薬剤行と外した行に分ける。
 * 改行で分け、空行は捨てる。外した行は理由つきで removed に入れる。
 */
export function normalizePrescription(text: string): NormalizedPrescription {
  const lines: string[] = [];
  const removed: RemovedLine[] = [];
  for (const raw of text.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const line = tidySpaces(raw);
    if (line === "") continue;
    const c = classify(line);
    if ("drug" in c) lines.push(c.drug);
    else removed.push({ line, reason: c.removed });
  }
  return { lines, removed };
}

/** 処方内容の欄の末尾に 1 行足す（外した行を戻すとき用）。先頭の番号は外す。空の行は何もしない */
export function appendPrescriptionLine(existing: string, line: string): string {
  const tidy = tidySpaces(line);
  const add = stripLeadingNumber(tidy).trim() || tidy;
  if (add === "") return existing;
  const base = existing.replace(/\s+$/, "");
  return base === "" ? add : `${base}\n${add}`;
}
