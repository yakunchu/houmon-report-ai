/**
 * iPhone の「ショートカット」との連携（任意機能）。
 * - 起動: Apple 公式の URL スキーム shortcuts://run-shortcut?name=…（戻り先は渡さない）
 *   https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios
 * - 戻り: ショートカットの最後の「URL を開く」で、アプリの URL の「#t=<URL エンコードした文字起こし>」を開く。
 *   # より後ろ（フラグメント）はブラウザがサーバーに送らないので、生の会話が PC のサーバーに届かない。
 * - 使わない形: x-callback-url（x-success にアプリの URL を渡し、iOS が result= を付けて戻す。
 *   https://support.apple.com/guide/shortcuts/use-x-callback-url-apdcd7f20a6f/ios）。2026-11-06 の実機テスト（iOS 27.0.1）で、
 *   iOS は result を # の後ろではなくクエリ（?result=）として付け、文字起こしがサーバーの要求ログに記録された。そのため採用しない。
 *   ?result= で届いたときは取り込まず、警告だけ出して URL から消す（parseTranscriptQuery は検知のためだけに残す）。
 * アプリは読み取ったらすぐ URL から消す。ショートカットが無い端末では、ボタンを押しても何も起きないだけ。
 */

/** iPhone 側で作るショートカットの名前（手順書・docs/TRANSCRIPT-CHECK.md と合わせる） */
export const SHORTCUT_NAME = "在宅レポ録音";

/** URL の # の後ろに文字起こしを載せるときのキー */
export const TRANSCRIPT_FRAGMENT_KEY = "t";

/** x-callback-url で iOS がショートカットの文字出力を付けるときのキー（Apple の仕様）。この形で届いたことの検知にだけ使う */
export const CALLBACK_RESULT_KEY = "result";

/** ショートカットを名前で起動する URL（Apple 公式の書式。戻り先は指定しない） */
export function shortcutRunUrl(name: string = SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
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
 * location.hash（例: "#t=%E3%81%82%0A%E3%81%84"。# の後ろに result= が付く形も念のため読む）から
 * 文字起こしを取り出す。無ければ null。壊れたエンコードは null（例外にしない）。
 */
export function parseTranscriptFragment(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "") return null;
  return pickParam(h, [TRANSCRIPT_FRAGMENT_KEY, CALLBACK_RESULT_KEY]);
}

/**
 * location.search（例: "?result=%E3%81%82"）に、x-callback の result が載っているかを見る。
 * この形で届いた文字はサーバーにも送られているので、呼び出し側は取り込まずに警告を出し、URL から消す。
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
