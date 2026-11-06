/**
 * iPhone の「ショートカット」との連携（任意機能）。
 * - 起動: Apple 公式の URL スキーム shortcuts://run-shortcut?name=… をリンクで開く
 *   （https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios）。
 * - 戻り: ショートカットの最後で「URL を開く」→ このアプリの URL の「#t=<URL エンコードした文字起こし>」。
 *   # より後ろはブラウザがサーバーに送らないので、生の会話が PC のサーバーに届かない。
 *   アプリは読み取ったらすぐ URL から消す。
 * ショートカットが無い端末では、ボタンを押しても何も起きないだけで、他の動きは変わらない。
 */

/** iPhone 側で作るショートカットの名前（手順書・docs/TRANSCRIPT-CHECK.md と合わせる） */
export const SHORTCUT_NAME = "在宅レポ録音";

/** URL の # の後ろに文字起こしを載せるときのキー */
export const TRANSCRIPT_FRAGMENT_KEY = "t";

/** ショートカットを名前で起動する URL（Apple 公式の書式） */
export function shortcutRunUrl(name: string = SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

/**
 * location.hash（例: "#t=%E3%81%82%0A%E3%81%84"）から文字起こしを取り出す。無ければ null。
 * 「+」は空白として扱わない（URL エンコードでは %20。文字起こしに + はまず出ないが、出たらそのまま残す）。
 * 壊れたエンコードは null（例外にしない）。
 */
export function parseTranscriptFragment(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "") return null;
  for (const part of h.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    if (key !== TRANSCRIPT_FRAGMENT_KEY) continue;
    const raw = part.slice(eq + 1);
    try {
      const text = decodeURIComponent(raw).replace(/\r\n?/g, "\n").trim();
      return text === "" ? null : text;
    } catch {
      return null;
    }
  }
  return null;
}

/** 「ショートカット」App がある端末か（iPhone・iPad・Mac）。表示の出し分けにだけ使う */
export function supportsShortcuts(userAgent: string, platform: string = ""): boolean {
  const ua = `${userAgent} ${platform}`;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS の Safari は Macintosh を名乗るので、Mac も含めて true にする（Mac にもショートカットはある）
  return /Macintosh/i.test(ua);
}
