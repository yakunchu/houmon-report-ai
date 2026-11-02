/**
 * 端末内マスク処理の実装（types.ts の契約）。純関数のみ。Node 固有 API・ネットワークは使わない。
 *
 * 方針:
 * - 比較は「正規化コピー」（全角英数→半角、全角スペース→半角、各種ダッシュ→"-"）で行う。
 *   正規化は 1 文字 1 文字の置き換えなので長さが変わらず、位置はそのまま元テキストに使える。
 *   置換後の他の部分は元の文字のまま。
 * - 辞書・正規表現の一致を「候補（範囲）」として集め、左から（同じ開始位置なら長い方を）優先して
 *   重ならないように採用する。【患者A】などの既存の記号の内側は触らない（冪等）。
 */

import type {
  ContainsOriginalFn,
  MaskKind,
  MaskTextFn,
  MaskToken,
  MaskWarning,
  PersonalInfoDictionary,
  UnmaskTextFn,
} from "./types";

export type {
  ContainsOriginalFn,
  MaskKind,
  MaskResult,
  MaskTextFn,
  MaskToken,
  MaskWarning,
  PersonKind,
  PersonalInfoDictionary,
  UnmaskTextFn,
} from "./types";

// ---------------------------------------------------------------------------
// 正規化（1 文字 → 1 文字。長さを変えない）
// ---------------------------------------------------------------------------

/** 電話番号などで使われる各種ハイフン・マイナス・ダッシュ（長音「ー」は含めない） */
const DASH_CHARS = /[‐-―−－﹣ｰ]/;

function normalizeChar(ch: string): string {
  const code = ch.charCodeAt(0);
  // 全角数字・英大文字・英小文字
  if (
    (code >= 0xff10 && code <= 0xff19) ||
    (code >= 0xff21 && code <= 0xff3a) ||
    (code >= 0xff41 && code <= 0xff5a)
  ) {
    return String.fromCharCode(code - 0xfee0);
  }
  if (code === 0x3000 || code === 0x00a0) return " ";
  if (DASH_CHARS.test(ch)) return "-";
  switch (ch) {
    case "（":
      return "(";
    case "）":
      return ")";
    case "／":
      return "/";
    case "．":
      return ".";
    case "：":
      return ":";
    default:
      return ch;
  }
}

