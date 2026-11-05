/** 上部のステップ表示（①基本情報 ②会話 ③下書き ④出力）。押すとその場所へ移動する */

export type StepStatus = "done" | "current" | "todo";

const STEPS = [
  { n: "①", label: "患者", id: "step-1" },
  { n: "②", label: "会話", id: "step-2" },
  { n: "③", label: "下書き", id: "step-3" },
  { n: "④", label: "出力", id: "step-4" },
] as const;

const STATUS_TEXT: Record<StepStatus, string> = { done: "済み", current: "いまここ", todo: "　" };

export function StepBar({
  statuses,
  onJump,
}: {
  statuses: readonly [StepStatus, StepStatus, StepStatus, StepStatus];
  onJump: (id: string) => void;
}) {
  return (
    <nav aria-label="作業の流れ" className="sticky top-0 z-20 border-b-2 border-line bg-raised print:hidden">
      <ol className="mx-auto flex max-w-[900px]">
        {STEPS.map((s, i) => {
          const status = statuses[i];
          const tone =
            status === "current"
              ? "border-b-4 border-ai bg-shiroai text-ai"
              : status === "done"
                ? "border-b-4 border-transparent text-ink"
                : "border-b-4 border-transparent text-ink-muted";
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onJump(s.id)}
                aria-current={status === "current" ? "step" : undefined}
                className={`flex min-h-12 w-full cursor-pointer flex-col items-center px-1 py-1 font-bold leading-tight focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-hanada ${tone}`}
              >
                <span>
                  {s.n}
                  {s.label}
                </span>
                <span className="text-base font-normal">
                  {status === "done" ? <span className="text-ai">✓</span> : null}
                  {STATUS_TEXT[status]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
