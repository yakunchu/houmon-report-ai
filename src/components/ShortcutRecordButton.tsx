"use client";
/**
 * 「録音して文字起こし（ショートカット）」ボタン。
 * iPhone の「ショートカット」App に入れた「在宅レポ録音」を、Apple 公式の x-callback-url で起動する。
 * 戻り先（x-success）にこのアプリの URL の #t= を渡すので、ショートカット側は「録音 → 文字起こし → クリップボードにコピー」の
 * 3 つだけでよく、文字出力は iOS が result= として付けて戻してくる（ReportApp が受け取って会話欄に入れる）。
 * ショートカット App が無い端末（Windows・Android）では表示しない。入っていない iPhone では押しても何も起きない。
 */
import { useSyncExternalStore } from "react";
import { SHORTCUT_NAME, shortcutCallbackUrl, shortcutRunUrl, supportsShortcuts } from "@/lib/ui/shortcut";

const linkClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-ink-muted bg-raised px-5 py-2 text-lg font-bold text-ink no-underline hover:bg-surface focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada";

const subscribeNone = () => () => {};
const readSupport = () => supportsShortcuts(navigator.userAgent, navigator.platform ?? "");
const serverSupport = () => false;

export function ShortcutRecordButton({ disabled = false }: { disabled?: boolean }) {
  // サーバーでは判定できないので、ハイドレーション後に端末を見て出し分ける
  const shown = useSyncExternalStore(subscribeNone, readSupport, serverSupport);
  if (!shown) return null;
  if (disabled) {
    return (
      <span className={`${linkClass} cursor-not-allowed opacity-50`} aria-disabled="true">
        録音して文字起こし（ショートカット）
      </span>
    );
  }
  const href = typeof window === "undefined" ? shortcutRunUrl(SHORTCUT_NAME) : shortcutCallbackUrl(window.location.origin, SHORTCUT_NAME);
  return (
    <a href={href} className={linkClass} title={`ショートカット「${SHORTCUT_NAME}」を起動します`}>
      録音して文字起こし（ショートカット）
    </a>
  );
}
