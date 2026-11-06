/**
 * 文字起こしの精度を測る（文字誤り率 CER）。
 * 正解テキストと文字起こしを文字単位で比べ、置換・挿入・削除の最小回数（編集距離）を数える。
 * 句読点・空白・全角半角の違いは誤りに数えない（NFKC 正規化のうえで記号を除く）。
 * 漢数字と算用数字の違い（4 と 四）や送り仮名の違いは、そのまま誤りに数える。
 */

export type EditOp = "equal" | "sub" | "ins" | "del";

/** 位置合わせの区間。sub は ref と hyp の両方、ins は hyp だけ、del は ref だけに文字が入る */
export type AlignSegment = { op: EditOp; ref: string; hyp: string };

export type CerResult = {
  /** 正解の文字数（正規化後） */
  refLength: number;
  /** 文字起こしの文字数（正規化後） */
  hypLength: number;
  /** 編集距離（置換＋挿入＋削除） */
  distance: number;
  /** 文字誤り率 = distance / refLength（正解が空なら 0） */
  cer: number;
  /** 一致率 = 1 − CER（下限 0） */
  accuracy: number;
  sub: number;
  ins: number;
  del: number;
  segments: AlignSegment[];
};

// 比較から除く記号（句読点・括弧・引用符・区切り）。長音「ー」は仮名の一部なので除かない
const PUNCT =
  /[、。，．,.　!?！？「」『』（）()［］\[\]【】〈〉《》・…‥—―〜～~\-:;：；"'“”‘’·]/g;

/**
 * 比較用に整える: NFKC（全角英数→半角など）→ 空白を除く → 記号を除く。
 * ただし数字に挟まれた「.」「,」「:」は残す（1.5錠 と 15錠、10:30 と 1030 を区別するため）。
 */
export function normalizeForCer(text: string): string {
  const compact = text.normalize("NFKC").replace(/\s+/g, "");
  return compact.replace(PUNCT, (ch, offset: number, s: string) => {
    if (ch === "." || ch === "," || ch === ":") {
      const before = s[offset - 1] ?? "";
      const after = s[offset + 1] ?? "";
      if (/\d/.test(before) && /\d/.test(after)) return ch;
    }
    return "";
  });
}

/** 正解 ref と文字起こし hyp を比べる。どちらも生のテキストでよい（中で正規化する） */
export function compareTranscript(ref: string, hyp: string): CerResult {
  const r = Array.from(normalizeForCer(ref));
  const h = Array.from(normalizeForCer(hyp));
  const n = r.length;
  const m = h.length;
  const W = m + 1;
  // dp[i*W + j] = r[0..i) と h[0..j) の編集距離
  const dp = new Int32Array((n + 1) * W);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    dp[i * W] = i;
    const ri = r[i - 1];
    for (let j = 1; j <= m; j++) {
      const cost = ri === h[j - 1] ? 0 : 1;
      const diag = dp[(i - 1) * W + (j - 1)] + cost;
      const up = dp[(i - 1) * W + j] + 1; // ref の文字が抜けた（削除）
      const left = dp[i * W + (j - 1)] + 1; // 余分な文字（挿入）
      dp[i * W + j] = diag <= up ? (diag <= left ? diag : left) : up <= left ? up : left;
    }
  }

  // 後ろから辿って位置合わせを作る（同じ op が続く間はひとつの区間にまとめる）
  const ops: { op: EditOp; rc: string; hc: string }[] = [];
  let i = n;
  let j = m;
  let sub = 0;
  let ins = 0;
  let del = 0;
  while (i > 0 || j > 0) {
    const cur = dp[i * W + j];
    if (i > 0 && j > 0) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      if (cur === dp[(i - 1) * W + (j - 1)] + cost) {
        if (cost === 0) ops.push({ op: "equal", rc: r[i - 1], hc: h[j - 1] });
        else {
          ops.push({ op: "sub", rc: r[i - 1], hc: h[j - 1] });
          sub++;
        }
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cur === dp[(i - 1) * W + j] + 1) {
      ops.push({ op: "del", rc: r[i - 1], hc: "" });
      del++;
      i--;
      continue;
    }
    ops.push({ op: "ins", rc: "", hc: h[j - 1] });
    ins++;
    j--;
  }
  ops.reverse();

  const segments: AlignSegment[] = [];
  for (const o of ops) {
    const last = segments[segments.length - 1];
    if (last && last.op === o.op) {
      last.ref += o.rc;
      last.hyp += o.hc;
    } else {
      segments.push({ op: o.op, ref: o.rc, hyp: o.hc });
    }
  }

  const distance = dp[n * W + m];
  const cer = n === 0 ? 0 : distance / n;
  return {
    refLength: n,
    hypLength: m,
    distance,
    cer,
    accuracy: Math.max(0, 1 - cer),
    sub,
    ins,
    del,
    segments,
  };
}
