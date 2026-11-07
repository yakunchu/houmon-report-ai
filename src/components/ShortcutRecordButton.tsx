"use client";
/**
 * 「録音して文字起こし」ボタン（②会話の先頭に置く大きなボタン。2026-11-07 社長の指示で上部・目立つ色に）。
 * iPhone の「ショートカット」App に入れた「在宅レポ録音」を、Apple 公式の shortcuts://run-shortcut で起動する。
 * 文字起こしは、ショートカットの最後の「URL を開く」がこのアプリの「#t=…」を開くことで届く（ReportApp が受け取って会話欄に入れる）。
 * x-callback-url は使わない（2026-11-06 の実機テストで result がクエリに付き、サーバーに届いたため。src/lib/ui/shortcut.ts）。
 * ショートカット App が無い端末（Windows・Android）では表示しない。入っていない iPhone では押しても何も起きない。
 * 色: 花田（hanada）の塗りに白の太字 22px（大きな文字なのでコントラスト 3:1 以上で足りる）。主ボタン（藍）とも注意（茜）とも違う色にして目立たせる。
 */
import { useSyncExternalStore } from "react";
import { SHORTCUT_NAME, shortcutRunUrl, supportsShortcuts } from "@/lib/ui/shortcut";

const linkClass =
  "flex w-full min-h-16 cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-hanada bg-hanada px-5 py-3 text-xl font-bold text-on-ai no-underline hover:opacity-90 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ai";

const subscribeNone = () => () => {};
const readSupport = () => supportsShortcuts(navigator.userAgent, navigator.platform ?? "");
const serverSupport = () => false;

function MicIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="9" y="3" width="6" height="11" rx="3"></rect>
      <path d="M5 11a7 7 0 0 0 14 0"></path>
      <path d="M12 18v3"></path>
      <path d="M8 21h8"></path>
    </svg>
  );
}

export function ShortcutRecordButton({ disabled = false }: { disabled?: boolean }) {
  // サーバーでは判定できないので、ハイドレーション後に端末を見て出し分ける
  const shown = useSyncExternalStore(subscribeNone, readSupport, serverSupport);
  if (!shown) return null;
  return (
    <div className="mb-4">
      {disabled ? (
        <span className={`${linkClass} cursor-not-allowed opacity-50`} aria-disabled="true">
          <MicIcon />
          録音して文字起こし
        </span>
      ) : (
        <a href={shortcutRunUrl(SHORTCUT_NAME)} className={linkClass} title={`iPhone のショートカット「${SHORTCUT_NAME}」を起動します`}>
          <MicIcon />
          録音して文字起こし
        </a>
      )}
      <p className="mt-1 text-base text-ink-muted">録音を止めると、文字が下の会話欄に入ります（iPhone のショートカット「{SHORTCUT_NAME}」）。</p>
    </div>
  );
}