/** 全角英数字・全角スペース等を半角にした比較用コピーを作る（長さは変わらない） */
function normalize(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += normalizeChar(text[i]);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** カタカナ → ひらがな（ァ〜ヶ のみ。長音などはそのまま） */
function toHiragana(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 記号（トークン）
// ---------------------------------------------------------------------------

const TOKEN_PATIENT = "【患者A】";
const TOKEN_ADDRESS = "【住所】";
const TOKEN_BIRTHDATE = "【生年月日】";
const TOKEN_PHONE = "【電話】";
const TOKEN_POSTAL = "【郵便番号】";
const familyToken = (i: number) => `【家族${i + 1}】`;
const otherToken = (i: number) => `【その他${i + 1}】`;

/** このモジュールが作る記号の形。これに一致する【…】だけを「触らない領域」とする */
const TOKEN_SHAPE = /【(?:患者[A-Z]|家族\d+|その他\d+|住所|生年月日|電話|郵便番号)】/g;
const TOKEN_SHAPE_EXACT = new RegExp(`^(?:${TOKEN_SHAPE.source})$`);

// ---------------------------------------------------------------------------
// 辞書 → 検索語（term）
// ---------------------------------------------------------------------------

type Term = {
  /** 正規化済みの検索パターン（RegExp 文字列） */
  pattern: string;
  /** 並べ替え用の長さ */
  length: number;
  token: string;
  kind: MaskKind;
};

/** 1 文字だけの人名（「一」「愛」など）は、敬称が続くときだけ置換する（「一包化」を壊さない） */
const HONORIFIC_AHEAD = "(?=さん|様|ちゃん|くん|君|先生|殿)";

type TermBook = {
  terms: Term[];
  seen: Set<string>;
};

function addTerm(
  book: TermBook,
  raw: string | undefined,
  token: string,
  kind: MaskKind,
  opts: { person?: boolean; pattern?: string } = {},
): void {
  if (!raw) return;
  const norm = normalize(raw).trim().replace(/\s+/g, " ");
  if (!norm) return;
  const key = norm.replace(/ /g, "").toLowerCase();
  if (!key || book.seen.has(key)) return;
  book.seen.add(key);
  let pattern = opts.pattern ?? escapeRegExp(norm).replace(/ /g, "[ ]*");
  if (opts.person && key.length === 1) pattern += HONORIFIC_AHEAD;
  book.terms.push({ pattern, length: norm.length, token, kind });
}

/**
 * 「姓 名」を空白で姓と名に分ける。空白が無くても、患者の姓（正規化済み・空白なし）で始まり
 * 残りがあれば、その姓と残りの名に分ける。分けられなければ名だけ undefined
 */
function splitFullName(name: string, patientFamilyKey = ""): { family: string; given?: string } {
  const norm = normalize(name).trim().replace(/\s+/g, " ");
  const idx = norm.indexOf(" ");
  if (idx < 0) {
    if (patientFamilyKey && norm.length > patientFamilyKey.length && norm.startsWith(patientFamilyKey)) {
      return { family: patientFamilyKey, given: norm.slice(patientFamilyKey.length) };
    }
    return { family: norm };
  }
  return { family: norm.slice(0, idx), given: norm.slice(idx + 1).replace(/ /g, "") };
}

const ADDRESS_SEP = "(?:-|丁目|番地|番|号|の)";

/** 住所の数字部分（1-2-3 / 1丁目2番3号 など）の区切りをゆるくした RegExp 文字列にする */
function addressPattern(addr: string): string {
  // 末尾の「番地・番・号」は有っても無くても一致させる
  const tail = /\d(?:番地|番|号)$/.exec(addr);
  const body = tail ? addr.slice(0, addr.length - tail[0].length + 1) : addr;
  let pat = "";
  let last = 0;
  for (const m of body.matchAll(new RegExp(`(\\d+)(${ADDRESS_SEP}+)(?=\\d)`, "g"))) {
    const at = m.index ?? 0;
    pat += escapeRegExp(body.slice(last, at)) + escapeRegExp(m[1]) + `${ADDRESS_SEP}+`;
    last = at + m[0].length;
  }
  pat += escapeRegExp(body.slice(last));
  if (tail) pat += "(?:番地|番|号)?";
  return pat.replace(/ /g, "[ ]*");
}

function buildTerms(dict: PersonalInfoDictionary): Term[] {
  const book: TermBook = { terms: [], seen: new Set() };

  // 患者: 姓名・姓・名・カナ（フルと各部分。ひらがな表記も）
  const { familyName, givenName, kana } = dict.patient;
  const family = (familyName ?? "").trim();
  const given = (givenName ?? "").trim();
  addTerm(book, `${family} ${given}`, TOKEN_PATIENT, "patient", { person: true });
  addTerm(book, family, TOKEN_PATIENT, "patient", { person: true });
  addTerm(book, given, TOKEN_PATIENT, "patient", { person: true });
  if (kana) {
    const kanaNorm = normalize(kana).trim().replace(/\s+/g, " ");
    for (const k of [kanaNorm, ...kanaNorm.split(" ")]) {
      addTerm(book, k, TOKEN_PATIENT, "patient", { person: true });
      addTerm(book, toHiragana(k), TOKEN_PATIENT, "patient", { person: true });
    }
  }
  const patientFamilyKey = normalize(family).replace(/ /g, "");

  // 家族: family 配列の順に【家族1】【家族2】…
  // 空白なしの氏名（山本美咲）は、患者の姓で始まれば残りを名とみなす。そうでなければ姓の長さが
  // 分からないので、先頭 1〜2 文字を姓とみなした場合の名（末尾の部分文字列）を全て置換候補にする
  const familyList = dict.family ?? [];
  const parsed = familyList.map((f) => splitFullName(f.name, patientFamilyKey));
  familyList.forEach((f, i) => {
    const token = familyToken(i);
    const { family: fam, given: giv } = parsed[i];
    if (giv) {
      // 空白の有無にかかわらず一致するよう、空白入りの形を先に登録する
      addTerm(book, `${fam} ${giv}`, token, "family", { person: true });
      addTerm(book, f.name, token, "family", { person: true });
      addTerm(book, giv, token, "family", { person: true });
      // 姓単独は、患者と同じ姓なら患者トークンに任せ、他の家族と同姓でも曖昧なので置換しない
      const famKey = normalize(fam).replace(/ /g, "");
      const shared = parsed.some((p, j) => j !== i && normalize(p.family).replace(/ /g, "") === famKey);
      if (famKey !== patientFamilyKey && !shared) {
        addTerm(book, fam, token, "family", { person: true });
      }
      return;
    }
    addTerm(book, f.name, token, "family", { person: true });
    // 空白なし・患者と別の姓: 先頭 1〜2 文字を姓とみなした残りを名の候補にする
    const compact = fam.replace(/ /g, "");
    if (compact.length >= 3) {
      for (const cut of [1, 2]) {
        const guess = compact.slice(cut);
        if (guess.length >= 1 && guess.length < compact.length) {
          addTerm(book, guess, token, "family", { person: true });
        }
      }
    }
  });

  // 住所: そのまま + 括弧書きを除いた本体 + 都道府県を除いたもの（数字の区切りはゆるく）
  if (dict.address) {
    const full = normalize(dict.address).trim().replace(/\s+/g, " ");
    const core = full.replace(/\([^)]*\)/g, "").trim();
    const noPref = core.replace(/^[^県府道都]{1,4}[県府都]|^北海道/, "");
    addTerm(book, full, TOKEN_ADDRESS, "address", { pattern: addressPattern(full) });
    if (core.length >= 3) {
      addTerm(book, core, TOKEN_ADDRESS, "address", { pattern: addressPattern(core) });
    }
    if (noPref !== core && noPref.length >= 3) {
      addTerm(book, noPref, TOKEN_ADDRESS, "address", { pattern: addressPattern(noPref) });
    }
  }

  // 電話（辞書にあるものはそのまま。一般形式は後段の正規表現でも拾う）
  addTerm(book, dict.phone, TOKEN_PHONE, "phone");

  // その他
  (dict.others ?? []).forEach((o, i) => addTerm(book, o, otherToken(i), "other"));

  // 長い語を先に（同じ開始位置では長いものが勝つ）
  return book.terms.sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// 候補の収集
// ---------------------------------------------------------------------------

type Candidate = { start: number; end: number; token: string; kind: MaskKind };

const ERA_BASE: Record<string, number> = {
  明治: 1867,
  大正: 1911,
  昭和: 1925,
  平成: 1988,
  令和: 2018,
};
const ERA_LETTER_BASE: Record<string, number> = { M: 1867, T: 1911, S: 1925, H: 1988, R: 2018 };

type YMD = [number, number, number];

function parseBirthDate(s: string | undefined): YMD | undefined {
  if (!s) return undefined;
  const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(normalize(s));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
const isAlnum = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

/** 生年月日: 辞書の日付と同じ日に解釈できるものだけ（または「生年月日」の直後の日付）を候補にする */
function collectBirthDates(norm: string, birth: YMD | undefined): Candidate[] {
  const out: Candidate[] = [];
  const push = (m: RegExpExecArray, ymd: YMD) => {
    const start = m.index;
    const end = start + m[0].length;
    const labeled = /(?:生年月日|誕生日)[\s:は]*$/.test(norm.slice(Math.max(0, start - 12), start));
    const same = birth !== undefined && ymd[0] === birth[0] && ymd[1] === birth[1] && ymd[2] === birth[2];
    if (same || labeled) out.push({ start, end, token: TOKEN_BIRTHDATE, kind: "birthDate" });
  };
  const eachMatch = (re: RegExp, f: (m: RegExpExecArray) => YMD | undefined, strictBefore = true) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
      const before = norm[m.index - 1];
      const after = norm[m.index + m[0].length];
      if (strictBefore && (isDigit(before) || isDigit(after))) continue;
      const ymd = f(m);
      if (ymd) push(m, ymd);
    }
  };

  // 西暦: 1940年4月1日
  eachMatch(/(\d{4}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日/g, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  // 西暦: 1940/4/1  1940-4-1  1940.4.1
  eachMatch(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/g, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  // 和暦: 昭和15年4月1日（元年も）
  eachMatch(
    /(明治|大正|昭和|平成|令和) ?(元|\d{1,2}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日/g,
    (m) => [ERA_BASE[m[1]] + (m[2] === "元" ? 1 : Number(m[2])), Number(m[3]), Number(m[4])],
  );
  // 和暦の略記: S15.4.1
  eachMatch(/([MTSHR])(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})/g, (m) => {
    if (isAlnum(norm[m.index - 1])) return undefined;
    return [ERA_LETTER_BASE[m[1]] + Number(m[2]), Number(m[3]), Number(m[4])];
  });
  return out;
}

/** 電話: 0 から始まる 10〜11 桁（ハイフン・空白・括弧あり無し） */
function collectPhones(norm: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /\(?0\d{1,4}\)?[-\s]?\d{1,4}[-\s]?\d{3,4}(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) continue;
    // 括弧の外側の 0 の直前が数字なら、より長い数字列の一部
    const zeroAt = m.index + m[0].indexOf("0");
    if (isDigit(norm[zeroAt - 1]) || isDigit(norm[m.index - 1])) continue;
    out.push({ start: m.index, end: m.index + m[0].length, token: TOKEN_PHONE, kind: "phone" });
  }
  return out;
}

/** 郵便番号: 〒?\d{3}-?\d{4}（前後が数字なら対象外） */
function collectPostalCodes(norm: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /(?:〒 ?)?\d{3}-?\d{4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const digitAt = m.index + m[0].search(/\d/);
    if (isDigit(norm[digitAt - 1]) || isDigit(norm[m.index + m[0].length])) continue;
    out.push({ start: m.index, end: m.index + m[0].length, token: TOKEN_POSTAL, kind: "postalCode" });
  }
  return out;
}

function collectTermMatches(norm: string, terms: Term[]): Candidate[] {
  const out: Candidate[] = [];
  for (const t of terms) {
    const re = new RegExp(t.pattern, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length, token: t.token, kind: t.kind });
    }
  }
  return out;
}

/** 既存の【…】記号の範囲（この内側は触らない） */
function protectedRanges(norm: string): [number, number][] {
  const out: [number, number][] = [];
  const re = new RegExp(TOKEN_SHAPE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** 開始位置が早い順（同じなら長い順）に、重ならないものを採用する */
function selectCandidates(cands: Candidate[], protectedRs: [number, number][]): Candidate[] {
  const sorted = cands
    .map((c, order) => ({ c, order }))
    .sort((a, b) => a.c.start - b.c.start || b.c.end - a.c.end || a.order - b.order)
    .map((x) => x.c);
  const picked: Candidate[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start < cursor) continue;
    if (protectedRs.some(([s, e]) => c.start < e && c.end > s)) continue;
    picked.push(c);
    cursor = c.end;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// 警告（辞書に無い名前の可能性）
// ---------------------------------------------------------------------------

/** 一般語・続柄語・職種名など。名前ではないので警告しない */
const NOT_NAME = new Set([
  "薬剤師", "患者", "娘", "息子", "長女", "長男", "次女", "次男", "三女", "三男", "奥", "お母", "お父", "母", "父",
  "お嬢", "嬢", "ご主人", "主人", "先生", "看護師", "ヘルパー", "ケアマネ", "医師", "歯科医", "栄養士", "介護士",
  "相談員", "職員", "利用者", "管理者", "事務員", "受付", "皆", "客", "お客", "孫", "祖母", "祖父", "妻", "夫",
  "兄", "姉", "弟", "妹", "嫁", "婿", "本人", "家族", "ご家族", "ご本人", "ドクター", "ナース", "ご婦人", "赤",
  "おばあ", "おじい", "ばあ", "じい", "あなた", "みな", "たく", "おかあ", "おとう", "おくさ", "ご近所", "近所",
  "担当", "所長", "院長", "お姉", "お兄", "お隣", "隣",
]);
/** 「お疲れ様」「ご苦労様」など、混在した語尾での除外 */
const NOT_NAME_SUFFIX = /(?:お疲れ|ご苦労|お世話|お待たせ|お大事|ご家族|ご本人|ご主人|ご近所|お客|おばあ|おじい|たく|みな)$/;

const KANJI = "\u3400-\u4DBF\u4E00-\u9FFF\u3005";
const KATAKANA = "\u30A1-\u30F6\u30FC";
const HIRAGANA = "\u3041-\u3096";
/**
 * 同じ文字種（漢字／カタカナ／ひらがな）の連続 + 敬称。
 * 「様子」「ちゃんと」「さんざん」「さんぽ」のような敬称ではない語は先読みで外す。
 */
const NAME_BEFORE_HONORIFIC = new RegExp(
  `([${KANJI}]+|[${KATAKANA}]+|[${HIRAGANA}]+)(さん(?!ざん|ぽ)|様(?![子式相々])|先生|ちゃん(?!と))`,
  "g",
);

/** 辞書で置換されなかった「○○さん／様／先生／ちゃん」の○○（1〜4 文字）を警告にする。index はマスク後テキスト内の位置 */
function collectWarnings(masked: string): MaskWarning[] {
  const out: MaskWarning[] = [];
  const re = new RegExp(NAME_BEFORE_HONORIFIC.source, "g");
  const hiraOnly = new RegExp(`^[${HIRAGANA}]+$`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const run = m[1];
    if (run.length > 4) continue; // 長い語（訪問看護師 など）は名前ではない
    if (hiraOnly.test(run) && run.length < 2) continue; // ひらがな 1 文字は助詞・送り仮名の可能性が高い
    // 直前の「お・ご」（お母さん、ご主人 など）と、混在した語尾（お疲れ様 など）も除外判定に使う
    const prev = masked[m.index - 1] ?? "";
    const withPrefix = prev === "お" || prev === "ご" ? prev + run : run;
    const context = masked.slice(Math.max(0, m.index - 3), m.index + run.length);
    if (NOT_NAME.has(run) || NOT_NAME.has(withPrefix) || NOT_NAME_SUFFIX.test(context)) continue;
    out.push({
      text: run,
      index: m.index,
      reason: `辞書に無い名前の可能性（「${run}${m[2]}」）。個人名なら辞書に追加してください`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 公開関数
// ---------------------------------------------------------------------------

export const maskText: MaskTextFn = (text, dictionary) => {
  const norm = normalize(text);
  const terms = buildTerms(dictionary);
  const birth = parseBirthDate(dictionary.birthDate);

  const cands: Candidate[] = [
    ...collectTermMatches(norm, terms),
    ...collectBirthDates(norm, birth),
    ...collectPhones(norm),
    ...collectPostalCodes(norm),
  ];
  const picked = selectCandidates(cands, protectedRanges(norm));

  // 左から順に組み立てる。tokens は出現順・(記号, 元の文字列) の重複なし
  let masked = "";
  let pos = 0;
  const tokens: MaskToken[] = [];
  const seen = new Set<string>();
  for (const c of picked) {
    const original = text.slice(c.start, c.end);
    masked += text.slice(pos, c.start) + c.token;
    pos = c.end;
    const key = `${c.token}\u0000${original}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push({ token: c.token, original, kind: c.kind });
    }
  }
  masked += text.slice(pos);

  return { masked, tokens, warnings: collectWarnings(masked) };
};

/**
 * 記号を元の文字列に戻す。
 * 同じ記号に複数の元表記がある（例: 【患者A】←「山本」「花子」）ときは、tokens で先に出てくるもの（＝会話での初出）に戻す。
 */
export const unmaskText: UnmaskTextFn = (text, tokens) => {
  const map = new Map<string, string>();
  for (const t of tokens) if (!map.has(t.token)) map.set(t.token, t.original);
  if (map.size === 0) return text;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp(keys.join("|"), "g");
  return text.replace(re, (k) => map.get(k) ?? k);
};

export const containsOriginal: ContainsOriginalFn = (masked, tokens) => {
  const norm = normalize(masked).toLowerCase();
  const compact = norm.replace(/\s+/g, "");
  for (const t of tokens) {
    if (TOKEN_SHAPE_EXACT.test(t.original)) continue;
    const o = normalize(t.original).trim().toLowerCase();
    const oc = o.replace(/\s+/g, "");
    if (oc.length < 2) continue;
    if (norm.includes(o) || compact.includes(oc)) return true;
  }
  return false;
};
