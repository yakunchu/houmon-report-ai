/**
 * 画面共通の部品。現場で使う前提で、文字は 18px 以上、ボタンは高さ 48px 以上。
 * 色だけで意味を伝えない（選択中は ✓、要確認は ⚠ と文字を付ける）。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const inputClass =
  "block w-full min-h-12 rounded-lg border-2 border-slate-500 bg-white px-3 py-2 text-lg text-slate-900 placeholder:text-slate-500 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

const buttonBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border-2 px-5 py-2 text-lg font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

const buttonVariants = {
  primary: "border-blue-800 bg-blue-800 text-white hover:bg-blue-900",
  secondary: "border-slate-600 bg-white text-slate-900 hover:bg-slate-100",
  danger: "border-red-800 bg-white text-red-900 hover:bg-red-50",
} as const;

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]} ${className}`} {...rest} />;
}

/** 手順ごとの大きな枠。id はステップ表示からのジャンプ先 */
export function Section({
  id,
  title,
  children,
  className = "",
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 rounded-2xl border-2 border-slate-300 bg-white p-4 sm:p-6 ${className}`}>
      <h2 className="mb-4 text-2xl font-bold text-slate-900 print:hidden">{title}</h2>
      {children}
    </section>
  );
}

/** ラベル付きの入力欄（label で包むのでタップしやすく、読み上げにも対応） */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-bold text-slate-900">{label}</span>
      {hint ? <span className="mb-1 block text-slate-700">{hint}</span> : null}
      {children}
    </label>
  );
}

/** 「要確認」バッジ。色だけに頼らず、⚠ と文字を付ける */
export function UnsureBadge({ text = "要確認" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border-2 border-amber-700 bg-amber-200 px-2 py-0.5 text-base font-bold text-amber-950">
      <span aria-hidden="true">⚠</span>
      {text}
    </span>
  );
}

/** 「AI の提案（会話から）」バッジ。会話から自動入力した項目に付ける（「要確認」とは別。確認は薬剤師が行う） */
export function AiBadge({ text = "AI の提案（会話から）" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border-2 border-blue-800 bg-blue-50 px-2 py-0.5 text-base font-bold text-blue-950">
      <span aria-hidden="true">✦</span>
      {text}
    </span>
  );
}

/** 原文にない引用などの警告表示 */
export function WarnText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-2 rounded-lg border-2 border-amber-700 bg-amber-50 px-3 py-2 font-bold text-amber-950">
      <span aria-hidden="true">⚠ </span>
      {children}
    </p>
  );
}

/**
 * ボタン型のラジオ。中身は本物の radio なので、キーボード・読み上げでも選べる。
 * unsureLabel を渡すと、最後に「要確認」の選択肢を足す。
 */
export function ChoiceButtons({
  name,
  label,
  options,
  value,
  onChange,
  unsureLabel,
}: {
  name: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  unsureLabel?: string;
}) {
  const all = unsureLabel ? [...options, unsureLabel] : options;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {all.map((o) => {
        const selected = value === o;
        const isUnsure = o === unsureLabel;
        const tone = isUnsure
          ? selected
            ? "border-amber-800 bg-amber-300 text-amber-950"
            : "border-amber-700 bg-amber-50 text-amber-950 hover:bg-amber-100"
          : selected
            ? "border-blue-800 bg-blue-800 text-white"
            : "border-slate-500 bg-white text-slate-900 hover:bg-slate-100";
        return (
          <label
            key={o}
            className={`flex min-h-12 cursor-pointer select-none items-center justify-center gap-1 rounded-lg border-2 px-4 py-2 text-lg font-bold has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${tone}`}
          >
            <input
              type="radio"
              name={name}
              value={o}
              checked={selected}
              onChange={() => onChange(o)}
              className="sr-only"
            />
            {selected ? <span aria-hidden="true">✓</span> : null}
            {isUnsure && !selected ? <span aria-hidden="true">⚠</span> : null}
            {o}
          </label>
        );
      })}
    </div>
  );
}
