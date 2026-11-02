/**
 * コピー処理。navigator.clipboard は secure context（https か localhost）でしか使えないため、
 * http の LAN 接続（スマホから http://192.168.x.x:3000 で開く場合）では一時的な textarea を選択して
 * document.execCommand("copy") を使う予備手段に切り替える。
 */

export type CopyMethod = "clipboard" | "legacy" | "failed";

export async function copyText(text: string): Promise<CopyMethod> {
  if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch {
      // 権限拒否などは予備手段へ
    }
  }
  return copyTextLegacy(text) ? "legacy" : "failed";
}

/**
 * 一時的な textarea を画面外に置いて選択し、execCommand("copy") でコピーする。
 * iOS Safari は select() だけでは選択されないので、Range と setSelectionRange の両方を使う。
 */
export function copyTextLegacy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    ta.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(ta);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    previous?.focus({ preventScroll: true });
  }
}
