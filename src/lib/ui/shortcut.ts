/**
 * iPhone の「ショートカット」との連携（任意機能）。
 * - 起動: Apple 公式の URL スキーム。x-callback-url 版を使うと、終わったあとに戻る URL（x-success）をアプリ側から渡せ、
 *   ショートカットの文字出力は iOS が x-success の URL に result= として付けて戻してくれる
 *   （https://support.apple.com/guide/shortcuts/use-x-callback-url-apdcd7f20a6f/ios）。
 *   これなら、ショートカット側に「URL を開く」を組む必要がない（録音 → 文字起こし → クリップボードにコピー の 3 つで足りる）。
 * - 戻り: x-success にはアプリの URL の「#t=」を渡す。iOS が result= をその後ろに付ければ、文字は # より後ろ（フラグメント）に
 *   載り、ブラウザはサーバーに送らない。クエリ（?result=）として付けてきた場合はサーバーに届いてしまうので、受け取りはするが
 *   その旨を画面に出し、採用しない判断ができるようにする（実機での確認用）。
 * - 従来どおり、ショートカットの最後の「URL を開く」で「#t=<URL エンコードした文字起こし>」を開く形も受ける。
 * アプリは読み取ったらすぐ URL から消す。ショートカットが無い端末では、ボタンを押しても何も起きないだけ。
 */

/** iPhone 側で作るショートカットの名前（手順書・docs/TRANSCRIPT-CHECK.md と合わせる） */
export const SHORTCUT_NAME = "在宅レポ録音";

/** URL の # の後ろに文字起こしを載せるときのキー */
export const TRANSCRIPT_FRAGMENT_KEY = "t";

/** x-callback-url で iOS がショートカットの文字出力を付けるときのキー（Apple の仕様） */
export const CALLBACK_RESULT_KEY = "result";

/** ショートカットを名前で起動する URL（Apple 公式の書式。戻り先は指定しない） */
export function shortcutRunUrl(name: string = SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

/**
 * x-callback-url でショートカットを起動し、終わったらアプリ（origin）に戻る URL。
 * x-success はアプリの「/#t=」。iOS はここに result=<文字出力> を付けて開く。中止したときはアプリのトップに戻る。
 */
export function shortcutCallbackUrl(origin: string, name: string = SHORTCUT_NAME): string {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams({
    name,
    "x-success": `${base}/#${TRANSCRIPT_FRAGMENT_KEY}=`,
    "x-cancel": `${base}/`,
  });
  return `shortcuts://x-callback-url/run-shortcut?${params.toString()}`;
}

function decodePart(raw: string): string | null {
  try {
    const text = decodeURIComponent(raw.replace(/\+/g, "%2B")).replace(/\r\n?/g, "\n").trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** "a=1&b=2" や "t=?result=3" のような並びから、キーに合う最初の値（デコード済み）を返す */
function pickParam(list: string, keys: readonly string[]): string | null {
  for (const part of list.split(/[&?]/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (!keys.includes(part.slice(0, eq))) continue;
    const text = decodePart(part.slice(eq + 1));
    if (text !== null) return text;
  }
  return null;
}

/**
 * location.hash（例: "#t=%E3%81%82%0A%E3%81%84"、x-callback なら "#t=?result=%E3%81%82" や "#t=&result=…"）から
 * 文字起こしを取り出す。無ければ null。壊れたエンコードは null（例外にしない）。
 */
export function parseTranscriptFragment(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "") return null;
  return pickParam(h, [TRANSCRIPT_FRAGMENT_KEY, CALLBACK_RESULT_KEY]);
}

/**
 * location.search（例: "?result=%E3%81%82"）から、x-callback の result を取り出す。
 * この形で届いた文字はサーバーにも送られているので、呼び出し側はその旨を知らせる。
 */
export function parseTranscriptQuery(search: string): string | null {
  const s = search.startsWith("?") ? search.slice(1) : search;
  if (s === "") return null;
  return pickParam(s, [CALLBACK_RESULT_KEY]);
}

/** 「ショートカット」App がある端末か（iPhone・iPad・Mac）。表示の出し分けにだけ使う */
export function supportsShortcuts(userAgent: string, platform: string = ""): boolean {
  const ua = `${userAgent} ${platform}`;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS の Safari は Macintosh を名乗るので、Mac も含めて true にする（Mac にもショートカットはある）
  return /Macintosh/i.test(ua);
}
