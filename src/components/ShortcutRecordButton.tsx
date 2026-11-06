"use client";
/**
 * 「録音して文字起こし（ショートカット）」ボタン。
 * iPhone の「ショートカット」App に入れた「在宅レポ録音」を、Apple 公式の shortcuts://run-shortcut で起動する。
 * 文字起こしは、ショートカットの最後の「URL を開く」がこのアプリの「#t=…」を開くことで届く（ReportApp が受け取って会話欄に入れる）。
 * x-callback-url は使わない（2026-11-06 の実機テストで result がクエリに付き、サーバーに届いたため。src/lib/ui/shortcut.ts）。
 * ショートカット App が無い端末（Windows・Android）では表示しない。入っていない iPhone では押しても何も起きない。
 */
import { useSyncExternalStore } from "react";
import { SHORTCUT_NAME, shortcutRunUrl, supportsShortcuts } from "@/lib/ui/shortcut";

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
  return (
    <a href={shortcutRunUrl(SHORTCUT_NAME)} className={linkClass} title={`ショートカット「${SHORTCUT_NAME}」を起動します`}>
      録音して文字起こし（ショートカット）
    </a>
  );
}
